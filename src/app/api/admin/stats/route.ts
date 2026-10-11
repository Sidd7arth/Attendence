import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { handleError } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { dateKey } from "@/lib/sas/dates";
import type { AdminStatsDTO, AnnouncementDTO, ClassStat, TrendPoint } from "@/lib/sas/types";

function lastNDays(n: number, clientToday: string): string[] {
  const [y, m, d] = clientToday.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    keys.push(`${yy}-${mm}-${dd}`);
  }
  return keys;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const today = req.nextUrl.searchParams.get("date") || dateKey();

    const [students, dayRecords, recent, topAbsentees] = await Promise.all([
      db.student.findMany({ where: { active: true }, select: { id: true, studentClass: true } }),
      db.attendance.findMany({ where: { date: today } }),
      db.announcement.findMany({
        orderBy: { createdAt: "desc" },
        take: 4,
        include: { admin: { select: { name: true } }, reads: { select: { id: true } } },
      }),
      db.student.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          rollNumber: true,
          studentClass: true,
          attendances: {
            where: { status: { in: ["ABSENT"] } },
            select: { id: true },
          },
        },
      }),
    ]);

    const byStatus = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
    for (const r of dayRecords) {
      if (r.status in byStatus) byStatus[r.status as keyof typeof byStatus]++;
    }
    const marked = dayRecords.length;
    const attended = byStatus.PRESENT + byStatus.LATE;

    // 14-day trend
    const trendKeys = lastNDays(14, today);
    const trendRecords = await db.attendance.findMany({
      where: { date: { in: trendKeys } },
      select: { date: true, status: true },
    });
    const trendMap = new Map<string, TrendPoint>();
    for (const k of trendKeys) {
      trendMap.set(k, { date: k, present: 0, late: 0, absent: 0, excused: 0, rate: 0 });
    }
    for (const r of trendRecords) {
      const point = trendMap.get(r.date);
      if (!point) continue;
      if (r.status === "PRESENT") point.present++;
      else if (r.status === "LATE") point.late++;
      else if (r.status === "ABSENT") point.absent++;
      else if (r.status === "EXCUSED") point.excused++;
    }
    for (const p of trendMap.values()) {
      const total = p.present + p.late + p.absent + p.excused;
      p.rate = total === 0 ? 0 : Math.round(((p.present + p.late) / total) * 100);
    }

    // class-wise breakdown for today
    const classSet = Array.from(new Set(students.map((s) => s.studentClass))).sort();
    const recordByStudent = new Map(dayRecords.map((r) => [r.studentId, r]));
    const classes: ClassStat[] = classSet.map((cls) => {
      const list = students.filter((s) => s.studentClass === cls);
      let present = 0;
      for (const s of list) {
        const r = recordByStudent.get(s.id);
        if (r && (r.status === "PRESENT" || r.status === "LATE")) present++;
      }
      return { class: cls, total: list.length, present, rate: list.length === 0 ? 0 : Math.round((present / list.length) * 100) };
    });

    const announcements: AnnouncementDTO[] = recent.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      targetClass: a.targetClass,
      priority: a.priority as "NORMAL" | "HIGH",
      adminName: a.admin.name,
      createdAt: a.createdAt.toISOString(),
      readCount: a.reads.length,
      totalTargets: a.targetClass
        ? students.filter((s) => s.studentClass === a.targetClass).length
        : students.length,
    }));

    const absences = topAbsentees
      .map((s) => ({ studentId: s.id, name: s.name, rollNumber: s.rollNumber, class: s.studentClass, absences: s.attendances.length }))
      .sort((a, b) => b.absences - a.absences)
      .filter((s) => s.absences > 0)
      .slice(0, 5);

    const stats: AdminStatsDTO = {
      totals: {
        students: students.length,
        present: byStatus.PRESENT,
        absent: byStatus.ABSENT,
        late: byStatus.LATE,
        excused: byStatus.EXCUSED,
        unmarked: Math.max(0, students.length - marked),
        rate: marked === 0 ? 0 : Math.round((attended / marked) * 100),
      },
      trend: trendKeys.map((k) => trendMap.get(k)!),
      classes,
      recentAnnouncements: announcements,
      topAbsentees: absences,
    };

    return NextResponse.json(stats);
  } catch (e) {
    return handleError(e);
  }
}
