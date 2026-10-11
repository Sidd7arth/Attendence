import { spawn, execSync } from "node:child_process";
import net from "node:net";

async function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

async function main() {
  console.log("=== Verifying EduTrack dev:all Lifecycle on Windows ===");

  // Ensure ports are free before starting
  const p3010Clean = await checkPort(3010);
  const p3000Clean = await checkPort(3000);
  if (!p3010Clean || !p3000Clean) {
    console.error(`Pre-flight warning: Port 3010 free=${p3010Clean}, Port 3000 free=${p3000Clean}`);
  }

  const launcher = spawn("node", ["scripts/dev-all.mjs"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let liveBannerSeen = false;
  launcher.stdout.on("data", (d) => {
    const text = d.toString();
    process.stdout.write(text);
    if (text.includes("EduTrack Development Environment is Fully Live!")) {
      liveBannerSeen = true;
    }
  });

  launcher.stderr.on("data", (d) => {
    process.stderr.write(d.toString());
  });

  const startTime = Date.now();
  while (!liveBannerSeen && Date.now() - startTime < 45000) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!liveBannerSeen) {
    console.error("FAIL: Launcher did not report live within 45 seconds.");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 1] Querying FastAPI /health endpoint...");
  const resHealth = await fetch("http://127.0.0.1:3010/health");
  const healthData = await resHealth.json();
  console.log("[TEST 1] FastAPI /health:", resHealth.status, healthData);
  if (resHealth.status !== 200 || !healthData.ok) {
    console.error("FAIL: FastAPI /health failed!");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 2] Querying FastAPI /ready endpoint...");
  const resReady = await fetch("http://127.0.0.1:3010/ready");
  const readyData = await resReady.json();
  console.log("[TEST 2] FastAPI /ready:", resReady.status, readyData);
  if (!readyData.ok || !readyData.models_ready || !readyData.database_reachable) {
    console.error("FAIL: FastAPI models or database not ready!");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 3] Querying Next.js root portal (http://localhost:3000)...");
  const resPortal = await fetch("http://localhost:3000");
  console.log("[TEST 3] Next.js HTML portal status:", resPortal.status);
  if (resPortal.status !== 200) {
    console.error("FAIL: Next.js portal did not return 200!");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 4] Querying Next.js /api endpoint...");
  const resNextApi = await fetch("http://localhost:3000/api");
  console.log("[TEST 4] Next.js /api status:", resNextApi.status);

  console.log("\n[TEST 5] Testing Admin authentication via Next.js...");
  const resLogin = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "ADMIN",
      email: "admin@edutrack.in",
      password: "Admin@123",
    }),
  });
  const loginData = await resLogin.json();
  console.log("[TEST 5] Admin login status:", resLogin.status, "token received:", Boolean(loginData.token));
  if (resLogin.status !== 200 || !loginData.token) {
    console.error("FAIL: Admin login failed!");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 6] Querying student face biometric status via Next.js API...");
  const resFace = await fetch("http://localhost:3000/api/admin/students/cmv0szi900001vrbol1kd69cp/face", {
    headers: {
      Authorization: `Bearer ${loginData.token}`,
    },
  });
  const faceData = await resFace.json();
  console.log("[TEST 6] Face status response:", resFace.status, faceData);
  if (resFace.status !== 200 || !faceData.enrolled) {
    console.error("FAIL: Face profile lookup failed!");
    try { execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" }); } catch {}
    process.exit(1);
  }

  console.log("\n[TEST 7] Initiating graceful termination (tree kill on launcher)...");
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /F /T /PID ${launcher.pid}`, { stdio: "ignore" });
    } catch {}
  } else {
    launcher.kill("SIGTERM");
  }

  await new Promise((r) => setTimeout(r, 2000));

  const port3010Free = await checkPort(3010);
  const port3000Free = await checkPort(3000);

  console.log("[TEST 7] Port 3010 freed:", port3010Free);
  console.log("[TEST 7] Port 3000 freed:", port3000Free);

  if (port3010Free && port3000Free) {
    console.log("\n=== SUCCESS: dev:all startup, biometric verification & shutdown cycle verified! ===");
    process.exit(0);
  } else {
    console.error("\nFAIL: One or more ports were not released.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
