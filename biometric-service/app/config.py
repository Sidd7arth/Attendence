"""Central configuration — EVERY biometric threshold lives here (spec PART 10).

All numeric settings are environment-tunable and clamped to safe ranges so a
bad deployment variable can never silently disable a security control.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR.parent / ".env")
load_dotenv(BASE_DIR / ".env")


def _clamp(name: str, default: float, lo: float, hi: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        v = float(raw)
    except ValueError:
        return default
    return min(hi, max(lo, v))


def _clamp_int(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        v = int(raw)
    except ValueError:
        return default
    return min(hi, max(lo, v))


BASE_DIR = Path(__file__).resolve().parent.parent


def _resolve_models_dir() -> Path:
    """Model weights location, in priority order:
    1. BIOMETRIC_MODELS_DIR env
    2. <project>/public/biometric-models — works in dev (repo root) AND in
       production (build.sh copies public/ into next-service-dist, where the
       Python sources are also deployed, preserving relative paths).
    3. biometric-service/models (legacy fallback)
    """
    env = os.environ.get("BIOMETRIC_MODELS_DIR")
    if env:
        return Path(env)
    candidates = [
        BASE_DIR.parent / "public" / "biometric-models",
        BASE_DIR / "models",
    ]
    for c in candidates:
        if c.is_dir() and any(c.glob("*.onnx")):
            return c
    return candidates[0]


MODELS_DIR = _resolve_models_dir()


def _resolve_database_path() -> str:
    env_bio = os.environ.get("BIOMETRIC_DATABASE_PATH")
    if env_bio:
        p = Path(env_bio)
        if p.is_absolute() and p.exists():
            return p.resolve().as_posix()
        cand = (BASE_DIR.parent / p).resolve()
        if cand.exists():
            return cand.as_posix()
        return p.resolve().as_posix()
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        clean = db_url.replace("file:", "").strip()
        p = Path(clean)
        if not p.is_absolute():
            cand1 = (BASE_DIR.parent / "prisma" / clean).resolve()
            if cand1.exists():
                return cand1.as_posix()
            cand2 = (BASE_DIR.parent / clean).resolve()
            if cand2.exists():
                return cand2.as_posix()
        elif p.exists():
            return p.resolve().as_posix()
    default_db = (BASE_DIR.parent / "db" / "custom.db").resolve()
    return default_db.as_posix()


class Settings(BaseSettings):
    """Runtime settings. Thresholds are read via _clamp on instantiation."""

    # ── Service identity ──
    service_name: str = "edutrack-biometric"
    service_version: str = "1.0.0"

    # ── Network ──
    host: str = os.environ.get("BIOMETRIC_HOST", "127.0.0.1")
    port: int = _clamp_int("BIOMETRIC_PORT", 3010, 1024, 65535)
    # Shared secret required on every biometric call from the Next.js app.
    # Requests without it are rejected — the browser never talks to us
    # directly and can never bypass the application's auth layer.
    internal_token: str = os.environ.get("BIOMETRIC_INTERNAL_TOKEN", "")

    # ── Model files ──
    yunet_model_path: str = str(MODELS_DIR / "face_detection_yunet_2023mar.onnx")
    sface_model_path: str = str(MODELS_DIR / "face_recognition_sface_2021dec.onnx")
    antispoof_model_paths: list[str] = [
        str(MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx"),
        str(MODELS_DIR / "4_0_0_80x80_MiniFASNetV1SE.onnx"),
    ]

    # ── Model identity (stamped into every template / decision) ──
    model_name: str = "opencv-zoo/sface"
    model_version: str = "sface_2021dec+yunet_2023mar"
    embedding_version: int = 1
    embedding_dim: int = 128

    # ── Detection (YuNet) ──
    face_min_detection_confidence: float = _clamp("FACE_MIN_DETECTION_CONFIDENCE", 0.70, 0.10, 0.95)
    face_min_size_px: int = _clamp_int("FACE_MIN_SIZE", 90, 32, 640)
    yunet_input_size: int = _clamp_int("BIOMETRIC_YUNET_INPUT", 640, 320, 1280)

    # ── Quality gates (spec PART 10/11) ──
    # Blur: variance of the Laplacian of the aligned grayscale crop.
    blur_threshold: float = _clamp("BLUR_THRESHOLD", 60.0, 5.0, 1000.0)
    brightness_min: float = _clamp("BRIGHTNESS_MIN", 40.0, 0.0, 255.0)
    brightness_max: float = _clamp("BRIGHTNESS_MAX", 220.0, 0.0, 255.0)
    # Pose proxies derived from 5-point landmarks (normalized units).
    max_yaw: float = _clamp("MAX_YAW", 0.38, 0.05, 1.20)
    max_pitch: float = _clamp("MAX_PITCH", 0.45, 0.05, 1.20)
    max_roll: float = _clamp("MAX_ROLL", 0.35, 0.05, 1.20)
    # Aggregate quality floor for accept/reject decisions.
    face_quality_threshold: float = _clamp("FACE_QUALITY_THRESHOLD", 0.55, 0.05, 1.0)

    # Quality score weights (sum to 1.0)
    w_blur: float = 0.35
    w_brightness: float = 0.20
    w_pose: float = 0.25
    w_size: float = 0.20

    # ── Liveness / anti-spoof (MiniFASNet ensemble) ──
    # Mean P(real) across the ensemble. >= pass → LIVE; <= fake → FAKE;
    # between → UNCERTAIN. UNCERTAIN and FAKE both BLOCK attendance
    # (fail-closed) but are reported distinctly.
    liveness_pass_threshold: float = _clamp("LIVENESS_PASS_THRESHOLD", 0.72, 0.50, 0.99)
    liveness_fake_threshold: float = _clamp("LIVENESS_FAKE_THRESHOLD", 0.45, 0.01, 0.80)

    # ── Matching (cosine similarity on L2-normalized SFace embeddings) ──
    # SFace cosine distributions differ fundamentally from face-api.js.
    # CALIBRATION (E2E, real inference): genuine self ≈ 1.0; measured
    # impostor pair = 0.4294; published EER knee = 0.363. Thresholds are set
    # ABOVE the measured impostor band; the medium band additionally requires
    # the application's second-scan confirmation before attendance is marked.
    match_threshold: float = _clamp("FACE_MATCH_THRESHOLD", 0.52, 0.20, 0.95)
    high_confidence_threshold: float = _clamp("FACE_HIGH_CONFIDENCE_THRESHOLD", 0.70, 0.20, 0.99)
    min_margin_1n: float = _clamp("FACE_MIN_MARGIN", 0.05, 0.0, 0.50)

    # ── Frame payload limits ──
    min_frames: int = _clamp_int("BIOMETRIC_MIN_FRAMES", 3, 1, 10)
    max_frames: int = _clamp_int("BIOMETRIC_MAX_FRAMES", 8, 1, 16)
    max_frame_bytes: int = _clamp_int("BIOMETRIC_MAX_FRAME_BYTES", 512 * 1024, 32 * 1024, 4 * 1024 * 1024)

    # ── Rate limiting (per internal caller) ──
    enroll_rate_limit: int = _clamp_int("BIOMETRIC_ENROLL_RATE_LIMIT", 30, 1, 1000)   # per minute
    verify_rate_limit: int = _clamp_int("BIOMETRIC_VERIFY_RATE_LIMIT", 120, 1, 5000)  # per minute

    # ── Database (read-only access to face templates) ──
    database_path: str = _resolve_database_path()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
