"""Biometric repository — READ-ONLY access to face templates.

PART 4 requires the Python service to reach biometric data through a
repository layer over the SAME single authoritative database (no second
competing store). Persistence of templates remains with the Next.js
application (Prisma); this repository only READS active templates for
matching, with model-compatibility filtering enforced in SQL + Python.
"""
from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from ..config import settings
from ..core.exceptions import RepositoryError
from ..face.matcher import Candidate


@dataclass(frozen=True)
class TemplateRow:
    student_id: str
    embedding_json: str
    model_name: str
    model_version: str
    embedding_version: int
    embedding_dim: int
    status: str


def _connect() -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(f"file:{settings.database_path}?mode=ro", uri=True, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        raise RepositoryError(f"cannot open database: {e}") from e


def _row_to_candidate(row: TemplateRow) -> Candidate | None:
    """Parse + validate a template row. Incompatible rows are skipped (never matched)."""
    if row.status != "ACTIVE":
        return None
    if not (
        row.model_name == settings.model_name
        and row.model_version == settings.model_version
        and row.embedding_version == settings.embedding_version
        and row.embedding_dim == settings.embedding_dim
    ):
        return None
    try:
        vec = json.loads(row.embedding_json)
        if not isinstance(vec, list) or len(vec) != settings.embedding_dim:
            return None
        import numpy as np

        arr = np.asarray(vec, dtype=np.float64)
        if not np.isfinite(arr).all():
            return None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    return Candidate(
        student_id=row.student_id,
        embedding=arr,
        model_name=row.model_name,
        model_version=row.model_version,
        embedding_version=row.embedding_version,
        embedding_dim=row.embedding_dim,
    )


def get_active_template(student_id: str) -> Candidate | None:
    """The single active compatible template of one student (1:1 path)."""
    try:
        with _connect() as conn:
            row = conn.execute(
                """
                SELECT student_id, embedding, model_name, model_version,
                       embedding_version, embedding_dimension, status
                FROM face_profiles
                WHERE student_id = ? AND status = 'ACTIVE'
                """,
                (student_id,),
            ).fetchone()
    except sqlite3.Error as e:
        raise RepositoryError(f"template query failed: {e}") from e

    if row is None:
        return None
    return _row_to_candidate(
        TemplateRow(
            student_id=row["student_id"],
            embedding_json=row["embedding"],
            model_name=row["model_name"],
            model_version=row["model_version"],
            embedding_version=row["embedding_version"],
            embedding_dim=row["embedding_dimension"],
            status=row["status"],
        )
    )


def list_active_templates(student_ids: list[str] | None = None) -> list[Candidate]:
    """All active compatible templates, optionally restricted to students."""
    try:
        with _connect() as conn:
            if student_ids:
                placeholders = ",".join("?" for _ in student_ids)
                rows = conn.execute(
                    f"""
                    SELECT student_id, embedding, model_name, model_version,
                           embedding_version, embedding_dimension, status
                    FROM face_profiles
                    WHERE status = 'ACTIVE' AND student_id IN ({placeholders})
                    """,
                    tuple(student_ids),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT student_id, embedding, model_name, model_version,
                           embedding_version, embedding_dimension, status
                    FROM face_profiles
                    WHERE status = 'ACTIVE'
                    """
                ).fetchall()
    except sqlite3.Error as e:
        raise RepositoryError(f"template list failed: {e}") from e

    candidates: list[Candidate] = []
    for row in rows:
        c = _row_to_candidate(
            TemplateRow(
                student_id=row["student_id"],
                embedding_json=row["embedding"],
                model_name=row["model_name"],
                model_version=row["model_version"],
                embedding_version=row["embedding_version"],
                embedding_dim=row["embedding_dimension"],
                status=row["status"],
            )
        )
        if c is not None:
            candidates.append(c)
    return candidates


def database_reachable() -> bool:
    try:
        with _connect() as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except RepositoryError:
        return False
