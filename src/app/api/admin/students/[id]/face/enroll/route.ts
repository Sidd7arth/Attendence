import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import {
  enrollFrames,
  MAX_FRAMES,
  MIN_FRAMES,
  MAX_BIOMETRIC_BODY_BYTES,
  type EnrollOk,
  type BiometricRejection,
} from "@/lib/biometric/client";
import { enrollLimiter, consumeNonce, TIMESTAMP_WINDOW_MS, auditBiometric } from "@/lib/biometric/security";

/**
 * POST /api/admin/students/[id]/face/enroll — ADMIN-only biometric enrollment.
 *
 * Frames are forwarded to the Python engine which performs the REAL
 * pipeline (detection → exactly-one-face → quality → alignment → liveness →
 * SFace embedding). On success the returned template is persisted here with
 * server-stamped model metadata. A student with an ACTIVE profile must use
 * re-enroll instead (409).
 */

interface EnrollBody {
  frames?: unknown;
  nonce?: unknown;
  timestamp?: unknown;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole(req, "ADMIN");

    if (!enrollLimiter.allow(`ADMIN:${admin.adminId}`)) {
      auditBiometric("enroll.rate_limited", { adminId: admin.adminId });
      return apiError(429, "Too many enrollment attempts. Wait a moment.");
    }

    const raw = await req.text();
    if (raw.length > MAX_BIOMETRIC_BODY_BYTES) {
      return apiError(413, "Payload too large.");
    }
    let body: EnrollBody;
    try {
      body = JSON.parse(raw) as EnrollBody;
    } catch {
      return apiError(400, "Invalid JSON body.");
    }

    // Anti-replay: single-use nonce + ±120s timestamp freshness.
    const nonce = typeof body.nonce === "string" && body.nonce.length >= 8 && body.nonce.length <= 64 ? body.nonce : null;
    const ts = typeof body.timestamp === "number" ? body.timestamp : null;
    if (!nonce || ts === null || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
      return NextResponse.json(
        { ok: false, code: "REPLAY_REJECTED", error: "Stale or missing capture attestation." },
        { status: 422 }
      );
    }
    if (!consumeNonce(nonce)) {
      return NextResponse.json(
        { ok: false, code: "REPLAY_REJECTED", error: "Duplicate capture attestation." },
        { status: 422 }
      );
    }

    const frames = body.frames;
    if (
      !Array.isArray(frames) ||
      frames.length < MIN_FRAMES ||
      frames.length > MAX_FRAMES ||
      frames.some((f) => typeof f !== "string" || f.length < 64 || f.length > 4 * 1024 * 1024)
    ) {
      return apiError(400, `frames must be ${MIN_FRAMES}-${MAX_FRAMES} base64 images.`);
    }

    const { id } = await ctx.params;
    const student = await db.student.findUnique({ where: { id } });
    if (!student) return apiError(404, "Student not found.");
    if (!student.active) return apiError(400, "Student account is inactive.");

    const existing = await db.faceProfile.findUnique({ where: { studentId: id } });
    if (existing && existing.status === "ACTIVE") {
      return NextResponse.json(
        {
          ok: false,
          code: "ALREADY_ENROLLED",
          error: "An active biometric profile exists. Use re-enroll to replace it.",
        },
        { status: 409 }
      );
    }

    // Real biometric computation (Python engine).
    const result: EnrollOk | BiometricRejection = await enrollFrames(frames as string[]);
    if (!result.ok) {
      auditBiometric("enroll.rejected", { adminId: admin.adminId, studentId: id, code: result.code });
      return NextResponse.json(
        {
          ok: false,
          code: result.code,
          error: result.detail,
          quality: result.quality,
          liveness: result.liveness,
        },
        { status: 422 }
      );
    }

    // Persist the template (single authoritative DB, via Prisma).
    const saved = await db.$transaction(async (tx) => {
      const profile = await tx.faceProfile.upsert({
        where: { studentId: id },
        create: {
          studentId: id,
          embedding: JSON.stringify(result.embedding),
          embeddingDimension: result.embedding_dim,
          samples: result.samples_used,
          modelName: result.model.name,
          modelVersion: result.model.version,
          embeddingVersion: result.model.embedding_version,
          qualityScore: result.quality_mean,
          livenessMethod: result.liveness.model,
          status: "ACTIVE",
          enrolledAt: new Date(),
        },
        update: {
          embedding: JSON.stringify(result.embedding),
          embeddingDimension: result.embedding_dim,
          samples: result.samples_used,
          modelName: result.model.name,
          modelVersion: result.model.version,
          embeddingVersion: result.model.embedding_version,
          qualityScore: result.quality_mean,
          livenessMethod: result.liveness.model,
          status: "ACTIVE",
          enrolledAt: new Date(),
          lastVerifiedAt: null,
        },
      });
      await tx.student.update({ where: { id }, data: { faceRegistered: true } });
      return profile;
    });

    auditBiometric("enroll.accepted", {
      adminId: admin.adminId,
      studentId: id,
      samples: saved.samples,
      qualityMean: result.quality_mean,
      liveness: result.liveness.score,
      model: result.model.name,
    });

    return NextResponse.json({
      ok: true,
      faceRegistered: true,
      samples: saved.samples,
      qualityMean: result.quality_mean,
      liveness: result.liveness,
      model: {
        name: result.model.name,
        version: result.model.version,
        embeddingVersion: result.model.embedding_version,
        embeddingDim: result.embedding_dim,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
