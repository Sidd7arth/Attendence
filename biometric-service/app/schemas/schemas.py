"""Pydantic request/response schemas for the biometric API."""
from __future__ import annotations

from pydantic import BaseModel, Field


class EnrollRequest(BaseModel):
    frames: list[str] = Field(..., min_length=1, max_length=16,
                              description="Base64 (or data-URL) JPEG/PNG frames")


class VerifyRequest(BaseModel):
    frames: list[str] = Field(..., min_length=1, max_length=16,
                              description="Base64 (or data-URL) JPEG/PNG frames")
    mode: str = Field(..., pattern="^(SELF|KIOSK)$")
    student_id: str | None = Field(None, max_length=64,
                                   description="Required for SELF mode (authenticated context)")


class ErrorResponse(BaseModel):
    ok: bool = False
    code: str
    detail: str
