/**
 * EduTrack API & Database QA Suite
 * Runs against an ISOLATED disposable SQLite test database (test_qa_isolated.db)
 * to strictly ensure the user's primary database (custom.db) is NEVER modified.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".");
const TEST_PORT = 3005;
const BIO_PORT = 3010;
const TEST_DB = path.join(ROOT, "db", "test_qa_isolated.db");
const ORIGINAL_DB = path.join(ROOT, "db", "custom.db");
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const BIO_URL = `http://127.0.0.1:${BIO_PORT}`;

let passCount = 0;
let failCount = 0;
const results = [];

function record(name, passed, detail = "") {
  if (passed) {
    passCount++;
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failCount++;
    console.error(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
  results.push({ name, passed, detail });
}

async function waitUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function findPythonExecutable() {
  const isWin = process.platform === "win32";
  const pythonBin = isWin ? "Scripts/python.exe" : "bin/python";
  const candidates = [
    path.join(ROOT, "biometric-service", ".venv313", pythonBin),
    path.join(ROOT, ".venv313", pythonBin),
    path.join(ROOT, "biometric-service", ".venv", pythonBin),
    path.join(ROOT, ".venv", pythonBin),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return isWin ? "python.exe" : "python3";
}

const pyExe = findPythonExecutable();

// Generate realistic 720p base64 JPEG camera frames using python venv
function getFixtureFrames() {
  const scriptPath = path.join(ROOT, "scripts", "encode-fixtures.py");
  const out = execSync(`"${pyExe}" "${scriptPath}"`, { cwd: ROOT, encoding: "utf-8" });
  return JSON.parse(out.trim());
}

async function main() {
  console.log("============================================================");
  console.log("EduTrack Comprehensive API & Database QA Suite (Isolated DB)");
  console.log("============================================================\n");

  // Step 1: Copy original DB to disposable test DB
  console.log(`Setting up isolated test database at: ${TEST_DB}`);
  fs.copyFileSync(ORIGINAL_DB, TEST_DB);

  // Step 2: Prepare camera frame payloads
  console.log("Preparing biometric camera frame fixtures...");
  const frames = getFixtureFrames();
  console.log("Fixtures ready.\n");

  let nextProcess = null;
  let bioProcess = null;

  try {
    // Step 3: Start FastAPI biometric service on port 3010 pointing to TEST_DB
    console.log("Starting FastAPI Biometric Service on port 3010...");
    bioProcess = spawn(
      pyExe,
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BIO_PORT)],
      {
        cwd: path.join(ROOT, "biometric-service"),
        env: {
          ...process.env,
          BIOMETRIC_PORT: String(BIO_PORT),
          BIOMETRIC_HOST: "127.0.0.1",
          BIOMETRIC_INTERNAL_TOKEN: "edutrack-dev-secret-token",
          BIOMETRIC_DATABASE_PATH: TEST_DB.replace(/\\/g, "/"),
        },
        stdio: "ignore",
      }
    );

    const bioReady = await waitUrl(`${BIO_URL}/health`, 20000);
    if (!bioReady) {
      throw new Error("FastAPI Biometric Service failed to start on port 3010.");
    }
    console.log("FastAPI Biometric Service is healthy!\n");

    // Step 4: Start Next.js standalone server on TEST_PORT pointing to TEST_DB
    const standaloneServer = path.join(ROOT, ".next", "standalone", "server.js");
    const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
    const nextArgs = fs.existsSync(standaloneServer)
      ? [standaloneServer]
      : [nextBin, "dev", "-p", String(TEST_PORT)];

    nextProcess = spawn(
      process.execPath,
      nextArgs,
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(TEST_PORT),
          DATABASE_URL: `file:${TEST_DB.replace(/\\/g, "/")}`,
          BIOMETRIC_SERVICE_URL: BIO_URL,
          BIOMETRIC_INTERNAL_TOKEN: "edutrack-dev-secret-token",
          BIOMETRIC_GPS_REQUIRED: "false",
        },
        stdio: "ignore",
      }
    );

    const nextReady = await waitUrl(`${BASE_URL}/api/auth/me`, 25000);
    if (!nextReady) {
      throw new Error(`Next.js server failed to respond on port ${TEST_PORT}.`);
    }
    console.log("Next.js server is ready!\n");

    // ==========================================
    // Phase 4: Full Suite of API & DB Operations
    // ==========================================

    let adminToken = "";
    let studentId = "";
    let studentToken = "";

    // Group 1: Authentication & Authorization
    console.log("== 1. Authentication & Authorization ==");
    {
      // Missing fields
      const res400 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "ADMIN" }),
      });
      record("Rejects missing login credentials (400)", res400.status === 400);

      // Wrong password
      const res401 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "ADMIN", email: "admin@edutrack.in", password: "WrongPassword" }),
      });
      record("Rejects invalid admin password (401)", res401.status === 401);

      // Valid admin login
      const resLogin = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "ADMIN", email: "admin@edutrack.in", password: "Admin@123" }),
      });
      const loginData = await resLogin.json();
      record("Valid admin login succeeds (200)", resLogin.status === 200 && Boolean(loginData.token));
      adminToken = loginData.token || "";

      // Check /api/auth/me with Admin token
      const resMe = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const meData = await resMe.json();
      record("Admin /api/auth/me returns ADMIN role", meData.user?.role === "ADMIN");

      // Check /api/auth/me without token -> returns { user: null }
      const resMeAnon = await fetch(`${BASE_URL}/api/auth/me`);
      const meDataAnon = await resMeAnon.json();
      record("Anonymous /api/auth/me returns null user", resMeAnon.status === 200 && meDataAnon.user === null);

      // Check /api/auth/me with invalid token -> returns { user: null }
      const resMeBad = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: "Bearer bad-token-xyz" },
      });
      const meDataBad = await resMeBad.json();
      record("Invalid token /api/auth/me returns null user", resMeBad.status === 200 && meDataBad.user === null);
    }

    // Group 2: Student Management (CRUD)
    console.log("\n== 2. Student Management (CRUD) ==");
    {
      // Create student
      const resCreate = await fetch(`${BASE_URL}/api/admin/students`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: "Rohan Verma",
          rollNumber: "10A-99",
          email: "rohan.v@edutrack.in",
          password: "Student@123",
          class: "Class 10-A",
          phone: "9876543210",
        }),
      });
      const createData = await resCreate.json();
      record("Admin creates new student (200)", resCreate.status === 200 && Boolean(createData.student?.studentId));
      studentId = createData.student?.studentId || "";

      // Duplicate roll number rejected
      const resDup = await fetch(`${BASE_URL}/api/admin/students`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          name: "Rohan Duplicate",
          rollNumber: "10A-99",
          email: "rohan.dup@edutrack.in",
          password: "Student@123",
          class: "Class 10-A",
        }),
      });
      record("Duplicate roll number rejected (409)", resDup.status === 409);

      // List students with search
      const resList = await fetch(`${BASE_URL}/api/admin/students?search=Rohan`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const listData = await resList.json();
      record(
        "List students returns created student",
        Array.isArray(listData.students) && listData.students.some((s) => s.studentId === studentId)
      );

      // Get single student
      const resSingle = await fetch(`${BASE_URL}/api/admin/students/${studentId}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const singleData = await resSingle.json();
      record("Get single student by ID (200)", singleData.student?.studentId === studentId);

      // Update student phone
      const resPatch = await fetch(`${BASE_URL}/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ phone: "9998887776" }),
      });
      record("Admin updates student profile (200)", resPatch.status === 200);

      // Student login
      const resStuLogin = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "STUDENT",
          email: "rohan.v@edutrack.in",
          password: "Student@123",
        }),
      });
      const stuLoginData = await resStuLogin.json();
      record("Student logs in with credentials (200)", resStuLogin.status === 200 && Boolean(stuLoginData.token));
      studentToken = stuLoginData.token || "";
    }

    // Group 3: Role-Based Authorization
    console.log("\n== 3. Role-Based Authorization & Security Boundaries ==");
    {
      // Student attempting to fetch Admin student list -> 403
      const resForbidden = await fetch(`${BASE_URL}/api/admin/students`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      record("Student access to admin student list rejected (403)", resForbidden.status === 403);

      // Student attempting to fetch Admin stats -> 403
      const resForbiddenStats = await fetch(`${BASE_URL}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      record("Student access to admin stats rejected (403)", resForbiddenStats.status === 403);

      // Student attempting to update another student's record -> 403
      const resForbiddenPatch = await fetch(`${BASE_URL}/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({ name: "Hacked" }),
      });
      record("Student access to admin edit API rejected (403)", resForbiddenPatch.status === 403);
    }

    // Group 4: Announcements & Targeted Delivery
    console.log("\n== 4. Announcements & Read Receipts ==");
    {
      // Admin creates announcement
      const resAnn = await fetch(`${BASE_URL}/api/admin/announcements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          title: "Sports Day Next Week",
          content: "Annual sports meet on Friday. All students gather in the field.",
          targetClass: null,
          priority: "HIGH",
        }),
      });
      const annData = await resAnn.json();
      const annId = annData.id;
      record("Admin creates announcement (200)", resAnn.status === 200 && Boolean(annId));

      // Student receives announcement
      const resStuAnn = await fetch(`${BASE_URL}/api/student/announcements`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      const stuAnnData = await resStuAnn.json();
      record(
        "Student receives broadcast announcement",
        Array.isArray(stuAnnData.announcements) && stuAnnData.announcements.some((a) => a.id === annId)
      );

      // Student marks announcement read
      const resRead = await fetch(`${BASE_URL}/api/student/announcements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({ announcementId: annId }),
      });
      record("Student marks announcement as read (200)", resRead.status === 200);
    }

    // Group 5: Attendance Operations (Admin & Student)
    console.log("\n== 5. Attendance Operations & Deduplication ==");
    {
      const today = new Date().toISOString().slice(0, 10);

      // Admin marks attendance for student
      const resMark = await fetch(`${BASE_URL}/api/admin/attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          studentId: studentId,
          date: today,
          status: "PRESENT",
          note: "On time",
        }),
      });
      record("Admin marks attendance for student (200)", resMark.status === 200);

      // Fetch attendance roster
      const resRoster = await fetch(`${BASE_URL}/api/admin/attendance?date=${today}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const rosterData = await resRoster.json();
      record(
        "Admin fetches roster with recorded attendance",
        Array.isArray(rosterData.roster) && rosterData.roster.some((r) => r.student.studentId === studentId && r.attendance?.status === "PRESENT")
      );

      // Student views attendance history
      const resHistory = await fetch(`${BASE_URL}/api/student/attendance?today=${today}`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      const historyData = await resHistory.json();
      record(
        "Student views own attendance record",
        Boolean(historyData.today && historyData.today.status === "PRESENT")
      );

      // Bulk attendance update (idempotent / upsert)
      const resBulk = await fetch(`${BASE_URL}/api/admin/attendance`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          date: today,
          status: "PRESENT",
          studentIds: [studentId],
        }),
      });
      record("Bulk attendance update operates idempotently (200)", resBulk.status === 200);
    }

    // Group 6: Biometric Integration (Full Next.js ↔ FastAPI chain)
    console.log("\n== 6. Biometric Integration (Next.js <-> FastAPI) ==");
    {
      // Check face status before enrollment
      const resStatusBefore = await fetch(`${BASE_URL}/api/admin/students/${studentId}/face`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const statusBeforeData = await resStatusBefore.json();
      record("Student face status before enrollment is not enrolled", statusBeforeData.enrolled === false);

      // Enroll student's face with real camera frames
      const enrollFramesPayload = [frames.a1, frames.a3, frames.a1_normal];

      const resEnroll = await fetch(`${BASE_URL}/api/admin/students/${studentId}/face/enroll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          frames: enrollFramesPayload,
          nonce: "test-enroll-nonce-1234",
          timestamp: Date.now(),
        }),
      });
      const enrollData = await resEnroll.json();
      record(
        "Admin enrolls student face through Next.js -> FastAPI (200)",
        resEnroll.status === 200 && Boolean(enrollData.ok && enrollData.samples)
      );

      // Check face status after enrollment
      const resStatusAfter = await fetch(`${BASE_URL}/api/admin/students/${studentId}/face`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const statusAfterData = await resStatusAfter.json();
      record(
        "Student face status reflects ACTIVE profile",
        statusAfterData.enrolled === true && statusAfterData.modelName === "opencv-zoo/sface"
      );

      // Student requests anti-replay challenge
      const resChallenge = await fetch(`${BASE_URL}/api/face/challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
      });
      const challengeData = await resChallenge.json();
      const challengeId = challengeData.challengeId;
      record("Student requests single-use challenge (200)", resChallenge.status === 200 && Boolean(challengeId));

      // Attempt verification without challenge in SELF mode -> rejected
      const resNoChal = await fetch(`${BASE_URL}/api/face/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
        body: JSON.stringify({
          frames: [frames.a3, frames.a1_normal, frames.a1],
          date: new Date().toISOString().slice(0, 10),
        }),
      });
      record("SELF verify without challenge rejected (422 CHALLENGE_REQUIRED)", resNoChal.status === 422);

      // KIOSK 1:N Verification by Admin
      const resKiosk = await fetch(`${BASE_URL}/api/face/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          frames: [frames.a3, frames.a1_normal, frames.a1],
          date: new Date().toISOString().slice(0, 10),
        }),
      });
      const kioskData = await resKiosk.json();
      record(
        "Admin KIOSK verify successfully matches enrolled student",
        resKiosk.status === 200 && (kioskData.reason === "MATCH_CONFIRMED" || kioskData.reason === "ALREADY_MARKED")
      );
    }

    // Group 7: Deactivation & Deletion
    console.log("\n== 7. Account Deactivation & Session Invalidation ==");
    {
      // Deactivate student
      const resDeact = await fetch(`${BASE_URL}/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ active: false }),
      });
      record("Admin deactivates student (200)", resDeact.status === 200);

      // Deactivated student tries to access /api/auth/me -> returns null user
      const resInactiveMe = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${studentToken}` },
      });
      const inactiveMeData = await resInactiveMe.json();
      record("Deactivated student session blocked (returns null user)", inactiveMeData.user === null);

      // Admin logout
      const resLogout = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      record("Admin logs out (200)", resLogout.status === 200);

      // Verify token invalidated
      const resInvalidToken = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const invalidTokenData = await resInvalidToken.json();
      record("Logged-out session invalidated (returns null user)", invalidTokenData.user === null);
    }
  } finally {
    // Teardown processes
    console.log("\nCleaning up processes...");
    if (nextProcess) {
      try {
        nextProcess.kill();
      } catch {}
    }
    if (bioProcess) {
      try {
        bioProcess.kill();
      } catch {}
    }

    // Wait a brief moment for locks to release and delete isolated test DB
    await new Promise((r) => setTimeout(r, 1500));
    if (fs.existsSync(TEST_DB)) {
      try {
        fs.unlinkSync(TEST_DB);
        console.log(`Disposable test database ${TEST_DB} cleanly purged.`);
      } catch (e) {
        console.warn(`Could not immediately delete ${TEST_DB}: ${e.message}`);
      }
    }
  }

  console.log("\n============================================================");
  console.log(`API & DATABASE QA SUMMARY: ${passCount} passed, ${failCount} failed`);
  console.log("============================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal QA Suite Error:", err);
  process.exit(1);
});
