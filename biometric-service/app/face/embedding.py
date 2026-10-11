"""Face embedding — SFace 128-D, L2-normalized.

One authoritative embedding per aligned crop. The browser NEVER produces
embeddings; this service is the single source of biometric templates.
"""
from __future__ import annotations

import numpy as np

from ..config import settings
from ..core.model_manager import model_manager


def l2_normalize(vec: np.ndarray) -> np.ndarray:
    v = vec.astype(np.float64).ravel()
    norm = float(np.linalg.norm(v))
    if norm < 1e-12:
        raise ValueError("zero-norm embedding cannot be normalized")
    return (v / norm).astype(np.float64)


def embed(aligned_face_bgr: np.ndarray) -> np.ndarray:
    """Aligned BGR crop → L2-normalized 128-D embedding (float64)."""
    model_manager.require_ready()
    feat = model_manager.recognizer.feature(aligned_face_bgr)  # (1, 128) float32
    if feat is None or feat.size != settings.embedding_dim:
        raise ValueError(f"unexpected embedding dimension: {None if feat is None else feat.size}")
    return l2_normalize(np.asarray(feat, dtype=np.float64))


def aggregate_embeddings(embeddings: list[np.ndarray]) -> np.ndarray:
    """Multi-frame aggregation: mean of L2-normalized vectors, re-normalized.

    Outlier rejection: any frame whose cosine similarity to the running
    centroid is below the keep-floor is dropped (identity consistency) —
    with the strict per-frame quality gates upstream this mainly guards
    against a single mis-detection.
    """
    if not embeddings:
        raise ValueError("no embeddings to aggregate")
    matrix = np.vstack([e for e in embeddings])
    centroid = l2_normalize(matrix.mean(axis=0))
    if len(embeddings) >= 4:
        sims = matrix @ centroid
        keep_floor = 0.15  # generous: only drops clear outliers
        good = sims >= keep_floor
        if good.sum() >= max(2, len(embeddings) // 2):
            centroid = l2_normalize(matrix[good].mean(axis=0))
    return centroid
