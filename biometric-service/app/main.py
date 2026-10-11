"""EduTrack Biometric Service — FastAPI application entry point.

Real server-side face biometrics:
  detection (YuNet) → exactly-one-face → quality (blur/brightness/pose/size)
  → alignment (5-point) → liveness (MiniFASNet ensemble) → SFace embedding
  → cosine matching (1:1 / 1:N) — all computed HERE, never trusted from a client.

Start:
  uvicorn app.main:app --host 127.0.0.1 --port 3010 --workers 1
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .api import enrollment, health, verification
from .config import settings
from .core.exceptions import BiometricError, UnauthorizedCallerError
from .core.model_manager import model_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("biometric.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("initializing biometric models (CPU ONNX)…")
    model_manager.initialize()
    logger.info("biometric service ready on %s:%d", settings.host, settings.port)
    yield
    logger.info("biometric service shutting down")


app = FastAPI(
    title="EduTrack Biometric Service",
    version=settings.service_version,
    lifespan=lifespan,
)

app.include_router(health.router, tags=["health"])
app.include_router(enrollment.router, tags=["enrollment"])
app.include_router(verification.router, tags=["verification"])


@app.exception_handler(UnauthorizedCallerError)
async def unauthorized_handler(_req: Request, exc: UnauthorizedCallerError):
    return JSONResponse(status_code=401, content={"ok": False, "code": exc.code, "detail": exc.detail})


@app.exception_handler(BiometricError)
async def biometric_error_handler(_req: Request, exc: BiometricError):
    return JSONResponse(status_code=exc.status, content=exc.to_body())
