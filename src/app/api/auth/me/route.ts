import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/sas/auth";
import { handleError } from "@/lib/sas/api-helpers";
import type { MeResponse } from "@/lib/sas/types";

/**
 * GET /api/auth/me
 * Response contract (consumed by src/lib/sas/client.ts and page.tsx):
 *   { user: MeResponse | null }  — `user` is null when not authenticated.
 * Authentication is resolved from the Authorization: Bearer header or the
 * httpOnly session cookie (see resolveAuth).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json<{ user: null }>({ user: null }, { status: 200 });
    }

    if (user.role === "ADMIN") {
      return NextResponse.json<{ user: MeResponse }>({
        user: { role: "ADMIN", name: user.name, email: user.email },
      });
    }
    return NextResponse.json<{ user: MeResponse }>({
      user: {
        role: "STUDENT",
        name: user.name,
        email: user.email,
        studentId: user.studentId,
        rollNumber: user.rollNumber,
        class: user.studentClass,
        faceRegistered: user.faceRegistered,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
