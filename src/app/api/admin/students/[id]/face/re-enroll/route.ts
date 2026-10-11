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
 * POST /api/admin/students/[id]/face/re-enroll — ADMIN-only biometric
 * re-enrollment. Replaces an existing template (revoking the old one first)
 * with a freshly captured, live-verified template. Only biometric-domain
 * data is touched; identity and attendance history are preserved.
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
      auditBiometric("re-enroll.rate_limited", { adminId: admin.adminId });
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

    const previous = await db.faceProfile.findUnique({ where: { studentId: id } });
    if (!previous || previous.status !== "ACTIVE") {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_ENROLLED",
          error: "No active biometric profile to re-enroll. Use enroll instead.",
        },
        { status: 409 }
      );
    }

    const result: EnrollOk | BiometricRejection = await enrollFrames(frames as string[]);
    if (!result.ok) {
      auditBiometric("re-enroll.rejected", { adminId: admin.adminId, studentId: id, code: result.code });
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

    const saved = await db.$transaction(async (tx) => {
      // Revoke the old template first (traceability), then write the new one.
      await tx.faceProfile.update({ where: { studentId: id }, data: { status: "REVOKED" } });
      // Enforce the 1:1 constraint: only one row per student — the revoked
      // row is hard-deleted after revocation is recorded in the audit log.
      await tx.faceProfile.delete({ where: { studentId: id } });
      const profile = await tx.faceProfile.create({
        data: {
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
          lastVerifiedAt: null,
        },
      });
      await tx.student.update({ where: { id }, data: { faceRegistered: true } });
      return profile;
    });

    auditBiometric("re-enroll.accepted", {
      adminId: admin.adminId,
      studentId: id,
      replacedModel: previous.modelName,
      samples: saved.samples,
      qualityMean: result.quality_mean,
      liveness: result.liveness.score,
      model: result.model.name,
    });

    return NextResponse.json({
      ok: true,
      faceRegistered: true,
      replaced: true,
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
