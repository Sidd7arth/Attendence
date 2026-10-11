"""Face quality — real, structured quality assessment (spec PART 10/11).

Checks, per frame:
  * sharpness  — Variance of the Laplacian of the aligned grayscale crop
                 (cv2.Laplacian(gray, cv2.CV_64F).var()) vs BLUR_THRESHOLD
  * brightness — mean luma of the face crop vs BRIGHTNESS_MIN / BRIGHTNESS_MAX
  * pose       — yaw/pitch/roll proxies from the 5 YuNet landmarks
                 vs MAX_YAW / MAX_PITCH / MAX_ROLL
  * size       — min(w,h) of the detection vs FACE_MIN_SIZE
  * detector confidence vs FACE_MIN_DETECTION_CONFIDENCE

The structured report is returned verbatim to the application layer:
  {passed, quality_score, sharpness_score, brightness_score, pose_score,
   face_confidence, blur_variance, ...}
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

import cv2
import numpy as np

from ..config import settings
from .detection import Detection


@dataclass(frozen=True)
class QualityReport:
    passed: bool
    quality_score: float
    sharpness_score: float
    brightness_score: float
    pose_score: float
    face_confidence: float
    # Diagnostics (not part of the pass decision beyond the scores above)
    blur_variance: float
    mean_luma: float
    yaw: float
    pitch: float
    roll: float
    face_size_px: int
    reasons: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["reasons"] = list(self.reasons)
        return d


def _sharpness_score(gray: np.ndarray) -> tuple[float, float]:
    """Returns (normalized 0..1 score, raw Laplacian variance)."""
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Logistic-ish mapping: BLUR_THRESHOLD maps to ~0.72, 3x it → ~0.95.
    import math
    k = 3.0 / max(settings.blur_threshold, 1.0)
    score = 1.0 - math.exp(-k * lap_var)
    return min(1.0, max(0.0, score)), lap_var


def _brightness_score(crop_bgr: np.ndarray) -> tuple[float, float, bool]:
    gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
    luma = float(gray.mean())
    in_range = settings.brightness_min <= luma <= settings.brightness_max
    if not in_range:
        return 0.0, luma, False
    # Peak quality near the middle of the allowed band.
    mid = (settings.brightness_min + settings.brightness_max) / 2.0
    half = max((settings.brightness_max - settings.brightness_min) / 2.0, 1.0)
    score = 1.0 - min(1.0, abs(luma - mid) / half)
    return max(0.0, score), luma, True


def _pose_scores(det: Detection) -> tuple[float, float, float, float]:
    """Yaw/pitch/roll proxies from 5 landmarks → (yaw, pitch, roll, pose_score).

    Landmark order (YuNet): 0 right-eye, 1 left-eye, 2 nose-tip,
    3 right-mouth, 4 left-mouth  (all pixel coords).
    """
    pts = det.landmarks.astype(np.float64)
    right_eye, left_eye, nose = pts[0], pts[1], pts[2]
    right_mouth, left_mouth = pts[3], pts[4]

    # roll: angle of the inter-eye line vs horizontal (radians)
    roll = float(np.arctan2(left_eye[1] - right_eye[1], left_eye[0] - right_eye[0]))
    roll = abs(roll)

    # yaw proxy: asymmetry of eye→nose horizontal distances, normalized by
    # the inter-eye distance. ~0 when frontal, grows as the head turns.
    eye_dist = float(np.hypot(*(left_eye - right_eye))) or 1.0
    d_right = abs(nose[0] - right_eye[0])
    d_left = abs(left_eye[0] - nose[0])
    yaw = abs(d_left - d_right) / (d_left + d_right + 1e-6)
    yaw = min(1.0, yaw * 2.0)

    # pitch proxy: nose vertical position between eye-line and mouth-line,
    # normalized by face height. Deviation from the frontal norm → |pitch|.
    eye_y = (right_eye[1] + left_eye[1]) / 2.0
    mouth_y = (right_mouth[1] + left_mouth[1]) / 2.0
    face_h = abs(mouth_y - eye_y) or 1.0
    nose_ratio = (nose[1] - eye_y) / face_h  # frontal ≈ 0.55–0.65
    pitch = abs(nose_ratio - 0.60)

    yaw_ok = yaw <= settings.max_yaw
    pitch_ok = pitch <= settings.max_pitch
    roll_ok = roll <= settings.max_roll
    hard = sum([yaw_ok, pitch_ok, roll_ok])
    # 0.0 if any dimension grossly exceeds; else scaled by how many pass.
    if not hard:
        pose_score = 0.0
    else:
        base = hard / 3.0
        # Graceful degradation inside thresholds.
        slack = (
            max(0.0, 1.0 - yaw / settings.max_yaw)
            + max(0.0, 1.0 - pitch / settings.max_pitch)
            + max(0.0, 1.0 - roll / settings.max_roll)
        ) / 3.0
        pose_score = 0.35 * base + 0.65 * (0.5 + 0.5 * slack) if base == 1.0 else base
    return yaw, pitch, roll, min(1.0, max(0.0, pose_score))


def _size_score(det: Detection) -> float:
    s = det.size
    if s <= 0:
        return 0.0
    if s >= settings.face_min_size_px:
        # Grows with size until 2x the minimum.
        rel = s / settings.face_min_size_px
        return min(1.0, 0.6 + 0.4 * min(1.0, (rel - 1.0)))
    # Below the floor → 0 (hard fail, reasons will say so).
    return 0.0


def check_quality(frame_bgr: np.ndarray, det: Detection, face_crop: np.ndarray) -> QualityReport:
    """Full quality assessment for one detection on one frame.

    face_crop: the aligned 112x112 BGR crop used for embedding — quality is
    measured on the actual recognition input, not the full frame.
    """
    reasons: list[str] = []

    gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    sharp, blur_var = _sharpness_score(gray_crop)
    bright, luma, _ = _brightness_score(face_crop)
    yaw, pitch, roll, pose = _pose_scores(det)
    size = _size_score(det)
    conf = min(1.0, det.score)

    if blur_var < settings.blur_threshold:
        reasons.append("TOO_BLURRY")
    if luma < settings.brightness_min:
        reasons.append("TOO_DARK")
    elif luma > settings.brightness_max:
        reasons.append("TOO_BRIGHT")
    if yaw > settings.max_yaw:
        reasons.append("LOOK_OFF_AXIS")
    if pitch > settings.max_pitch:
        reasons.append("LOOK_OFF_AXIS")
    if roll > settings.max_roll:
        reasons.append("TILT_HEAD")
    if det.size < settings.face_min_size_px:
        reasons.append("FACE_TOO_SMALL")
    if det.score < settings.face_min_detection_confidence:
        reasons.append("WEAK_DETECTION")

    quality_score = (
        settings.w_blur * sharp
        + settings.w_brightness * bright
        + settings.w_pose * pose
        + settings.w_size * size
    )

    passed = (
        quality_score >= settings.face_quality_threshold
        and blur_var >= settings.blur_threshold
        and settings.brightness_min <= luma <= settings.brightness_max
        and yaw <= settings.max_yaw
        and pitch <= settings.max_pitch
        and roll <= settings.max_roll
        and det.size >= settings.face_min_size_px
        and det.score >= settings.face_min_detection_confidence
    )

    return QualityReport(
        passed=bool(passed),
        quality_score=round(quality_score, 4),
        sharpness_score=round(sharp, 4),
        brightness_score=round(bright, 4),
        pose_score=round(pose, 4),
        face_confidence=round(conf, 4),
        blur_variance=round(blur_var, 2),
        mean_luma=round(luma, 1),
        yaw=round(yaw, 4),
        pitch=round(pitch, 4),
        roll=round(roll, 4),
        face_size_px=int(det.size),
        reasons=tuple(reasons),
    )
