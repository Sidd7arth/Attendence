import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { dateKey, ATTENDANCE_STATUSES } from "@/lib/sas/dates";
import { toStudentDTO, toAttendanceDTO } from "@/lib/sas/dto";
import type { RosterRow } from "@/lib/sas/types";

/** GET /api/admin/attendance?date=YYYY-MM-DD → full roster with attendance */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const date = req.nextUrl.searchParams.get("date") || dateKey();

    const [students, records] = await Promise.all([
      db.student.findMany({ orderBy: [{ studentClass: "asc" }, { rollNumber: "asc" }], where: { active: true } }),
      db.attendance.findMany({ where: { date } }),
    ]);

    const recMap = new Map(records.map((r) => [r.studentId, r]));
    const roster: RosterRow[] = students.map((s) => {
      const r = recMap.get(s.id);
      return { student: toStudentDTO(s), attendance: r ? toAttendanceDTO(r) : null };
    });

    return NextResponse.json({ date, roster });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — upsert a single attendance row */
interface UpsertBody {
  studentId?: string;
  date?: string;
  status?: string;
  note?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const b = await readJson<UpsertBody>(req);

    if (!b.studentId || !b.date || !b.status) {
      return apiError(400, "studentId, date and status are required.");
    }
    if (!ATTENDANCE_STATUSES.includes(b.status as never)) {
      return apiError(400, "Invalid status.");
    }

    const rec = await db.attendance.upsert({
      where: { studentId_date: { studentId: b.studentId, date: b.date } },
      create: {
        studentId: b.studentId,
        date: b.date,
        status: b.status,
        markedBy: "ADMIN",
        note: b.note ?? null,
      },
      update: {
        status: b.status,
        markedBy: "ADMIN",
        note: b.note ?? null,
      },
    });

    return NextResponse.json(toAttendanceDTO(rec));
  } catch (e) {
    return handleError(e);
  }
}

/** PUT — bulk mark: apply a status to many students (optionally only unmarked) */
interface BulkBody {
  date?: string;
  status?: string;
  studentIds?: string[];
  onlyUnmarked?: boolean;
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const b = await readJson<BulkBody>(req);

    if (!b.date || !b.status || !Array.isArray(b.studentIds)) {
      return apiError(400, "date, status and studentIds are required.");
    }
    if (!ATTENDANCE_STATUSES.includes(b.status as never)) {
      return apiError(400, "Invalid status.");
    }

    let ids = b.studentIds;
    if (b.onlyUnmarked) {
      const existing = await db.attendance.findMany({
        where: { date: b.date, studentId: { in: ids } },
        select: { studentId: true },
      });
      const done = new Set(existing.map((e) => e.studentId));
      ids = ids.filter((id) => !done.has(id));
    }

    await db.$transaction(
      ids.map((studentId) =>
        db.attendance.upsert({
          where: { studentId_date: { studentId, date: b.date! } },
          create: { studentId, date: b.date!, status: b.status!, markedBy: "ADMIN" },
          update: { status: b.status!, markedBy: "ADMIN" },
        })
      )
    );

    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    return handleError(e);
  }
}
