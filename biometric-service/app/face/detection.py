"""Face detection — YuNet via cv2.FaceDetectorYN.

Returns structured detections with bounding box, 5 landmarks and score.
Enforces the configured floor: score >= FACE_MIN_DETECTION_CONFIDENCE and
box size >= FACE_MIN_SIZE. Faces below the floor are NOT silently dropped
when that would hide a multiple-faces situation — the pipeline asks for
raw counts too, so 0-face and 2+-face outcomes are always accurate.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ..config import settings
from ..core.model_manager import model_manager


@dataclass(frozen=True)
class Detection:
    """One detected face in pixel coordinates of the source frame."""

    x: int
    y: int
    w: int
    h: int
    score: float
    # 5 landmarks: [right_eye, left_eye, nose_tip, right_mouth, left_mouth]
    landmarks: np.ndarray  # shape (5, 2), float32

    @property
    def size(self) -> int:
        return min(self.w, self.h)


def detect_faces(frame_bgr: np.ndarray) -> list[Detection]:
    """Detect all faces in a BGR frame. Applies configured confidence and
    size floors; small/weak faces are returned separately as 'substandard'
    so the pipeline can distinguish 'no face' from 'face below quality floor'
    and never mis-report multiple faces."""
    model_manager.require_ready()
    h, w = frame_bgr.shape[:2]
    if h == 0 or w == 0:
        return []
    model_manager.set_detector_input_size(w, h)

    # cv2.FaceDetectorYN.detect returns (retval, faces) where faces is
    # None or an (N, 15) array: x, y, w, h, 5 points (x,y each), score.
    _, faces = model_manager.detector.detect(frame_bgr)

    if faces is None or len(faces) == 0:
        return []

    detections: list[Detection] = []
    for row in faces:
        x, y, fw, fh = row[0:4]
        score = float(row[14])
        landmarks = np.array(row[4:14], dtype=np.float32).reshape(5, 2)
        detections.append(
            Detection(
                x=int(x), y=int(y), w=int(fw), h=int(fh), score=score,
                landmarks=landmarks,
            )
        )
    return detections
