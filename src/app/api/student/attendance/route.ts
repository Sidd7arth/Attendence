import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { dateKey, dayDiff, isValidDateKey } from "@/lib/sas/dates";
import { toAttendanceDTO } from "@/lib/sas/dto";
import type { AttendanceDTO, StudentHistory } from "@/lib/sas/types";

/** GET — my attendance history + stats (+ today's record) */
export async function GET(req: NextRequest) {
  try {
    const user = await requireRole(req, "STUDENT");
    const today = req.nextUrl.searchParams.get("today") || "";

    const records = await db.attendance.findMany({
      where: { studentId: user.studentId },
      orderBy: [{ date: "desc" }],
    });

    const stats = { totalDays: records.length, present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of records) {
      if (r.status === "PRESENT") stats.present++;
      else if (r.status === "ABSENT") stats.absent++;
      else if (r.status === "LATE") stats.late++;
      else if (r.status === "EXCUSED") stats.excused++;
    }

    // consecutive attended days from the most recent record backwards
    let streak = 0;
    for (const r of records) {
      if (r.status === "PRESENT" || r.status === "LATE") streak++;
      else break;
    }

    const history: StudentHistory = {
      today: today ? (() => {
        const rec = records.find((r) => r.date === today);
        return rec ? toAttendanceDTO(rec) : null;
      })() : null,
      records: records.slice(0, 60).map(toAttendanceDTO),
      stats: {
        ...stats,
        rate: stats.totalDays === 0 ? 0 : Math.round(((stats.present + stats.late) / stats.totalDays) * 100),
        streak,
      },
    };

    return NextResponse.json(history);
  } catch (e) {
    return handleError(e);
  }
}

/** POST — student marks their OWN attendance for today only */
interface MarkBody {
  date?: string;
  status?: "PRESENT" | "LATE";
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(req, "STUDENT");
    const b = await readJson<MarkBody>(req);

    // "Today only" contract: strict key validation, then a ±1-day window
    // around the server's date (tolerates client/server timezone skew, e.g. a
    // student at 00:30 IST vs a UTC server) while blocking back-dating and
    // future pre-marking.
    if (!b.date || !isValidDateKey(b.date)) {
      return apiError(400, "A valid date (YYYY-MM-DD) is required.");
    }
    if (Math.abs(dayDiff(b.date, dateKey())) > 1) {
      return apiError(400, "Students can only mark attendance for today.");
    }
    const status = b.status === "LATE" ? "LATE" : "PRESENT";

    const existing = await db.attendance.findUnique({
      where: { studentId_date: { studentId: user.studentId, date: b.date } },
    });
    if (existing) {
      return NextResponse.json<AttendanceDTO>(toAttendanceDTO(existing), { status: 200 });
    }

    const rec = await db.attendance.create({
      data: {
        studentId: user.studentId,
        date: b.date,
        status,
        markedBy: "STUDENT",
        method: "SELF",
        checkInAt: new Date(),
      },
    });

    return NextResponse.json<AttendanceDTO>(toAttendanceDTO(rec));
  } catch (e) {
    return handleError(e);
  }
}
