"""Enrollment service — frames → verified live template + metadata.

Enrollment is biometric computation ONLY: the caller (Next.js, admin-gated)
persists the returned template. Liveness is mandatory here too (PART 7) —
a photo can never enroll.
"""
from __future__ import annotations

from typing import Any

from ..face.pipeline import PipelineResult, process_frames


def enroll_from_frames(frames_b64: list[str]) -> dict[str, Any]:
    result: PipelineResult = process_frames(frames_b64)
    return {
        "ok": True,
        "embedding": [round(float(x), 6) for x in result.embedding],
        "embedding_dim": result.model["embedding_dim"],
        "samples_used": result.frames_used,
        "frames_received": result.frames_received,
        "quality": result.quality_reports,
        "quality_mean": result.model["quality_mean"],
        "liveness": result.liveness_summary,
        "model": result.model,
    }
