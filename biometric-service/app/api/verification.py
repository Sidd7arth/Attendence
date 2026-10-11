"""Verification API — POST /verify (internal, token-gated).

Called ONLY by the EduTrack Next.js server after session authentication.
mode=SELF requires the authenticated student context; mode=KIOSK performs
1:N identification. The decision returned here is server-computed CV —
the application layer then applies attendance business rules.
"""
from __future__ import annotations

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from ..core.exceptions import BiometricError
from ..core.model_manager import model_manager
from ..core.security import require_internal_token
from ..schemas.schemas import VerifyRequest
from ..services import verification_service

router = APIRouter()


@router.post("/verify")
def verify(req: VerifyRequest, x_internal_token: str | None = Header(default=None)) -> JSONResponse:
    try:
        model_manager.require_ready()
        require_internal_token(x_internal_token, operation="verify", caller_key="next-server")
        body = verification_service.verify_from_frames(req.frames, req.mode, req.student_id)
        status = 200 if body.get("ok") else 422
        return JSONResponse(status_code=status, content=body)
    except BiometricError as e:
        return JSONResponse(status_code=e.status, content=e.to_body())
