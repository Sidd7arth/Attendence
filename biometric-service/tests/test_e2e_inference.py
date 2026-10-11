#!/usr/bin/env python3
"""Real-inference E2E test for the biometric service.

Runs REAL YuNet / SFace / MiniFASNet ONNX inference (no mocks).
Uses a dedicated disposable test SQLite database to strictly prevent
touching or mutating any live application database.
Portable across Windows, Linux, and macOS.
"""
from __future__ import annotations

import base64
import json
import os
import sqlite3
import sys
from pathlib import Path

import cv2
import numpy as np

# Path resolution
TESTS_DIR = Path(__file__).resolve().parent
BIOMETRIC_DIR = TESTS_DIR.parent
ROOT_DIR = BIOMETRIC_DIR.parent
FIXTURES_DIR = TESTS_DIR / "fixtures"
DISPOSABLE_DB = TESTS_DIR / ".disposable_test_biometric.db"

# Ensure biometric service package is in sys.path
if str(BIOMETRIC_DIR) not in sys.path:
    sys.path.insert(0, str(BIOMETRIC_DIR))

from app.config import settings
from app.main import app
from fastapi.testclient import TestClient

def _resolve_token() -> str:
    env_token = os.environ.get("BIOMETRIC_INTERNAL_TOKEN")
    if env_token:
        return env_token.strip()
    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("BIOMETRIC_INTERNAL_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return "edutrack-dev-secret-token"

TOKEN = _resolve_token()
PASS: list[str] = []
FAIL: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    status_icon = "[PASS]" if cond else "[FAIL]"
    print(f"  {status_icon} {name}{' — ' + detail if detail else ''}")
    assert cond, f"Assertion failed: {name} ({detail})"


def init_disposable_db() -> None:
    """Initialize schema for disposable test database."""
    if DISPOSABLE_DB.exists():
        try:
            DISPOSABLE_DB.unlink()
        except OSError:
            pass

    conn = sqlite3.connect(DISPOSABLE_DB)
    try:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS students (
                student_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                roll_number TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                class TEXT NOT NULL,
                phone TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                face_registered INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS face_profiles (
                id TEXT PRIMARY KEY,
                student_id TEXT UNIQUE NOT NULL,
                embedding TEXT NOT NULL,
                embedding_dimension INTEGER NOT NULL,
                samples INTEGER NOT NULL,
                model_name TEXT NOT NULL,
                model_version TEXT NOT NULL,
                embedding_version INTEGER NOT NULL DEFAULT 1,
                quality_score REAL,
                liveness_method TEXT,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_verified_at DATETIME,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
            );
        """)
        conn.commit()
    finally:
        conn.close()


def cleanup_disposable_db() -> None:
    if DISPOSABLE_DB.exists():
        try:
            DISPOSABLE_DB.unlink()
        except OSError:
            pass


def persist_test_template(student_code: str, name: str, email: str, enroll_body: dict) -> str:
    """Insert candidate enrollment into disposable test database."""
    conn = sqlite3.connect(DISPOSABLE_DB)
    try:
        cur = conn.cursor()
        sid = f"test-student-{student_code}"
        cur.execute(
            "INSERT INTO students (student_id, name, roll_number, email, password_hash, class, active, face_registered, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))",
            (sid, name, student_code, email, "hash:salt", "10-A"),
        )
        cur.execute(
            "INSERT INTO face_profiles (id, student_id, embedding, embedding_dimension, samples, model_name, model_version, embedding_version, quality_score, liveness_method, status, enrolled_at, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'), datetime('now'))",
            (
                f"test-prof-{student_code}",
                sid,
                json.dumps(enroll_body["embedding"]),
                enroll_body["model"]["embedding_dim"],
                enroll_body["samples_used"],
                enroll_body["model"]["name"],
                enroll_body["model"]["version"],
                enroll_body["model"]["embedding_version"],
                enroll_body["quality_mean"],
                "minifasnet-ensemble",
            ),
        )
        conn.commit()
        return sid
    finally:
        conn.close()


def b64(path: Path, max_w: int = 720, quality: int = 90, brighten: bool = False) -> str:
    """Encode fixture image to base64 JPEG simulating camera feed."""
    img = cv2.imread(str(path))
    assert img is not None, f"Failed to load fixture at {path}"
    if brighten:
        img = cv2.convertScaleAbs(img, alpha=1.25, beta=28)
    h, w = img.shape[:2]
    if w > max_w:
        img = cv2.resize(img, (max_w, int(h * max_w / w)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok, "Failed to encode JPEG"
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def stitch_two(path_a: Path, path_b: Path) -> str:
    """Combine two images horizontally to test multiple faces."""
    a = cv2.imread(str(path_a))
    b = cv2.imread(str(path_b))
    assert a is not None and b is not None
    h = 720
    def rs(x):
        return cv2.resize(x, (int(x.shape[1] * h / x.shape[0]), h))
    a, b = rs(a), rs(b)
    canvas = np.hstack([a, b])
    ok, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
    assert ok
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def make_print_attack(path_a: Path) -> str:
    """Simulate photo print/screen attack (halftone, moiré, paper grain)."""
    img = cv2.imread(str(path_a))
    assert img is not None
    h, w = img.shape[:2]
    small = cv2.resize(img, (w // 6, h // 6), interpolation=cv2.INTER_AREA)
    img = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    moire = 0.5 + 0.5 * np.sin((xx * 0.55 + yy * 0.35) * 2 * np.pi / 7.0)
    img = img.astype(np.float32) * (0.86 + 0.10 * moire[..., None])
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 7.0, size=(h, w, 1)).astype(np.float32)
    img = img + grain
    img = img * np.array([1.03, 0.99, 0.94], dtype=np.float32) + 6.0
    img = np.clip(img, 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 72])
    assert ok
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def run_e2e_tests() -> None:
    PASS.clear()
    FAIL.clear()

    # Set up disposable DB and point settings to it
    init_disposable_db()
    settings.database_path = DISPOSABLE_DB.resolve().as_posix()
    settings.internal_token = TOKEN

    try:
        with TestClient(app) as client:
            def call(path: str, body: dict, token: str | None = TOKEN):
                headers = {"Content-Type": "application/json"}
                if token is not None:
                    headers["X-Internal-Token"] = token
                res = client.post(path, json=body, headers=headers)
                return res.status_code, res.json()

            # 1. Health & Readiness checks
            print("\n== 1. Health & Readiness probes ==")
            res = client.get("/health")
            check("GET /health status is 200", res.status_code == 200)
            check("GET /health returns ok:true", res.json().get("ok") is True)

            res = client.get("/ready")
            check("GET /ready status is 200", res.status_code == 200)
            check("GET /ready confirms models initialized", res.json().get("models_ready") is True)
            check("GET /ready confirms database reachable", res.json().get("database_reachable") is True)

            # 2. Security / Authentication
            print("\n== 2. Security: X-Internal-Token authentication ==")
            frames_a = [
                b64(FIXTURES_DIR / "identity_a1.png", brighten=True),
                b64(FIXTURES_DIR / "identity_a3.png"),
                b64(FIXTURES_DIR / "identity_a1.png", brighten=False),
            ]
            frames_a_unseen = [
                b64(FIXTURES_DIR / "identity_a3.png"),
                b64(FIXTURES_DIR / "identity_a1.png", brighten=False),
                b64(FIXTURES_DIR / "identity_a1.png", brighten=True),
            ]
            frames_b = [b64(FIXTURES_DIR / "identity_b1.png", brighten=True)] * 3
            frame_spoof = [make_print_attack(FIXTURES_DIR / "identity_a1.png")] * 3

            code, _ = call("/enroll", {"frames": frames_a}, token=None)
            check("Rejects missing internal token (401)", code == 401)
            code, _ = call("/enroll", {"frames": frames_a}, token="invalid-secret-token")
            check("Rejects invalid internal token (401)", code == 401)

            # 3. Enrollment with genuine frames
            print("\n== 3. Biometric Enrollment (identity A) ==")
            code, body = call("/enroll", {"frames": frames_a})
            check("Enrollment accepted (200)", code == 200)
            check("Embedding dimension is 128", body.get("embedding_dim") == 128)
            emb = np.array(body.get("embedding", []))
            check("Embedding is L2-normalized (norm ~ 1.0)", abs(float(np.linalg.norm(emb)) - 1.0) < 0.01)
            check("Used 3 frames for template aggregation", body.get("samples_used") == 3)
            check("All frames passed quality gates", all(q.get("passed") for q in body.get("quality", [])))
            check("Liveness labeled LIVE", body.get("liveness", {}).get("label") == "LIVE")
            check("Model stamped as opencv-zoo/sface", body.get("model", {}).get("name") == "opencv-zoo/sface")

            # 4. Persist templates in disposable test database
            print("\n== 4. Persisting templates into disposable test database ==")
            sid_a = persist_test_template("STU-A", "Student A", "student_a@test.edu", body)
            code, body_b = call("/enroll", {"frames": frames_b})
            check("Enrollment of identity B accepted", code == 200 and body_b.get("ok") is True)
            sid_b = persist_test_template("STU-B", "Student B", "student_b@test.edu", body_b)
            check("Templates safely written to disposable DB", bool(sid_a and sid_b))

            # 5. 1:1 Verification (SELF) — Same Person
            print("\n== 5. Verification 1:1 (SELF) — Genuine identity A ==")
            code, body = call("/verify", {"frames": frames_a_unseen, "mode": "SELF", "student_id": sid_a})
            check("Verification completed (200)", code == 200)
            check("Correctly matched genuine self", body.get("matched") is True)
            check("Liveness verified as LIVE", body.get("liveness", {}).get("label") == "LIVE")

            # 6. 1:1 Verification (SELF) — Wrong Person (Impostor)
            print("\n== 6. Verification 1:1 (SELF) — Stranger identity B claiming A ==")
            code, body = call("/verify", {"frames": frames_b, "mode": "SELF", "student_id": sid_a})
            check("Verification completed (200)", code == 200)
            check("Correctly rejected impostor match", body.get("matched") is False)

            # 7. 1:N Verification (KIOSK) — Identification against candidate pool
            print("\n== 7. Verification 1:N (KIOSK) — Search across candidates ==")
            code, body = call("/verify", {"frames": frames_a_unseen, "mode": "KIOSK"})
            check("1:N Search completed (200)", code == 200)
            check("Correctly identified candidate A", body.get("matched") is True and body.get("student_id") == sid_a)

            # 8. Anti-spoofing print/replay attack
            print("\n== 8. Anti-spoofing presentation attack detection ==")
            code, body = call("/verify", {"frames": frame_spoof, "mode": "SELF", "student_id": sid_a})
            spoof_blocked = (code == 422 and body.get("code") == "LIVENESS_FAILED") or (
                code == 200 and body.get("matched") is False
            )
            check("Spoof presentation attack rejected", spoof_blocked)

            # 9. Multiple faces in frame
            print("\n== 9. Multiple faces detection ==")
            two_faces = stitch_two(FIXTURES_DIR / "identity_a1.png", FIXTURES_DIR / "identity_b1.png")
            code, body = call("/verify", {"frames": [two_faces] * 3, "mode": "KIOSK"})
            check("Multiple faces rejected with code MULTIPLE_FACES", code == 422 and body.get("code") == "MULTIPLE_FACES")

            # 10. No face in frame
            print("\n== 10. Blank/no face detection ==")
            blank = np.full((720, 720, 3), 30, dtype=np.uint8)
            ok, buf = cv2.imencode(".jpg", blank)
            assert ok
            blank_b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
            code, body = call("/verify", {"frames": [blank_b64] * 3, "mode": "KIOSK"})
            check("No face rejected with code NO_FACE", code == 422 and body.get("code") == "NO_FACE")

            # 11. Insufficient frame count
            print("\n== 11. Frame payload validation ==")
            code, body = call("/enroll", {"frames": [frames_a[0]]})
            check("Single frame rejected with INSUFFICIENT_FRAMES", code == 422 and body.get("code") == "INSUFFICIENT_FRAMES")

            # 12. Malformed image data
            print("\n== 12. Corrupted/invalid image payload ==")
            code, body = call("/enroll", {"frames": ["not-a-valid-base64-image"] * 3})
            check("Malformed image payload handled safely", code in (400, 422))

    finally:
        cleanup_disposable_db()


def test_biometric_e2e():
    """Pytest entry point."""
    run_e2e_tests()


def main() -> int:
    try:
        run_e2e_tests()
        print(f"\n{'='*60}\nRESULT: {len(PASS)} passed, {len(FAIL)} failed")
        return 0
    except AssertionError as e:
        print(f"\n{'='*60}\nTEST FAILED: {e}")
        return 1
    except Exception as e:
        print(f"\n{'='*60}\nUNEXPECTED ERROR: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
