import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/sas/auth";
import { db } from "@/lib/db";
import { apiError, handleError, readJson } from "@/lib/sas/api-helpers";
import type { LoginResponse } from "@/lib/sas/types";

interface LoginBody {
  role: "ADMIN" | "STUDENT";
  email?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJson<LoginBody>(req);
    const { role, email, password } = body;

    if (!role || !email?.trim() || !password) {
      return apiError(400, "Email and password are required.");
    }

    if (role === "ADMIN") {
      const admin = await db.admin.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (!admin || !verifyPassword(password, admin.passwordHash)) {
        return apiError(401, "Invalid admin credentials.");
      }
      const token = await createSession("ADMIN", admin.id);
      return NextResponse.json<LoginResponse>({
        user: { role: "ADMIN", name: admin.name, email: admin.email },
        token,
      });
    }

    const student = await db.student.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!student || !student.active || !verifyPassword(password, student.passwordHash)) {
      return apiError(401, "Invalid student credentials.");
    }
    const token = await createSession("STUDENT", student.id);
    return NextResponse.json<LoginResponse>({
      user: {
        role: "STUDENT",
        name: student.name,
        email: student.email,
        studentId: student.id,
        rollNumber: student.rollNumber,
        class: student.studentClass,
        faceRegistered: student.faceRegistered,
      },
      token,
    });
  } catch (e) {
    return handleError(e);
  }
}
