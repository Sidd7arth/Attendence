"""Verification service — frames → server-computed 1:1 or 1:N decision.

SELF mode: the probe is compared ONLY against the authenticated student's
own active template (1:1). The caller's student_id is authoritative because
the Next.js layer authenticated the session before forwarding.

KIOSK mode: identification against all active compatible templates (1:N)
with the ambiguity-margin rule — uncertain identifications never match.

Liveness must be LIVE (not UNCERTAIN, not FAKE) on every frame that feeds
the match — fail-closed, enforced upstream by the pipeline.
"""
from __future__ import annotations

from typing import Any

from ..face import matcher
from ..face.pipeline import PipelineResult, process_frames
from ..repositories import biometric_repository


def verify_from_frames(frames_b64: list[str], mode: str, student_id: str | None) -> dict[str, Any]:
    result: PipelineResult = process_frames(frames_b64)

    if mode == "SELF":
        if not student_id:
            return {
                "ok": False, "code": "STUDENT_CONTEXT_MISSING",
                "detail": "SELF verification requires the authenticated student context",
            }
        template = biometric_repository.get_active_template(student_id)
        if template is None:
            return {
                "ok": False, "code": "BIOMETRIC_NOT_ENROLLED",
                "detail": "no active biometric template for this student",
                "model": result.model,
            }
        outcome = matcher.decide_1to1(result.embedding, template.embedding)
        return {
            "ok": True,
            "mode": mode,
            "matched": outcome.matched,
            "student_id": template.student_id if outcome.matched else None,
            "similarity": outcome.best_similarity,
            "band": outcome.band,
            "threshold": matcher.settings.match_threshold,
            "frames_used": result.frames_used,
            "quality": result.quality_reports,
            "quality_mean": result.model["quality_mean"],
            "liveness": result.liveness_summary,
            "model": result.model,
        }

    if mode == "KIOSK":
        candidates = biometric_repository.list_active_templates()
        if not candidates:
            return {
                "ok": False, "code": "BIOMETRIC_NOT_ENROLLED",
                "detail": "no active biometric templates exist",
                "model": result.model,
            }
        outcome = matcher.decide_1toN(result.embedding, candidates)
        body: dict[str, Any] = {
            "ok": True,
            "mode": mode,
            "matched": outcome.matched,
            "student_id": outcome.best_student_id,
            "similarity": outcome.best_similarity,
            "runner_up_similarity": outcome.second_similarity,
            "margin_ok": outcome.margin_ok,
            "band": outcome.band,
            "threshold": matcher.settings.match_threshold,
            "candidates_considered": len(candidates),
            "frames_used": result.frames_used,
            "quality": result.quality_reports,
            "quality_mean": result.model["quality_mean"],
            "liveness": result.liveness_summary,
            "model": result.model,
        }
        return body

    return {
        "ok": False, "code": "INVALID_MODE",
        "detail": "mode must be SELF or KIOSK",
    }
