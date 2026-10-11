import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";
import { isValidDateKey, dayDiff, dateKey } from "@/lib/sas/dates";
import { toAttendanceDTO } from "@/lib/sas/dto";
import {
  verifyFrames,
  MAX_FRAMES,
  MIN_FRAMES,
  MAX_BIOMETRIC_BODY_BYTES,
  type BiometricRejection,
  type VerifyOk,
} from "@/lib/biometric/client";
import {
  verifyLimiter,
  mediumBandConfirmation,
  auditBiometric,
} from "@/lib/biometric/security";
import { validateGps, gpsRequired, type GpsInput } from "@/lib/biometric/gps";

/**
 * POST /api/face/verify — server-authoritative biometric verification.
 *
 * Flow: session auth → rate limit → payload validation → (SELF: consume
 * single-use challenge) → forward RAW FRAMES to the Python engine →
 * apply attendance business rules (GPS, date window, duplicate-day) →
 * persist attendance with server-stamped proof flags.
 *
 * The browser sends FRAMES, never embeddings or claims. Every biometric
 * decision (quality, liveness, identity) is computed by the Python engine.
 */

interface VerifyBody {
  frames?: unknown;
  date?: unknown;
  challengeId?: unknown;
  confirmFor?: unknown;
  gps?: GpsInput;
}

function invalidPayload(detail: string) {
  return { success: false, verified: false, reason: "PAYLOAD_INVALID", error: detail };
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authentication (ADMIN kiosk or STUDENT self-service)
    const auth = await resolveAuth(req);
    if (!auth.ok) return apiError(401, "Not authenticated.");

    const identityKey =
      auth.user.role === "ADMIN" ? `ADMIN:${auth.user.adminId}` : `STUDENT:${auth.user.studentId}`;

    // 2. Rate limit
    if (!verifyLimiter.allow(identityKey)) {
      auditBiometric("verify.rate_limited", { identity: identityKey });
      return apiError(429, "Too many verification attempts. Wait a moment.");
    }

    // 3. Body cap + parse
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    const raw = await req.text();
    if (contentLength > MAX_BIOMETRIC_BODY_BYTES || raw.length > MAX_BIOMETRIC_BODY_BYTES) {
      return NextResponse.json(invalidPayload("payload too large"), { status: 413 });
    }
    let body: VerifyBody;
    try {
      body = JSON.parse(raw) as VerifyBody;
    } catch {
      return NextResponse.json(invalidPayload("invalid JSON"), { status: 400 });
    }

    // 4. Frames validation (structure only — content is judged by the engine)
    const frames = body.frames;
    if (
      !Array.isArray(frames) ||
      frames.length < MIN_FRAMES ||
      frames.length > MAX_FRAMES ||
      frames.some((f) => typeof f !== "string" || f.length < 64 || f.length > 4 * 1024 * 1024)
    ) {
      return NextResponse.json(
        invalidPayload(`frames must be ${MIN_FRAMES}-${MAX_FRAMES} base64 images`),
        { status: 400 }
      );
    }

    // 5. Date window (business rule — unchanged from the previous system)
    const date =
      typeof body.date === "string" && isValidDateKey(body.date) ? body.date : dateKey();
    if (auth.user.role === "STUDENT" && Math.abs(dayDiff(date, dateKey())) > 1) {
      return NextResponse.json(invalidPayload("students can only check in for today"), {
        status: 400,
      });
    }

    // 6. Mode + identity binding
    const mode = auth.user.role === "ADMIN" ? "KIOSK" : "SELF";
    const selfStudentId: string | undefined =
      auth.user.role === "STUDENT" ? auth.user.studentId : undefined;
    if (mode === "SELF") {
      // Anti-replay: exactly one verification attempt per challenge, consumed
      // atomically BEFORE any biometric work.
      const challengeId =
        typeof body.challengeId === "string" && body.challengeId.length <= 512
          ? body.challengeId
          : null;
      if (!challengeId) {
        return NextResponse.json(
          { success: false, verified: false, reason: "CHALLENGE_REQUIRED" },
          { status: 422 }
        );
      }
      const consumed = await db.faceChallenge.updateMany({
        where: {
          id: challengeId,
          studentId: selfStudentId,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        auditBiometric("verify.challenge_failed", { identity: identityKey });
        return NextResponse.json(
          { success: false, verified: false, reason: "CHALLENGE_FAILED" },
          { status: 422 }
        );
      }
    }

    // 7. GPS decision (business rule; coordinates persisted as provided)
    const gps = validateGps(body.gps);

    // 8. THE BIOMETRIC DECISION — real server-side CV
    const started = Date.now();
    const result: VerifyOk | BiometricRejection = await verifyFrames(
      frames as string[],
      mode,
      selfStudentId
    );
    const elapsedMs = Date.now() - started;

    if (!result.ok) {
      auditBiometric("verify.rejected", {
        identity: identityKey,
        mode,
        code: result.code,
        detail: result.detail,
        ms: elapsedMs,
      });
      return NextResponse.json(
        {
          success: false,
          verified: false,
          reason: result.code,
          error: result.detail,
          quality: result.quality,
          liveness: result.liveness,
        },
        { status: 422 }
      );
    }

    const qualityMean = result.quality_mean;
    const livenessScore = result.liveness.score;

    if (!result.matched || !result.student_id) {
      auditBiometric("verify.no_match", {
        identity: identityKey,
        mode,
        similarity: result.similarity,
        band: result.band,
        liveness: result.liveness.label,
        ms: elapsedMs,
      });
      return NextResponse.json({
        success: false,
        verified: false,
        reason: "FACE_MISMATCH",
        similarity: result.similarity,
        confidenceBand: result.band,
        qualityScore: qualityMean,
        livenessScore,
      });
    }

    // 9. Ambiguity policy — medium band needs a second confirming scan
    if (result.band === "medium") {
      const confirmed = mediumBandConfirmation(identityKey, result.student_id, body.confirmFor as string | undefined);
      if (!confirmed) {
        auditBiometric("verify.pending_confirmation", {
          identity: identityKey,
          mode,
          similarity: result.similarity,
          band: result.band,
        });
        return NextResponse.json({
          success: true,
          verified: false,
          reason: "MATCH_PENDING_CONFIRMATION",
          requiresConfirmation: true,
          student: await studentBrief(result.student_id),
          similarity: result.similarity,
          confidenceBand: result.band,
          qualityScore: qualityMean,
          livenessScore,
        });
      }
    }

    const student = await studentBrief(result.student_id);
    if (!student) {
      return NextResponse.json(
        { success: false, verified: false, reason: "BIOMETRIC_NOT_ENROLLED", error: "student no longer exists" },
        { status: 422 }
      );
    }

    // 10. Duplicate-day rule (idempotent attendance)
    const existing = await db.attendance.findUnique({
      where: { studentId_date: { studentId: student.studentId, date } },
    });
    if (existing) {
      await touchLastVerified(student.studentId);
      auditBiometric("verify.already_marked", {
        identity: identityKey,
        mode,
        studentId: student.studentId,
        date,
      });
      return NextResponse.json({
        success: true,
        verified: true,
        reason: "ALREADY_MARKED",
        already: true,
        student,
        record: toAttendanceDTO(existing),
      });
    }

    // 11. GPS fail-closed gate (only when required by deployment)
    if (gpsRequired() && !gps.valid) {
      auditBiometric("verify.gps_blocked", {
        identity: identityKey,
        mode,
        reason: gps.reason,
        studentId: student.studentId,
      });
      return NextResponse.json(
        {
          success: false,
          verified: false,
          reason: gps.reason,
          error: "A valid GPS fix is required for attendance in this deployment.",
          locationValid: false,
          locationReason: gps.reason,
        },
        { status: 422 }
      );
    }

    // 12. Persist attendance with SERVER-STAMPED proof flags
    const record = await db.attendance.create({
      data: {
        studentId: student.studentId,
        date,
        status: "PRESENT",
        method: "FACE",
        markedBy: mode === "SELF" ? "STUDENT" : "ADMIN",
        checkInAt: new Date(),
        latitude: gps.stored.latitude,
        longitude: gps.stored.longitude,
        gpsAccuracy: gps.stored.gpsAccuracy,
        faceVerified: true,
        livenessVerified: true,
        verificationId: randomUUID(),
      },
    });
    await touchLastVerified(student.studentId);

    auditBiometric("verify.accepted", {
      identity: identityKey,
      mode,
      studentId: student.studentId,
      similarity: result.similarity,
      band: result.band,
      liveness: result.liveness.label,
      livenessScore,
      qualityMean,
      gps: gps.reason,
      ms: elapsedMs,
    });

    return NextResponse.json({
      success: true,
      verified: true,
      reason: "MATCH_CONFIRMED",
      student,
      record: toAttendanceDTO(record),
      similarity: result.similarity,
      confidenceBand: result.band,
      qualityScore: qualityMean,
      livenessScore,
      locationValid: gps.valid,
      locationReason: gps.reason,
    });
  } catch (e) {
    return handleError(e);
  }
}

async function studentBrief(studentId: string) {
  const s = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, rollNumber: true, studentClass: true, active: true },
  });
  if (!s || !s.active) return null;
  return { studentId: s.id, name: s.name, rollNumber: s.rollNumber, class: s.studentClass };
}

async function touchLastVerified(studentId: string) {
  await db.faceProfile.updateMany({
    where: { studentId, status: "ACTIVE" },
    data: { lastVerifiedAt: new Date() },
  });
}
