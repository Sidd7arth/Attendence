import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { toAttendanceDTO } from "@/lib/sas/dto";

// GET /api/admin/students/[id]/attendance — full attendance history for one student (ADMIN).
// ?limit= clamps the number of records (default 120, max 365).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req, "ADMIN");
    const { id } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const limit = Math.min(365, Math.max(1, parseInt(searchParams.get("limit") ?? "120", 10) || 120));

    const student = await db.student.findUnique({ where: { id }, select: { id: true } });
    if (!student) return apiError(404, "Student not found.");

    const records = await db.attendance.findMany({
      where: { studentId: id },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({ records: records.map(toAttendanceDTO) });
  } catch (e) {
    return handleError(e);
  }
}
