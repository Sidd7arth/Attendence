import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/sas/auth";
import { handleError } from "@/lib/sas/api-helpers";

export async function POST(req: NextRequest) {
  try {
    await destroySession(req);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
