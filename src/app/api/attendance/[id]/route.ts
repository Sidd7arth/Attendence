import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/sas/auth";
import { apiError, handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { toAttendanceDTO } from "@/lib/sas/dto";

// GET /api/attendance/[id] — a single attendance record.
// Access: ADMIN (any record) or the STUDENT who owns the record.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuth(req);
    if (!auth.ok) return apiError(401, "Not authenticated.");

    const { id } = await ctx.params;
    const record = await db.attendance.findUnique({ where: { id } });
    if (!record) return apiError(404, "Attendance record not found.");

    if (auth.user.role === "STUDENT" && auth.user.studentId !== record.studentId) {
      return apiError(403, "Insufficient permissions.");
    }

    return NextResponse.json({ record: toAttendanceDTO(record) });
  } catch (e) {
    return handleError(e);
  }
}
