/**
 * EduTrack auth utilities — scrypt password hashing + DB-backed sessions.
 *
 * One opaque session token (256-bit random, stored server-side in the
 * `sessions` table) is accepted from TWO transports, both validated through
 * the exact same database path:
 *
 *   1. `Authorization: Bearer <token>` header — used automatically by the SPA
 *      client so authentication also works in third-party contexts (e.g. the
 *      preview panel's cross-origin iframe) where browsers refuse to store or
 *      send `SameSite=Lax` cookies.
 *   2. `edutrack_session` httpOnly cookie — first-party fallback (new tab,
 *      direct navigation, curl).
 *
 * There is no JWT and no client-side secret: tokens are opaque, revocable and
 * server-verified, so nothing sensitive is ever exposed to the frontend.
 * Server-side only.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "edutrack_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Passwords ──

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ── Sessions ──

export type AuthUser =
  | { role: "ADMIN"; adminId: string; name: string; email: string }
  | {
      role: "STUDENT";
      studentId: string;
      name: string;
      email: string;
      rollNumber: string;
      studentClass: string;
      /** Biometric status flag (no biometric data in the session) — lets the
       *  student portal show the face check-in option without an extra API call. */
      faceRegistered: boolean;
    };

/** Machine-readable reasons an unauthenticated request was rejected. */
export type AuthFailureReason =
  | "MISSING_TOKEN" // no Bearer header AND no cookie on the request
  | "INVALID_TOKEN" // token does not match any active session row
  | "SESSION_EXPIRED" // session row exists but expiresAt has passed
  | "USER_NOT_FOUND" // session valid but the admin/student row is gone
  | "ACCOUNT_INACTIVE"; // student account has been deactivated

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: AuthFailureReason };

const REASON_STATUS: Record<AuthFailureReason, number> = {
  MISSING_TOKEN: 401,
  INVALID_TOKEN: 401,
  SESSION_EXPIRED: 401,
  USER_NOT_FOUND: 401,
  ACCOUNT_INACTIVE: 403,
};

const REASON_MESSAGE: Record<AuthFailureReason, string> = {
  MISSING_TOKEN: "Not authenticated: no session token provided",
  INVALID_TOKEN: "Not authenticated: invalid session token",
  SESSION_EXPIRED: "Not authenticated: session expired, please sign in again",
  USER_NOT_FOUND: "Not authenticated: account no longer exists",
  ACCOUNT_INACTIVE: "Account is deactivated",
};

/**
 * Extract the session token from the `Authorization: Bearer <token>` header.
 * Ignores garbage placeholders such as "Bearer undefined"/"Bearer null" so a
 * misconfigured client can never poison the header path.
 */
export function extractBearerToken(req?: Request): string | null {
  const header = req?.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const lower = token.toLowerCase();
  if (lower === "undefined" || lower === "null" || lower === "Bearer".toLowerCase()) return null;
  return token;
}

/** Validate one token against the DB session store and load its owner. */
async function loadSession(token: string): Promise<AuthResult> {
  const session = await db.session.findUnique({ where: { token } });
  if (!session) return { ok: false, reason: "INVALID_TOKEN" };

  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  if (session.role === "ADMIN" && session.adminId) {
    const admin = await db.admin.findUnique({
      where: { id: session.adminId },
      select: { id: true, name: true, email: true },
    });
    if (!admin) return { ok: false, reason: "USER_NOT_FOUND" };
    return { ok: true, user: { role: "ADMIN", adminId: admin.id, name: admin.name, email: admin.email } };
  }

  if (session.role === "STUDENT" && session.studentId) {
    const st = await db.student.findUnique({
      where: { id: session.studentId },
      select: { id: true, name: true, email: true, rollNumber: true, studentClass: true, active: true, faceRegistered: true },
    });
    if (!st) return { ok: false, reason: "USER_NOT_FOUND" };
    if (!st.active) return { ok: false, reason: "ACCOUNT_INACTIVE" };
    return {
      ok: true,
      user: {
        role: "STUDENT",
        studentId: st.id,
        name: st.name,
        email: st.email,
        rollNumber: st.rollNumber,
        studentClass: st.studentClass,
        faceRegistered: st.faceRegistered,
      },
    };
  }

  return { ok: false, reason: "INVALID_TOKEN" };
}

/**
 * Resolve authentication for a request. Bearer header wins; cookie is the
 * fallback. If both are present and the first is stale, the second is still
 * honoured — the most specific failure reason is reported otherwise.
 */
export async function resolveAuth(req?: Request): Promise<AuthResult> {
  const candidates: string[] = [];
  const bearer = extractBearerToken(req);
  if (bearer) candidates.push(bearer);

  const jar = await cookies();
  const cookieToken = jar.get(SESSION_COOKIE)?.value;
  if (cookieToken && cookieToken !== bearer) candidates.push(cookieToken);

  if (candidates.length === 0) return { ok: false, reason: "MISSING_TOKEN" };

  let worst: AuthFailureReason = "INVALID_TOKEN";
  const rank: AuthFailureReason[] = ["INVALID_TOKEN", "USER_NOT_FOUND", "SESSION_EXPIRED", "ACCOUNT_INACTIVE"];
  for (const token of candidates) {
    const result = await loadSession(token);
    if (result.ok) return result;
    const ri = rank.indexOf(result.reason);
    if (ri >= 0 && ri > rank.indexOf(worst)) worst = result.reason;
  }
  return { ok: false, reason: worst };
}

/** Null-safe variant of resolveAuth for routes that treat anonymous as valid. */
export async function getAuthUser(req?: Request): Promise<AuthUser | null> {
  const result = await resolveAuth(req);
  return result.ok ? result.user : null;
}

/**
 * Throwing guard for protected API routes. Requires the request so the
 * Authorization header can be read — returns the user narrowed to the role.
 */
export async function requireRole<T extends "ADMIN" | "STUDENT">(
  req: Request | undefined,
  role: T
): Promise<Extract<AuthUser, { role: T }>> {
  const result = await resolveAuth(req);
  if (!result.ok) {
    throw new AuthError(REASON_STATUS[result.reason], REASON_MESSAGE[result.reason]);
  }
  if (result.user.role !== role) {
    throw new AuthError(403, "Forbidden: insufficient permissions for this resource");
  }
  return result.user as Extract<AuthUser, { role: T }>;
}

export async function createSession(role: "ADMIN" | "STUDENT", id: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      token,
      role,
      adminId: role === "ADMIN" ? id : null,
      studentId: role === "STUDENT" ? id : null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return token;
}

/** Delete the session(s) carried by the request (Bearer header and/or cookie). */
export async function destroySession(req?: Request): Promise<void> {
  const jar = await cookies();
  const tokens = [extractBearerToken(req), jar.get(SESSION_COOKIE)?.value].filter(
    (t): t is string => Boolean(t)
  );
  if (tokens.length > 0) {
    await db.session.deleteMany({ where: { token: { in: tokens } } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
