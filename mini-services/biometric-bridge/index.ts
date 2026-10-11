/**
 * Biometric bridge — production supervisor for the Python FastAPI service.
 *
 * Why this exists: the deployment's start.sh launches Next.js (bun) and
 * mini-service bundles (bun), plus Caddy. Python sources and dependencies
 * ARE packaged (python-runtime-build.sh installs requirements into
 * python-runtime/site-packages and copies *.py into next-service-dist,
 * preserving relative paths) — but nothing would LAUNCH the Python process.
 * This tiny bun service fills that gap in every environment:
 *
 *   dev  : biometric-service/ at the repo root
 *   prod : next-service-dist/biometric-service/ (PYTHONPATH set by start.sh)
 *
 * It is idempotent: if a biometric service already answers /health on the
 * target port (e.g. a manually started uvicorn during development), the
 * bridge stays idle and simply watches.
 *
 * The bridge itself performs NO biometric logic.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.BIOMETRIC_PORT ?? 3010);
const HOST = process.env.BIOMETRIC_HOST ?? "127.0.0.1";
const HEALTH = `http://${HOST}:${PORT}/health`;

const here = dirname(fileURLToPath(import.meta.url));

/** Candidate app dirs, in priority order (prod layout first). */
const candidateAppDirs = [
  resolve(here, "../../next-service-dist/biometric-service"),
  resolve(here, "../../biometric-service"),
];

function findAppDir(): string | null {
  for (const dir of candidateAppDirs) {
    if (existsSync(join(dir, "app", "main.py"))) return dir;
  }
  return null;
}

async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function findPython(appDir: string): string {
  // 1. Dev venv inside the service dir (biometric-service/.venv).
  const venvPython = join(appDir, ".venv", "bin", "python3");
  // 2. Production: start.sh prepends python-runtime/site-packages/bin to PATH.
  const candidates = [venvPython, "python3", "python"];
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ["-c", "import uvicorn, fastapi, cv2, onnxruntime"], {
        encoding: "utf8",
        timeout: 15_000,
        stdio: "ignore",
      });
      if (probe.status === 0) return candidate;
    } catch {
      // keep probing
    }
  }
  return "python3";
}

let child: ReturnType<typeof spawn> | null = null;
let stopping = false;
let restarts = 0;

function launch(appDir: string): void {
  const python = findPython(appDir);
  console.log(`[biometric-bridge] launching ${python} -m uvicorn app.main:app in ${appDir}`);
  child = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", HOST, "--port", String(PORT), "--workers", "1"], {
    cwd: appDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      // production deps live here (harmless in dev)
      PYTHONPATH: ["/app/python-runtime/site-packages", process.env.PYTHONPATH].filter(Boolean).join(":"),
      BIOMETRIC_PORT: String(PORT),
      BIOMETRIC_HOST: HOST,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[biometric-bridge] service exited (code=${code} signal=${signal})`);
    restarts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(restarts, 5));
    console.log(`[biometric-bridge] restarting in ${delay}ms…`);
    setTimeout(() => {
      if (!stopping) launch(appDir);
    }, delay);
  });
}

async function main(): Promise<void> {
  console.log(`[biometric-bridge] watching ${HEALTH}`);

  if (await isHealthy()) {
    console.log("[biometric-bridge] biometric service already healthy — idle mode");
  } else {
    const appDir = findAppDir();
    if (!appDir) {
      console.error("[biometric-bridge] no biometric-service/app/main.py found — nothing to supervise");
    } else {
      launch(appDir);
    }
  }

  // Keep the bridge alive; probe periodically so a dead service without an
  // exit event (e.g. killed externally in dev) still gets revived.
  setInterval(async () => {
    if (stopping) return;
    if (child && child.exitCode !== null) return; // exit handler owns restart
    if (child && child.exitCode === null) {
      if (!(await isHealthy())) {
        console.warn("[biometric-bridge] process alive but /health failing — waiting");
      }
      return;
    }
    if (await isHealthy()) return;
    const appDir = findAppDir();
    if (appDir) launch(appDir);
  }, 15_000);
}

process.on("SIGTERM", () => {
  stopping = true;
  child?.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  stopping = true;
  child?.kill("SIGINT");
  process.exit(0);
});

void main();
