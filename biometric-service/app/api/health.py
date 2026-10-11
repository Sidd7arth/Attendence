"""Health endpoints — liveness of the SERVICE and readiness of the MODELS."""
from __future__ import annotations

from fastapi import APIRouter

from ..config import settings
from ..core.model_manager import model_manager
from ..repositories import biometric_repository

router = APIRouter()


@router.get("/health")
def health() -> dict:
    """Process is up. (Uvicorn/Gateway readiness probe.)"""
    return {"ok": True, "service": settings.service_name, "version": settings.service_version}


@router.get("/ready")
def ready() -> dict:
    """Biometric computation is actually usable (models loaded, DB reachable)."""
    return {
        "ok": model_manager.ready and biometric_repository.database_reachable(),
        "models_ready": model_manager.ready,
        "database_reachable": biometric_repository.database_reachable(),
        "model": {
            "name": settings.model_name,
            "version": settings.model_version,
            "embedding_dim": settings.embedding_dim,
        },
    }
