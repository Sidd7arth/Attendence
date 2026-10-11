import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import type { AnnouncementDTO } from "@/lib/sas/types";

/** GET — all announcements with read counts */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const [announcements, students] = await Promise.all([
      db.announcement.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          admin: { select: { name: true } },
          reads: { select: { id: true } },
        },
      }),
      db.student.findMany({ where: { active: true }, select: { studentClass: true } }),
    ]);

    const dto: AnnouncementDTO[] = announcements.map((a) => ({
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

    return NextResponse.json({ announcements: dto });
  } catch (e) {
    return handleError(e);
  }
}

/** POST — compose & send announcement */
interface CreateBody {
  title?: string;
  content?: string;
  targetClass?: string | null;
  priority?: "NORMAL" | "HIGH";
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireRole(req, "ADMIN");
    const b = await readJson<CreateBody>(req);

    if (!b.title?.trim() || !b.content?.trim()) {
      return apiError(400, "Title and content are required.");
    }

    const a = await db.announcement.create({
      data: {
        title: b.title.trim(),
        content: b.content.trim(),
        targetClass: b.targetClass?.trim() || null,
        priority: b.priority === "HIGH" ? "HIGH" : "NORMAL",
        adminId: admin.role === "ADMIN" ? admin.adminId : "",
      },
    });

    return NextResponse.json({ id: a.id, ok: true });
  } catch (e) {
    return handleError(e);
  }
}
