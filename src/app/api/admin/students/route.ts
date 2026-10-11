import { NextRequest, NextResponse } from "next/server";
import { requireRole, hashPassword } from "@/lib/sas/auth";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import { db } from "@/lib/db";
import { toStudentDTO } from "@/lib/sas/dto";
import type { Prisma } from "@prisma/client";
import type { StudentDTO } from "@/lib/sas/types";

// GET /api/admin/students — full list, or search + pagination via query params:
//   ?search=<text>  matches name / rollNumber / email (case-insensitive)
//   ?page=1&limit=20  (limit clamped 1–100; omit both to return every student)
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const where: Prisma.StudentWhereInput = search
      ? {
          OR: [
            { name: { contains: search } },
            { rollNumber: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    // Pagination is optional — when neither page nor limit is provided the
    // legacy full-list shape is preserved for existing clients.
    const wantsPagination = pageParam !== null || limitParam !== null;
    const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitParam ?? "20", 10) || 20));

    const findManyArgs: Prisma.StudentFindManyArgs = {
      where,
      orderBy: [{ studentClass: "asc" }, { rollNumber: "asc" }],
      ...(wantsPagination ? { skip: (page - 1) * limit, take: limit } : {}),
    };

    const [students, total] = await Promise.all([
      db.student.findMany(findManyArgs),
      db.student.count({ where }),
    ]);
    const dto: StudentDTO[] = students.map(toStudentDTO);
    return NextResponse.json({ students: dto, total, page, limit });
  } catch (e) {
    return handleError(e);
  }
}

interface CreateBody {
  name?: string;
  rollNumber?: string;
  email?: string;
  class?: string;
  phone?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const b = await readJson<CreateBody>(req);

    if (!b.name?.trim() || !b.rollNumber?.trim() || !b.email?.trim() || !b.class?.trim()) {
      return apiError(400, "Name, roll number, email and class are required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) {
      return apiError(400, "A valid email address is required.");
    }
    const password = b.password?.trim() || "Student@123";
    if (password.length < 6) {
      return apiError(400, "Password must be at least 6 characters.");
    }

    const student = await db.student.create({
      data: {
        name: b.name.trim(),
        rollNumber: b.rollNumber.trim().toUpperCase(),
        email: b.email.trim().toLowerCase(),
        studentClass: b.class.trim(),
        phone: b.phone?.trim() || null,
        passwordHash: hashPassword(password),
      },
    });

    return NextResponse.json({
      student: {
        studentId: student.id,
        name: student.name,
        rollNumber: student.rollNumber,
        class: student.studentClass,
        email: student.email,
        phone: student.phone,
        active: student.active,
        faceRegistered: student.faceRegistered,
        createdAt: student.createdAt.toISOString(),
      } satisfies StudentDTO,
      credentials: { email: student.email, password },
    });
  } catch (e) {
    return handleError(e);
  }
}
