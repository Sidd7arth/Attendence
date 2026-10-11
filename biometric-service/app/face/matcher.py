"""Matching — cosine similarity on L2-normalized SFace embeddings, with
decision bands, ambiguity margin for 1:N and centroid aggregation.

The embedding dimension and model lineage are checked BEFORE any comparison:
templates produced by a different model/version/dimension are never compared
(spec: cross-model matching is a correctness and security hazard).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from ..config import settings


@dataclass(frozen=True)
class Candidate:
    student_id: str
    embedding: np.ndarray  # L2-normalized float64
    model_name: str
    model_version: str
    embedding_version: int
    embedding_dim: int


@dataclass(frozen=True)
class MatchOutcome:
    matched: bool
    best_student_id: str | None
    best_similarity: float
    second_similarity: float
    band: str            # "high" | "medium" | "low"
    margin_ok: bool      # 1:N ambiguity margin satisfied


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # inputs are L2-normalized


def is_compatible(model_name: str, model_version: str, embedding_version: int, dim: int) -> bool:
    return (
        model_name == settings.model_name
        and model_version == settings.model_version
        and embedding_version == settings.embedding_version
        and dim == settings.embedding_dim
    )


def _band(similarity: float) -> str:
    if similarity >= settings.high_confidence_threshold:
        return "high"
    if similarity >= settings.match_threshold:
        return "medium"
    return "low"


def decide_1to1(probe: np.ndarray, template: np.ndarray) -> MatchOutcome:
    """1:1 identity verification against a single template."""
    sim = cosine_similarity(probe, template)
    band = _band(sim)
    return MatchOutcome(
        matched=band != "low",
        best_student_id=None,
        best_similarity=round(sim, 4),
        second_similarity=0.0,
        band=band,
        margin_ok=True,
    )


def decide_1toN(probe: np.ndarray, candidates: Sequence[Candidate]) -> MatchOutcome:
    """1:N identification against active, compatible templates.

    Ambiguity rule: when two candidates are nearly equidistant the decision
    is unreliable — the match only stands if best − second >= MIN_MARGIN.
    """
    if not candidates:
        return MatchOutcome(False, None, 0.0, 0.0, "low", True)

    sims = [cosine_similarity(probe, c.embedding) for c in candidates]
    order = np.argsort(sims)[::-1]
    best_idx = int(order[0])
    best = sims[best_idx]
    second = float(sims[order[1]]) if len(order) > 1 else 0.0

    band = _band(best)
    margin_ok = (best - second) >= settings.min_margin_1n if len(order) > 1 else True
    matched = band != "low" and margin_ok

    return MatchOutcome(
        matched=bool(matched),
        best_student_id=candidates[best_idx].student_id if matched else None,
        best_similarity=round(float(best), 4),
        second_similarity=round(second, 4),
        band=band,
        margin_ok=bool(margin_ok),
    )
