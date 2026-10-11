"""Biometric error taxonomy — structured, code-first (never free-text-only).

Every rejection carries a stable machine code so the application layer can
make policy decisions (e.g. block attendance on any failure) and precise
HTTP mappings.
"""
from __future__ import annotations


class BiometricError(Exception):
    """A biometric pipeline failure with a stable code + HTTP status."""

    status = 422
    code = "BIOMETRIC_ERROR"

    def __init__(self, detail: str | None = None, **meta):
        self.detail = detail or self.code
        self.meta = meta
        super().__init__(self.detail)

    def to_body(self) -> dict:
        return {"ok": False, "code": self.code, "detail": self.detail, **self.meta}


class NoFaceError(BiometricError):
    status, code = 422, "NO_FACE"


class MultipleFacesError(BiometricError):
    status, code = 422, "MULTIPLE_FACES"


class LowImageQualityError(BiometricError):
    status, code = 422, "LOW_IMAGE_QUALITY"

    def __init__(self, detail: str | None = None, **meta):
        # Propagate the structured quality report for the caller's UI.
        meta.setdefault("reason", "quality")
        super().__init__(detail=detail, **meta)


class LivenessFailedError(BiometricError):
    status, code = 422, "LIVENESS_FAILED"


class InputRejectedError(BiometricError):
    """Frame could not even be assessed (undecodable, empty, oversized)."""
    status, code = 422, "INPUT_REJECTED"


class TooFewFramesError(BiometricError):
    status, code = 422, "INSUFFICIENT_FRAMES"


class ModelNotReadyError(BiometricError):
    status, code = 503, "FACE_MODEL_NOT_READY"


class UnauthorizedCallerError(BiometricError):
    status, code = 401, "UNAUTHORIZED_CALLER"


class RateLimitedError(BiometricError):
    status, code = 429, "RATE_LIMITED"


class RepositoryError(BiometricError):
    status, code = 500, "REPOSITORY_ERROR"
