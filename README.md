# EduTrack — Smart Attendance System

EduTrack is an automated student attendance and face biometric verification platform built with Next.js, FastAPI, Prisma, SQLite, and CPU-accelerated ONNX neural models.

---

## Daily Development Workflow (Windows)

To start the entire EduTrack stack (Next.js frontend + FastAPI biometric service) with a single command:

```powershell
cd C:\Projects\Attendance
npm run dev:all
```

Then open your browser to:
**http://localhost:3000**

You can use all biometric features immediately without manually configuring environment variables or opening a second terminal window.

To stop both services cleanly at any time, press **Ctrl+C** or type **`q`** in the terminal.

---

### What `npm run dev:all` does automatically:

1. **Database & Model Integrity Checks:** Verifies the existing SQLite database at `db/custom.db` and checks all 4 required ONNX models in `public/biometric-models`:
   - `face_detection_yunet_2023mar.onnx` (YuNet Face Detection & 5-point alignment)
   - `face_recognition_sface_2021dec.onnx` (SFace 128-dimensional embedding model)
   - `2.7_80x80_MiniFASNetV2.onnx` (MiniFASNet V2 anti-spoofing)
   - `4_0_0_80x80_MiniFASNetV1SE.onnx` (MiniFASNet V1SE anti-spoofing)
2. **Virtual Environment Detection:** Automatically locates and reuses your working Python environment (prioritizing `biometric-service\.venv313` with Python 3.13). Dependencies are not reinstalled on each launch.
3. **Safe Environment Variable Synchronization:** Securely loads configuration from `.env` and shares the `BIOMETRIC_INTERNAL_TOKEN` between Next.js and FastAPI without printing secrets to the terminal.
4. **Pre-flight Port Diagnostics:** Verifies that port **3000** (Next.js) and port **3010** (FastAPI) are free. If either port is occupied, it identifies the PID and refuses to start duplicate processes.
5. **Readiness Verification:** Starts FastAPI on `http://127.0.0.1:3010`, confirms model initialization and DB connection via `/ready`, then starts Next.js on `http://localhost:3000`.
6. **Unified Log Streaming:** Multiplexes logs cleanly (`[FastAPI]` in cyan and `[Next.js]` in magenta) in a single console.
7. **Graceful Windows Cleanup:** On `Ctrl+C`, `q`, or process exit, cleanly terminates child process trees with `taskkill /F /T /PID` so no orphaned processes remain.

---

## Service Endpoints

Once running, the following endpoints are live:

| Service | URL | Purpose |
| :--- | :--- | :--- |
| **Frontend Web Portal** | `http://localhost:3000` | Student & Admin web portal |
| **FastAPI Biometric Service** | `http://127.0.0.1:3010` | Face verification & enrollment engine |
| **Interactive API Documentation** | `http://127.0.0.1:3010/docs` | FastAPI Swagger UI |
| **Service Health Check** | `http://127.0.0.1:3010/health` | Process liveness probe |
| **Model Readiness Check** | `http://127.0.0.1:3010/ready` | ONNX weights & SQLite readiness probe |

---

## Available npm Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev:all` | **Recommended:** One-command startup of Next.js and FastAPI |
| `npm run dev` | Starts only the Next.js frontend (port 3000) |
| `npm run build` | Builds the production Next.js application and copies standalone assets |
| `npm run start` | Runs the production standalone Next.js server |
| `npm run lint` | Runs ESLint 9 across all TypeScript and React files |

---

## Automated Verification & Testing

To verify the system on Windows at any time:

### 1. Test Launcher Lifecycle & Biometrics
```powershell
node scripts/verify-launcher-lifecycle.mjs
```
*Validates port checking, FastAPI readiness, Next.js HTML portal, admin auth, student face profile lookup, and clean shutdown.*

### 2. Test Real Biometric Neural Inference
```powershell
.\biometric-service\.venv313\Scripts\pytest biometric-service/tests/test_e2e_inference.py
```
*Runs 28 real ONNX face recognition, alignment, anti-spoofing, and cross-identity tests.*

### 3. Test Full Stack API & Database Integration
```powershell
node scripts/qa-api-suite.mjs
```
*Executes 32 automated tests across authentication, student CRUD, attendance, and biometrics.*

---

## Troubleshooting

### Port Already Occupied
If port 3000 or 3010 is occupied by a lingering process:
```powershell
# Identify and terminate process holding the port on Windows:
netstat -ano -p tcp | findstr :3010
taskkill /F /PID <PID_FOUND>
```
The launcher will also display the exact PID and command to run.
