import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { auditBiometric } from "@/lib/biometric/security";

import type { FaceStatusResponse } from "@/lib/sas/types";

/**
 * GET /api/admin/students/[id]/face — biometric status metadata ONLY (never the template).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, "ADMIN");
    const { id } = await ctx.params;

    const student = await db.student.findUnique({
      where: { id },
      include: { faceProfile: true },
    });
    if (!student) return apiError(404, "Student not found.");

    if (!student.faceProfile || student.faceProfile.status !== "ACTIVE") {
      return NextResponse.json<FaceStatusResponse>({ enrolled: false });
    }

    const p = student.faceProfile;
    return NextResponse.json<FaceStatusResponse>({
      enrolled: true,
      status: p.status,
      samples: p.samples,
      qualityScore: p.qualityScore,
      livenessMethod: p.livenessMethod,
      modelName: p.modelName,
      modelVersion: p.modelVersion,
      embeddingVersion: p.embeddingVersion,
      embeddingDimension: p.embeddingDimension,
      enrolledAt: p.enrolledAt.toISOString(),
      lastVerifiedAt: p.lastVerifiedAt ? p.lastVerifiedAt.toISOString() : null,
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * DELETE /api/admin/students/[id]/face — ADMIN-only revocation.
 * Hard-deletes the biometric template and clears the enrollment flag.
 * Attendance history and identity data are untouched.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireRole(req, "ADMIN");
    const { id } = await ctx.params;

    const student = await db.student.findUnique({ where: { id } });
    if (!student) return apiError(404, "Student not found.");

    await db.$transaction(async (tx) => {
      await tx.faceProfile.deleteMany({ where: { studentId: id } });
      await tx.faceChallenge.deleteMany({ where: { studentId: id } });
      await tx.student.update({ where: { id }, data: { faceRegistered: false } });
    });

    auditBiometric("profile.deleted", { adminId: admin.adminId, studentId: id });
    return NextResponse.json({ ok: true, faceRegistered: false });
  } catch (e) {
    return handleError(e);
  }
}
