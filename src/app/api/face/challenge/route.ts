import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import { challengeLimiter, auditBiometric } from "@/lib/biometric/security";

// POST /api/face/challenge — server-issued, single-use anti-replay binding
// for the student self-service check-in. The challenge does NOT verify
// liveness itself (the Python engine does real CV liveness on frames); it
// binds the verification to a fresh, student-owned, expiring token so a
// captured payload cannot be replayed.
const CHALLENGE_TTL_MS = 120_000;

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(req, "STUDENT");

    if (!challengeLimiter.allow(`STUDENT:${user.studentId}`)) {
      auditBiometric("challenge.rate_limited", { studentId: user.studentId });
      return apiError(429, "Too many challenge requests. Wait a moment.");
    }

    // Opportunistic cleanup (10% of calls) — same pattern as before.
    if (Math.random() < 0.1) {
      await db.faceChallenge.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 600_000) } },
      });
    }

    const id = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await db.faceChallenge.create({
      data: { id, kind: "CAPTURE", studentId: user.studentId, expiresAt },
    });
    auditBiometric("challenge.issued", { studentId: user.studentId });

    return NextResponse.json({ challengeId: id, expiresAt: expiresAt.getTime() });
  } catch (e) {
    return handleError(e);
  }
}
