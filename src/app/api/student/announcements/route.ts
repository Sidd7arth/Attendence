import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import type { StudentAnnouncementDTO } from "@/lib/sas/types";

/** GET — announcements for me (all-school or my class) with read flags */
export async function GET(req: NextRequest) {
  try {
    const user = await requireRole(req, "STUDENT");

    const [announcements, reads] = await Promise.all([
      db.announcement.findMany({
        where: {
          OR: [{ targetClass: null }, { targetClass: user.studentClass }],
        },
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { name: true } }, reads: { select: { studentId: true } } },
      }),
      db.announcementRead.findMany({
        where: { studentId: user.studentId },
        select: { announcementId: true, readAt: true },
      }),
    ]);

    const readSet = new Set(reads.map((r) => r.announcementId));

    const dto: StudentAnnouncementDTO[] = announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      targetClass: a.targetClass,
      priority: a.priority as "NORMAL" | "HIGH",
      adminName: a.admin.name,
      createdAt: a.createdAt.toISOString(),
      readCount: a.reads.length,
      totalTargets: 0,
      read: readSet.has(a.id),
    }));

    return NextResponse.json({
      announcements: dto,
      unread: dto.filter((a) => !a.read).length,
    });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — mark an announcement as read */
interface ReadBody {
  announcementId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireRole(req, "STUDENT");
    const b = await readJson<ReadBody>(req);
    if (!b.announcementId) return apiError(400, "announcementId is required.");

    await db.announcementRead.upsert({
      where: {
        announcementId_studentId: {
          announcementId: b.announcementId,
          studentId: user.studentId,
        },
      },
      create: { announcementId: b.announcementId, studentId: user.studentId },
      update: {},
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
