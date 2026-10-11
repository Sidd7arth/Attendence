"""Internal security — caller authentication + rate limiting.

The biometric service is NEVER exposed to browsers as an authority. Every
request must carry the shared internal token (X-Internal-Token) issued only
to the EduTrack Next.js server. On top of that, a per-caller sliding-window
rate limiter mirrors the application-layer limits (defense in depth).
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from ..config import settings
from .exceptions import RateLimitedError, UnauthorizedCallerError


class SlidingWindowLimiter:
    """In-memory sliding window; prunes aggressively to stay small."""

    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._events[key]
            cutoff = now - self.window
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._events) > 10_000:  # hard cap on tracked keys
                self._events.clear()
            return True


_enroll_limiter = SlidingWindowLimiter(settings.enroll_rate_limit)
_verify_limiter = SlidingWindowLimiter(settings.verify_rate_limit)


def require_internal_token(token_header: str | None, operation: str, caller_key: str) -> None:
    """Raise unless the shared token is valid and the caller is within limits.

    operation: "enroll" | "verify" — selects the limiter bucket.
    caller_key: stable identity of the caller session (for rate limiting).
    """
    expected = settings.internal_token
    if not expected:
        # Fail-closed: a deployment without a configured token accepts nothing.
        raise UnauthorizedCallerError("internal token is not configured")
    if not token_header or token_header != expected:
        raise UnauthorizedCallerError("invalid internal token")

    limiter = _enroll_limiter if operation == "enroll" else _verify_limiter
    if not limiter.allow(caller_key):
        raise RateLimitedError("too many biometric requests; slow down")
