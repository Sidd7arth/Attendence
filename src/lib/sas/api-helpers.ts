/** Shared helpers for API route handlers. */
import { NextResponse } from "next/server";
import { AuthError } from "./auth";

export function apiError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function handleError(e: unknown) {
  if (e instanceof AuthError) return apiError(e.status, e.message);
  if (e instanceof Error) {
    // Prisma unique constraint
    if (e.message.includes("Unique constraint")) {
      return apiError(409, "A record with that unique value already exists.");
    }
    console.error("[api]", e.message);
    return apiError(500, "Internal server error");
  }
  return apiError(500, "Unknown error");
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError(400, "Invalid JSON body");
  }
}
