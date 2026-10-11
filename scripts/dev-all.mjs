#!/usr/bin/env node
/**
 * EduTrack — Windows Unified Development Launcher (npm run dev:all)
 *
 * Orchestrates and monitors:
 * 1. FastAPI Biometric Service (port 3010) with CPU ONNX models (YuNet, SFace, MiniFASNet)
 * 2. Next.js Frontend & API Gateway (port 3000)
 *
 * Features:
 * - Pre-flight port availability verification with process PID diagnostics
 * - Python virtual environment detection (prioritizes biometric-service/.venv313)
 * - Model file existence & integrity validation (public/biometric-models)
 * - Safe environment variable loading without printing secrets
 * - Health and readiness polling for ONNX model initialization
 * - Synchronized shared internal authentication token
 * - Unified log multiplexing with service tags
 * - Graceful Windows process tree cleanup (taskkill /F /T /PID) on Ctrl+C or crash
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const NEXT_PORT = parseInt(process.env.PORT || "3000", 10);
const FASTAPI_PORT = parseInt(process.env.BIOMETRIC_PORT || "3010", 10);
const FASTAPI_HOST = process.env.BIOMETRIC_HOST || "127.0.0.1";

// ANSI colors for clean console output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function log(tag, msg, color = colors.reset) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${colors.bold}[${tag}]${colors.reset} ${msg}`);
}

function errorLog(tag, msg) {
  const timestamp = new Date().toLocaleTimeString();
  console.error(`${colors.dim}[${timestamp}]${colors.reset} ${colors.red}${colors.bold}[${tag}] ERROR:${colors.reset} ${msg}`);
}

// ── 1. Secure Environment Variable Parsing ──────────────────────
function parseEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// ── 2. Port Conflict Detection & Diagnostics ────────────────────
async function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function canConnect(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function getPidHoldingPort(port) {
  if (process.platform !== "win32") return null;
  try {
    const stdout = execSync(`netstat -ano -p tcp`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const portRegex = new RegExp(`[:.]${port}\\s+.*LISTENING\\s+(\\d+)`, "i");
    for (const line of stdout.split("\n")) {
      const match = line.match(portRegex);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Ignore query errors
  }
  return null;
}

// ── 3. Python Virtual Environment Discovery ──────────────────────
function findPythonExecutable() {
  const isWin = process.platform === "win32";
  const pythonBin = isWin ? "Scripts/python.exe" : "bin/python";

  const candidates = [
    // 1. Prefer .venv313 inside biometric-service
    path.join(ROOT_DIR, "biometric-service", ".venv313", pythonBin),
    // 2. Root .venv313
    path.join(ROOT_DIR, ".venv313", pythonBin),
    // 3. Fallback to .venv in biometric-service
    path.join(ROOT_DIR, "biometric-service", ".venv", pythonBin),
    // 4. Root .venv
    path.join(ROOT_DIR, ".venv", pythonBin),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      try {
        const out = execSync(`"${cand}" -c "import fastapi, uvicorn, onnxruntime, cv2; print('OK')"`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (out.trim() === "OK") {
          return { path: cand, relative: path.relative(ROOT_DIR, cand) };
        }
      } catch {
        // Candidate lacks required packages, try next
      }
    }
  }

  // Fallback to system python
  try {
    const sysPy = isWin ? "python.exe" : "python3";
    const out = execSync(`${sysPy} -c "import fastapi, uvicorn, onnxruntime, cv2; print('OK')"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim() === "OK") {
      return { path: sysPy, relative: "System Python" };
    }
  } catch {}

  return null;
}

// ── 4. Process Tree Killer (Windows-Safe) ────────────────────────
function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
    } catch {
      try { child.kill("SIGKILL"); } catch {}
    }
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try { child.kill("SIGTERM"); } catch {}
    }
  }
}

// ── 5. Main Orchestration ───────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify-and-exit");

  console.log("");
  console.log(`${colors.cyan}${colors.bold}============================================================${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}       EduTrack Unified Development Launcher (Windows)      ${colors.reset}`);
  console.log(`${colors.cyan}${colors.bold}============================================================${colors.reset}`);
  console.log("");

  // Step 1: Discover Environment
  const envPath = path.join(ROOT_DIR, ".env");
  const envConfig = parseEnvFile(envPath);

  // Synchronized internal token
  let internalToken = process.env.BIOMETRIC_INTERNAL_TOKEN || envConfig.BIOMETRIC_INTERNAL_TOKEN;
  if (!internalToken || internalToken.trim() === "") {
    internalToken = crypto.randomBytes(32).toString("hex");
    log("Security", "Generated secure ephemeral internal auth token for this session.", colors.yellow);
  } else {
    log("Security", "Loaded biometric internal auth token from .env (Token securely masked).", colors.green);
  }

  // Step 2: Validate Required Assets (Database & ONNX Models)
  const dbPath = path.join(ROOT_DIR, "db", "custom.db");
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
    errorLog("Database", `SQLite database file not found or empty at: ${dbPath}`);
    console.error(`  Please verify that db/custom.db exists and is non-empty.`);
    process.exit(1);
  }
  log("Database", `SQLite database verified at db/custom.db (${fs.statSync(dbPath).size.toLocaleString()} bytes).`, colors.green);

  const modelsDir = path.join(ROOT_DIR, "public", "biometric-models");
  const requiredModels = [
    { name: "face_detection_yunet_2023mar.onnx", desc: "YuNet Face Detection & 5-point Alignment" },
    { name: "face_recognition_sface_2021dec.onnx", desc: "SFace 128-dim Feature Embedding" },
    { name: "2.7_80x80_MiniFASNetV2.onnx", desc: "MiniFASNetV2 Anti-Spoofing" },
    { name: "4_0_0_80x80_MiniFASNetV1SE.onnx", desc: "MiniFASNetV1SE Anti-Spoofing" },
  ];

  for (const model of requiredModels) {
    const modelFilePath = path.join(modelsDir, model.name);
    if (!fs.existsSync(modelFilePath) || fs.statSync(modelFilePath).size === 0) {
      errorLog("Models", `Required ONNX model missing: ${model.name} (${model.desc})`);
      console.error(`  Expected location: ${modelFilePath}`);
      process.exit(1);
    }
  }
  log("Models", `Verified all ${requiredModels.length} required ONNX models in public/biometric-models.`, colors.green);

  // Step 3: Discover Python Virtual Environment
  log("Launcher", "Checking Python virtual environment...");
  const python = findPythonExecutable();
  if (!python) {
    errorLog("Launcher", "No suitable Python virtual environment with FastAPI & ONNX Runtime found!");
    console.error(`  Please verify that biometric-service/.venv313 exists and dependencies are installed.`);
    console.error(`  Run: & ".\\biometric-service\\.venv313\\Scripts\\python.exe" -m pip install -r biometric-service/requirements.txt`);
    process.exit(1);
  }
  log("Python", `Using environment: ${python.relative}`, colors.green);

  // Step 4: Check Ports
  log("Network", `Checking port availability (FastAPI: ${FASTAPI_PORT}, Next.js: ${NEXT_PORT})...`);
  const bioPid = getPidHoldingPort(FASTAPI_PORT);
  const bioFree = !bioPid && (await isPortFree(FASTAPI_PORT, FASTAPI_HOST));
  if (!bioFree) {
    const pid = bioPid || getPidHoldingPort(FASTAPI_PORT);
    errorLog("Network", `Port ${FASTAPI_PORT} is already in use by process PID ${pid || "unknown"}!`);
    console.error(`  Cannot launch duplicate Biometric Service.`);
    if (pid) console.error(`  To free this port, run: taskkill /F /PID ${pid}`);
    process.exit(1);
  }

  const nextPid = getPidHoldingPort(NEXT_PORT);
  const nextFree = !nextPid && (await isPortFree(NEXT_PORT, "0.0.0.0")) && (await isPortFree(NEXT_PORT, "127.0.0.1"));
  if (!nextFree) {
    const pid = nextPid || getPidHoldingPort(NEXT_PORT);
    errorLog("Network", `Port ${NEXT_PORT} is already in use by process PID ${pid || "unknown"}!`);
    console.error(`  Cannot launch duplicate Next.js web application.`);
    if (pid) console.error(`  To free this port, run: taskkill /F /PID ${pid}`);
    process.exit(1);
  }
  log("Network", `Ports ${FASTAPI_PORT} and ${NEXT_PORT} are available.`, colors.green);

  // Common Child Environment
  const childEnv = {
    ...process.env,
    ...envConfig,
    BIOMETRIC_INTERNAL_TOKEN: internalToken,
    BIOMETRIC_SERVICE_URL: `http://${FASTAPI_HOST}:${FASTAPI_PORT}`,
    BIOMETRIC_HOST: FASTAPI_HOST,
    BIOMETRIC_PORT: String(FASTAPI_PORT),
    BIOMETRIC_DATABASE_PATH: dbPath.replace(/\\/g, "/"),
    BIOMETRIC_MODELS_DIR: modelsDir.replace(/\\/g, "/"),
    DATABASE_URL: envConfig.DATABASE_URL || "file:../db/custom.db",
    PORT: String(NEXT_PORT),
    NODE_ENV: "development",
    PYTHONUNBUFFERED: "1",
  };

  let fastapiProcess = null;
  let nextProcess = null;
  let isShuttingDown = false;

  function shutdown(signal = "SIGINT", exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("");
    log("Launcher", `Received ${signal}. Gracefully stopping all child services...`, colors.yellow);

    if (process.stdin.isTTY) {
      try {
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
    }

    if (fastapiProcess) {
      log("Launcher", "Stopping FastAPI biometric service...", colors.dim);
      killProcessTree(fastapiProcess);
      fastapiProcess = null;
    }

    if (nextProcess) {
      log("Launcher", "Stopping Next.js dev server...", colors.dim);
      killProcessTree(nextProcess);
      nextProcess = null;
    }

    log("Launcher", "All services stopped cleanly. Goodbye!", colors.green);
    process.exit(exitCode);
  }

  process.on("SIGINT", () => shutdown("SIGINT", 0));
  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGHUP", () => shutdown("SIGHUP", 0));
  process.on("uncaughtException", (err) => {
    errorLog("Launcher", `Uncaught exception: ${err?.message || err}`);
    shutdown("UNCAUGHT_EXCEPTION", 1);
  });
  process.on("unhandledRejection", (reason) => {
    errorLog("Launcher", `Unhandled rejection: ${reason}`);
    shutdown("UNHANDLED_REJECTION", 1);
  });
  process.on("exit", () => {
    if (fastapiProcess && fastapiProcess.pid) {
      try { execSync(`taskkill /F /T /PID ${fastapiProcess.pid}`, { stdio: "ignore" }); } catch {}
    }
    if (nextProcess && nextProcess.pid) {
      try { execSync(`taskkill /F /T /PID ${nextProcess.pid}`, { stdio: "ignore" }); } catch {}
    }
  });

  if (process.stdin.isTTY && !verifyOnly) {
    try {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on("keypress", (str, key) => {
        if ((key && key.ctrl && key.name === "c") || (key && key.name === "q")) {
          shutdown("KEYPRESS", 0);
        }
      });
    } catch {}
  }

  // Step 5: Spawn FastAPI Biometric Service
  log("FastAPI", `Starting Biometric Service on http://${FASTAPI_HOST}:${FASTAPI_PORT}...`, colors.cyan);
  const bioCwd = path.join(ROOT_DIR, "biometric-service");
  fastapiProcess = spawn(
    python.path,
    ["-m", "uvicorn", "app.main:app", "--host", FASTAPI_HOST, "--port", String(FASTAPI_PORT), "--log-level", "info"],
    {
      cwd: bioCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  fastapiProcess.on("exit", (code, signal) => {
    if (!isShuttingDown) {
      errorLog("FastAPI", `Biometric service crashed or exited with code ${code ?? signal}`);
      shutdown("EXIT_ERROR", 1);
    }
  });

  const bioStdout = readline.createInterface({ input: fastapiProcess.stdout });
  bioStdout.on("line", (line) => {
    if (!isShuttingDown) {
      console.log(`${colors.cyan}[FastAPI]${colors.reset} ${line}`);
    }
  });

  const bioStderr = readline.createInterface({ input: fastapiProcess.stderr });
  bioStderr.on("line", (line) => {
    if (!isShuttingDown) {
      console.error(`${colors.cyan}[FastAPI]${colors.reset} ${line}`);
    }
  });

  // Step 6: Poll FastAPI Health & Model Readiness
  log("FastAPI", "Waiting for neural models to initialize in CPU memory...", colors.dim);
  let bioReady = false;
  const startBioTime = Date.now();
  const bioTimeoutMs = 25000;

  while (Date.now() - startBioTime < bioTimeoutMs) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const res = await fetch(`http://${FASTAPI_HOST}:${FASTAPI_PORT}/ready`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.ok && body.models_ready) {
          bioReady = true;
          log(
            "FastAPI",
            `Biometric models ready! (${body.model?.name || "opencv-zoo/sface"}, ${body.model?.embedding_dim || 128}-dim, DB reachable)`,
            colors.green
          );
          break;
        }
      }
    } catch {
      // Still booting up
    }
  }

  if (!bioReady) {
    errorLog("FastAPI", "Biometric service did not become ready within 25 seconds.");
    shutdown("TIMEOUT", 1);
    return;
  }

  // Step 7: Spawn Next.js Dev Server
  log("Next.js", `Starting frontend server on port ${NEXT_PORT}...`, colors.magenta);
  const nextBin = path.join(ROOT_DIR, "node_modules", "next", "dist", "bin", "next");

  nextProcess = spawn(process.execPath, [nextBin, "dev", "-p", String(NEXT_PORT)], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  nextProcess.on("exit", (code, signal) => {
    if (!isShuttingDown) {
      errorLog("Next.js", `Next.js server crashed or exited with code ${code ?? signal}`);
      shutdown("EXIT_ERROR", 1);
    }
  });

  let nextReportedReady = false;
  const nextStdout = readline.createInterface({ input: nextProcess.stdout });
  nextStdout.on("line", (line) => {
    if (!isShuttingDown) {
      console.log(`${colors.magenta}[Next.js]${colors.reset} ${line}`);
      if (line.includes("Ready in") || line.includes("Local:")) {
        nextReportedReady = true;
      }
    }
  });

  const nextStderr = readline.createInterface({ input: nextProcess.stderr });
  nextStderr.on("line", (line) => {
    if (!isShuttingDown) {
      console.error(`${colors.magenta}[Next.js]${colors.reset} ${line}`);
    }
  });

  // Step 8: Poll Next.js Readiness
  log("Next.js", "Waiting for Next.js HTTP server to accept connections...", colors.dim);
  let nextReady = false;
  const startNextTime = Date.now();
  const nextTimeoutMs = 35000;

  while (Date.now() - startNextTime < nextTimeoutMs) {
    await new Promise((r) => setTimeout(r, 600));
    if (nextReportedReady) {
      nextReady = true;
      log("Next.js", `Next.js frontend server is ready on http://localhost:${NEXT_PORT}`, colors.green);
      break;
    }
    const connected = await canConnect(NEXT_PORT, "127.0.0.1", 500);
    if (connected) {
      nextReady = true;
      log("Next.js", `Next.js frontend server is ready on http://localhost:${NEXT_PORT}`, colors.green);
      break;
    }
  }

  if (!nextReady) {
    errorLog("Next.js", "Next.js dev server did not respond within 35 seconds.");
    shutdown("TIMEOUT", 1);
    return;
  }

  // Step 9: Ready Banner
  console.log("");
  console.log(`${colors.green}${colors.bold}============================================================${colors.reset}`);
  console.log(`${colors.green}${colors.bold}      ✓ EduTrack Development Environment is Fully Live!     ${colors.reset}`);
  console.log(`${colors.green}${colors.bold}============================================================${colors.reset}`);
  console.log(`  ${colors.bold}Frontend Portal:${colors.reset}      http://localhost:${NEXT_PORT}`);
  console.log(`  ${colors.bold}Biometric API:${colors.reset}        http://${FASTAPI_HOST}:${FASTAPI_PORT}`);
  console.log(`  ${colors.bold}Biometric Swagger:${colors.reset}    http://${FASTAPI_HOST}:${FASTAPI_PORT}/docs`);
  console.log(`  ${colors.bold}Service Health:${colors.reset}       http://${FASTAPI_HOST}:${FASTAPI_PORT}/health`);
  console.log(`  ${colors.bold}Model Readiness:${colors.reset}      http://${FASTAPI_HOST}:${FASTAPI_PORT}/ready`);
  console.log(`  ${colors.bold}Database:${colors.reset}             SQLite (db/custom.db)`);
  console.log(`${colors.green}------------------------------------------------------------${colors.reset}`);
  console.log(`  ${colors.yellow}Press [Ctrl+C] or type [q] to gracefully shut down both services.${colors.reset}`);
  console.log(`${colors.green}${colors.bold}============================================================${colors.reset}`);
  console.log("");

  if (verifyOnly) {
    log("Verify", "Smoke test verification mode completed successfully. Exiting clean.", colors.green);
    shutdown("VERIFY_COMPLETE", 0);
  }
}

main().catch((err) => {
  console.error("Fatal launcher error:", err);
  process.exit(1);
});
