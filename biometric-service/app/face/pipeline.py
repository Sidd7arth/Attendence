"""Pipeline — the single authoritative biometric processing flow (PART 8).

    FRAME(s) → DECODE → DETECT → EXACTLY-ONE-FACE → QUALITY → LANDMARKS
             → ALIGN → LIVENESS → SFACE EMBED → L2-NORMALIZE → AGGREGATE
             → MATCH (1:1 or 1:N) → decision

Hard rules enforced here:
  * every frame must contain EXACTLY ONE face (PART 9):
      - all frames empty        → NO_FACE
      - any frame with >= 2     → MULTIPLE_FACES (never auto-select)
  * liveness is MANDATORY server-side CV (PART 7): LIVE required on the
    accepted frame; FAKE/UNCERTAIN/INPUT_REJECTED block everything.
  * quality must pass per-frame; the report is returned verbatim.
  * the browser sends frames, never claims — every number below is computed
    here from real inference.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import base64
import cv2
import numpy as np

from ..config import settings
from .alignment import align_face
from .detection import Detection, detect_faces
from .embedding import aggregate_embeddings, embed
from .liveness import LivenessLabel, LivenessResult, assess_liveness
from .quality import QualityReport, check_quality
from ..core.exceptions import (
    InputRejectedError,
    LowImageQualityError,
    LivenessFailedError,
    MultipleFacesError,
    NoFaceError,
    TooFewFramesError,
)


@dataclass
class FrameAssessment:
    frame_index: int
    detection: Detection
    aligned: np.ndarray
    embedding: np.ndarray
    quality: QualityReport
    liveness: LivenessResult


@dataclass
class PipelineResult:
    frames_received: int
    frames_used: int
    embedding: np.ndarray                      # aggregated, L2-normalized
    quality_reports: list[dict] = field(default_factory=list)
    liveness_summary: dict = field(default_factory=dict)
    model: dict = field(default_factory=dict)


def decode_frame(b64_or_bytes: str | bytes) -> np.ndarray:
    """One frame (base64 or raw bytes) → BGR ndarray."""
    if isinstance(b64_or_bytes, str):
        # tolerate data URLs ("data:image/jpeg;base64,....")
        if "," in b64_or_bytes[:64] and b64_or_bytes[:5] == "data:":
            b64_or_bytes = b64_or_bytes.split(",", 1)[1]
        try:
            raw = base64.b64decode(b64_or_bytes, validate=False)
        except Exception as e:
            raise InputRejectedError(f"undecodable base64 frame: {e}") from e
    else:
        raw = b64_or_bytes

    if not raw:
        raise InputRejectedError("empty frame")
    if len(raw) > settings.max_frame_bytes:
        raise InputRejectedError("frame exceeds size limit")

    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # BGR
    if img is None or img.size == 0:
        raise InputRejectedError("frame is not a decodable image")
    return img


def assess_frame(frame_bgr: np.ndarray, index: int) -> FrameAssessment:
    """Full per-frame processing for ONE already-decoded frame.

    Raises NoFaceError / MultipleFacesError / LowImageQualityError /
    LivenessFailedError — all fail-closed.
    """
    # 1-2. Detection + exactly-one-face gate
    detections = detect_faces(frame_bgr)
    if len(detections) == 0:
        raise NoFaceError("no face detected in frame", frame_index=index)
    if len(detections) > 1:
        raise MultipleFacesError(
            f"{len(detections)} faces detected in frame — exactly one is required",
            frame_index=index,
            face_count=len(detections),
        )
    det = detections[0]

    # 3-4. Alignment (landmarks → canonical 112x112 crop)
    aligned = align_face(frame_bgr, det)

    # 5. Quality gates on the aligned crop
    quality = check_quality(frame_bgr, det, aligned)
    if not quality.passed:
        raise LowImageQualityError(
            "frame rejected by quality gates",
            frame_index=index,
            quality=quality.to_dict(),
            reason=",".join(quality.reasons),
        )

    # 6. Mandatory server-side liveness
    liveness = assess_liveness(frame_bgr, det)
    if liveness.label != LivenessLabel.LIVE:
        raise LivenessFailedError(
            f"liveness check did not pass ({liveness.label.value})",
            frame_index=index,
            liveness={
                "label": liveness.label.value,
                "score": liveness.score,
                "model": liveness.model,
            },
        )

    # 7-8. Embedding + L2 normalization
    vec = embed(aligned)

    return FrameAssessment(
        frame_index=index,
        detection=det,
        aligned=aligned,
        embedding=vec,
        quality=quality,
        liveness=liveness,
    )


def process_frames(frames_b64: list[str]) -> PipelineResult:
    """Decode + assess every frame, aggregate into one probe template."""
    if not frames_b64 or not isinstance(frames_b64, list):
        raise TooFewFramesError("no frames provided")
    if len(frames_b64) < settings.min_frames:
        raise TooFewFramesError(
            f"at least {settings.min_frames} frames are required",
            received=len(frames_b64),
        )
    if len(frames_b64) > settings.max_frames:
        raise InputRejectedError(
            f"at most {settings.max_frames} frames are allowed",
            received=len(frames_b64),
        )

    assessments: list[FrameAssessment] = []
    for i, f in enumerate(frames_b64):
        img = decode_frame(f)
        assessments.append(assess_frame(img, i))

    probe = aggregate_embeddings([a.embedding for a in assessments])

    # Liveness summary: every accepted frame was LIVE — report the weakest
    # margin so the application can see how close the batch was to failing.
    weakest = min(assessments, key=lambda a: a.liveness.score).liveness
    mean_quality = float(np.mean([a.quality.quality_score for a in assessments]))

    return PipelineResult(
        frames_received=len(frames_b64),
        frames_used=len(assessments),
        embedding=probe,
        quality_reports=[a.quality.to_dict() for a in assessments],
        liveness_summary={
            "label": "LIVE",
            "score": weakest.score,
            "model": weakest.model,
            "per_frame_scores": [a.liveness.score for a in assessments],
        },
        model={
            "name": settings.model_name,
            "version": settings.model_version,
            "embedding_version": settings.embedding_version,
            "embedding_dim": settings.embedding_dim,
            "quality_mean": round(mean_quality, 4),
        },
    )
