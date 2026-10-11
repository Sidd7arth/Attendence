import fs from "node:fs";
import path from "node:path";

const standaloneDir = path.resolve(".next/standalone");
const staticSrc = path.resolve(".next/static");
const staticDest = path.resolve(".next/standalone/.next/static");
const publicSrc = path.resolve("public");
const publicDest = path.resolve(".next/standalone/public");

if (fs.existsSync(standaloneDir)) {
  if (fs.existsSync(staticSrc)) {
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true });
    console.log("[copy-standalone] Copied .next/static to standalone folder.");
  }
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true });
    console.log("[copy-standalone] Copied public/ to standalone folder.");
  }
} else {
  console.log("[copy-standalone] .next/standalone does not exist; skipping asset copy.");
}
