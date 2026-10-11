"""Face alignment — canonical 5-point similarity alignment to 112x112.

Uses cv2.FaceRecognizerSF.alignCrop, which applies the SR-UIV2-style
similarity transform from the 5 detected landmarks to the exact crop
convention SFace was trained on. This is the real alignment stage of the
pipeline (never a naive rectangle crop).
"""
from __future__ import annotations

import numpy as np

from ..core.model_manager import model_manager
from .detection import Detection


def detection_to_face_box(det: Detection) -> np.ndarray:
    """Rebuild the (15,) row format expected by OpenCV face methods:
    x, y, w, h, 5x(x,y) landmarks, score."""
    box = np.zeros(15, dtype=np.float32)
    box[0:4] = (det.x, det.y, det.w, det.h)
    box[4:14] = det.landmarks.reshape(-1).astype(np.float32)
    box[14] = det.score
    return box


def align_face(frame_bgr: np.ndarray, det: Detection) -> np.ndarray:
    """Return the aligned 112x112 BGR face crop for embedding."""
    model_manager.require_ready()
    face_box = detection_to_face_box(det)
    aligned = model_manager.recognizer.alignCrop(frame_bgr, face_box)
    if aligned is None or aligned.size == 0:
        raise ValueError("alignment produced an empty crop")
    return aligned
