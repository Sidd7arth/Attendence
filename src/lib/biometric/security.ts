/**
 * Server-side security helpers for the biometric endpoints.
 *
 * Re-implements the proven patterns from the previous generation:
 *   - sliding-window rate limiter (per identity)
 *   - single-use nonce cache + timestamp freshness (anti-replay)
 *   - medium-band two-scan confirmation memory (uncertainty never auto-marks)
 *   - structured audit logging that NEVER logs embeddings/frames
 */
import "server-only";
import { randomBytes } from "crypto";

export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(limit: number, windowMs = 60_000): RateLimiter {
  const events = new Map<string, number[]>();
  return {
    allow(key: string): boolean {
      const now = Date.now();
      const arr = (events.get(key) ?? []).filter((t) => now - t < windowMs);
      if (arr.length >= limit) {
        events.set(key, arr);
        return false;
      }
      arr.push(now);
      events.set(key, arr);
      if (events.size > 10_000) events.clear(); // hard cap
      return true;
    },
  };
}

// Shared limiters (per process). Values mirror the previous calibrated system.
export const verifyLimiter = createRateLimiter(
  Number(process.env.BIOMETRIC_VERIFY_RATE_LIMIT ?? 90)
);
export const enrollLimiter = createRateLimiter(
  Number(process.env.BIOMETRIC_ENROLL_RATE_LIMIT ?? 6)
);
export const challengeLimiter = createRateLimiter(
  Number(process.env.BIOMETRIC_CHALLENGE_RATE_LIMIT ?? 12)
);

/** Freshness window for client timestamps (anti-replay): ±120s. */
export const TIMESTAMP_WINDOW_MS = 120_000;

/** One-time nonce cache (anti-replay on enrollment payloads). */
const nonceCache = new Map<string, number>(); // nonce -> firstSeenAt
const NONCE_TTL_MS = 150_000;

export function consumeNonce(nonce: string): boolean {
  const now = Date.now();
  // prune
  if (nonceCache.size > 5_000) {
    for (const [k, t] of nonceCache) {
      if (now - t > NONCE_TTL_MS) nonceCache.delete(k);
    }
  }
  if (nonceCache.has(nonce)) return false;
  nonceCache.set(nonce, now);
  return true;
}

export function newNonceValue(): string {
  return randomBytes(16).toString("base64url");
}

// ── Medium-band two-scan confirmation ────────────────────────────────────────
interface PendingConfirmation {
  studentId: string;
  firstSeenAt: number;
}
const pendingConfirmations = new Map<string, PendingConfirmation>();
const CONFIRM_TTL_MS = 60_000;

function pruneConfirmations(now: number): void {
  for (const [k, v] of pendingConfirmations) {
    if (now - v.firstSeenAt > CONFIRM_TTL_MS) pendingConfirmations.delete(k);
  }
}

/** Records an ambiguous match and returns whether THIS scan confirms it. */
export function mediumBandConfirmation(
  sessionKey: string,
  studentId: string,
  confirmFor: string | undefined
): boolean {
  const now = Date.now();
  pruneConfirmations(now);
  const key = `${sessionKey}:${studentId}`;
  const pending = pendingConfirmations.get(key);

  if (pending && pending.studentId === studentId && confirmFor === studentId) {
    pendingConfirmations.delete(key); // consume — exactly two scans
    return true;
  }
  // First (or non-confirming) scan: remember and require a second look.
  pendingConfirmations.set(key, { studentId, firstSeenAt: now });
  return false;
}

// ── Structured audit logging (never embeddings, never frames) ───────────────
export function auditBiometric(event: string, fields: Record<string, unknown>): void {
  const requestId = randomBytes(8).toString("hex");
  const pairs = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  console.log(`[biometric-audit] event=${event} request=${requestId} ${pairs}`);
}
