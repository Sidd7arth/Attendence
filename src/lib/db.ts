import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function getDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return url;
  const rawPath = url.replace(/^file:/, "").trim();
  if (path.isAbsolute(rawPath)) {
    return `file:${rawPath.replace(/\\/g, "/")}`;
  }
  const cand1 = path.resolve(/*turbopackIgnore: true*/ process.cwd(), rawPath);
  if (fs.existsSync(cand1)) {
    return `file:${cand1.replace(/\\/g, "/")}`;
  }
  const cand2 = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "prisma", rawPath);
  if (fs.existsSync(cand2)) {
    return `file:${cand2.replace(/\\/g, "/")}`;
  }
  return `file:${cand1.replace(/\\/g, "/")}`;
}

const resolvedUrl = getDatabaseUrl();
if (resolvedUrl) {
  process.env.DATABASE_URL = resolvedUrl;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: resolvedUrl ? { db: { url: resolvedUrl } } : undefined,
    log: ["query"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;