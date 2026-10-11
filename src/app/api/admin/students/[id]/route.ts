import { NextRequest, NextResponse } from "next/server";
import { requireRole, hashPassword } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { toStudentDTO } from "@/lib/sas/dto";

// GET /api/admin/students/[id] — single student (profile fields only; never biometric data).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, "ADMIN");
    const { id } = await ctx.params;
    const student = await db.student.findUnique({ where: { id } });
    if (!student) return apiError(404, "Student not found.");
    return NextResponse.json({ student: toStudentDTO(student) });
  } catch (e) {
    return handleError(e);
  }
}

interface UpdateBody {
  name?: string;
  rollNumber?: string;
  email?: string;
  class?: string;
  phone?: string | null;
  active?: boolean;
  password?: string;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, "ADMIN");
    const { id } = await ctx.params;
    const b = await readJson<UpdateBody>(req);

    const existing = await db.student.findUnique({ where: { id } });
    if (!existing) return apiError(404, "Student not found.");

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name.trim();
    if (b.rollNumber !== undefined) data.rollNumber = b.rollNumber.trim().toUpperCase();
    if (b.email !== undefined) {
      const email = b.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return apiError(400, "A valid email address is required.");
      }
      data.email = email;
    }
    if (b.class !== undefined) data.studentClass = b.class.trim();
    if (b.phone !== undefined) data.phone = b.phone?.trim() || null;
    if (b.active !== undefined) data.active = b.active;
    if (b.password !== undefined && b.password.trim() !== "") {
      if (b.password.trim().length < 6) return apiError(400, "Password must be at least 6 characters.");
      data.passwordHash = hashPassword(b.password.trim());
    }

    await db.student.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, "ADMIN");
    const { id } = await ctx.params;
    await db.student.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
