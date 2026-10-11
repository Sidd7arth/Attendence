"""Liveness / anti-spoof — MiniFASNet ensemble (Silent-Face-Anti-Spoofing).

Real presentation-attack detection: deep models decide whether the face
pixels come from a live person or a printed photo / screen replay. This is
server-side CV on the actual frames — no gesture heuristics, no client trust.

Reference preprocessing (minivision-ai/Silent-Face-Anti-Spoofing, and the
ONNX port we deploy):
  * each model crops the face box expanded by ITS OWN scale
    ("2.7_80x80_MiniFASNetV2" → 2.7x, "4_0_0_80x80_MiniFASNetV1SE" → 4.0x)
    using the boundary-preserving _get_new_box algorithm
  * resize to 80x80, keep BGR, values stay in [0, 255] (NO normalization)
  * softmax per model, then AVERAGE the softmax outputs
  * 3-class head: 0 = paper photo, 1 = REAL face, 2 = screen replay

Decision model (spec PART 7 — four states):
  LIVE            P(real) >= LIVENESS_PASS_THRESHOLD
  FAKE            P(real) <= LIVENESS_FAKE_THRESHOLD
  UNCERTAIN       in between  → fail-closed: never creates attendance
  INPUT_REJECTED  face crop could not be assessed at all
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np

from ..config import settings
from ..core.model_manager import model_manager
from .detection import Detection


class LivenessLabel(str, Enum):
    LIVE = "LIVE"
    FAKE = "FAKE"
    UNCERTAIN = "UNCERTAIN"
    INPUT_REJECTED = "INPUT_REJECTED"


@dataclass(frozen=True)
class LivenessResult:
    label: LivenessLabel
    score: float              # mean P(real) across the ensemble
    model: str                # method identifier stamped into templates/audits
    real_prob: float
    paper_prob: float
    screen_prob: float
    per_model: tuple[float, ...]


def parse_scale(model_path: str) -> float:
    """'2.7_80x80_MiniFASNetV2.onnx' → 2.7 ; '4_0_0_80x80_...' → 4.0"""
    first = model_path.split("/")[-1].split("_")[0]
    if first == "4":
        return 4.0
    try:
        return float(first)
    except ValueError:
        return 2.7


def _get_new_box(src_w: int, src_h: int, bbox: tuple[int, int, int, int], scale: float):
    """Reference boundary-preserving box expansion (Silent-Face-Anti-Spoofing)."""
    x, y, box_w, box_h = bbox
    scale = min((src_h - 1) / box_h, min((src_w - 1) / box_w, scale))

    new_width = box_w * scale
    new_height = box_h * scale
    center_x = box_w / 2 + x
    center_y = box_h / 2 + y

    left_top_x = center_x - new_width / 2
    left_top_y = center_y - new_height / 2
    right_bottom_x = center_x + new_width / 2
    right_bottom_y = center_y + new_height / 2

    if left_top_x < 0:
        right_bottom_x -= left_top_x
        left_top_x = 0
    if left_top_y < 0:
        right_bottom_y -= left_top_y
        left_top_y = 0
    if right_bottom_x > src_w - 1:
        left_top_x -= right_bottom_x - src_w + 1
        right_bottom_x = src_w - 1
    if right_bottom_y > src_h - 1:
        left_top_y -= right_bottom_y - src_h + 1
        right_bottom_y = src_h - 1

    return int(left_top_x), int(left_top_y), int(right_bottom_x), int(right_bottom_y)


def _preprocess(frame_bgr: np.ndarray, det: Detection, scale: float) -> np.ndarray | None:
    """Per-model crop → (1,3,80,80) float32 in [0,255], CHW, BGR."""
    src_h, src_w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = _get_new_box(src_w, src_h, (det.x, det.y, det.w, det.h), scale)
    if x2 <= x1 or y2 <= y1:
        return None
    crop = frame_bgr[y1 : y2 + 1, x1 : x2 + 1]
    if crop.size == 0:
        return None
    crop = cv2.resize(crop, (80, 80), interpolation=cv2.INTER_LINEAR)
    chw = np.transpose(crop.astype(np.float32), (2, 0, 1))
    return chw[np.newaxis, ...]


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - np.max(x))
    return e / e.sum()


def assess_liveness(frame_bgr: np.ndarray, det: Detection) -> LivenessResult:
    """Assess one face crop with the full ensemble."""
    sessions = model_manager.antispoof_with_scale
    if not sessions:
        return LivenessResult(LivenessLabel.INPUT_REJECTED, 0.0, "minifasnet-ensemble", 0.0, 0.0, 0.0, ())

    probs_sum = np.zeros(3, dtype=np.float64)
    per_model: list[float] = []
    assessed = False

    for sess, scale in sessions:
        blob = _preprocess(frame_bgr, det, scale)
        if blob is None:
            continue
        logits = np.asarray(sess.run(None, {model_manager.antispoof_input_name: blob})[0][0], dtype=np.float64)
        probs = _softmax(logits)
        probs_sum += probs
        per_model.append(float(probs[1]))
        assessed = True

    if not assessed:
        return LivenessResult(LivenessLabel.INPUT_REJECTED, 0.0, "minifasnet-ensemble", 0.0, 0.0, 0.0, ())

    mean_probs = probs_sum / len(per_model)
    real_p, paper_p, screen_p = float(mean_probs[1]), float(mean_probs[0]), float(mean_probs[2])

    if real_p >= settings.liveness_pass_threshold:
        label = LivenessLabel.LIVE
    elif real_p <= settings.liveness_fake_threshold:
        label = LivenessLabel.FAKE
    else:
        label = LivenessLabel.UNCERTAIN

    return LivenessResult(
        label=label,
        score=round(real_p, 4),
        model="minifasnet-ensemble",
        real_prob=round(real_p, 4),
        paper_prob=round(paper_p, 4),
        screen_prob=round(screen_p, 4),
        per_model=tuple(round(p, 4) for p in per_model),
    )
