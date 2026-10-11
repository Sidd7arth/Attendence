"""Enrollment API — POST /enroll (internal, token-gated).

Called ONLY by the EduTrack Next.js server after ADMIN authorization.
Returns the computed template; persistence stays with the application.
"""
from __future__ import annotations

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from ..core.exceptions import BiometricError, UnauthorizedCallerError
from ..core.model_manager import model_manager
from ..core.security import require_internal_token
from ..schemas.schemas import EnrollRequest
from ..services import enrollment_service

router = APIRouter()


@router.post("/enroll")
def enroll(req: EnrollRequest, x_internal_token: str | None = Header(default=None)) -> JSONResponse:
    try:
        model_manager.require_ready()
        require_internal_token(x_internal_token, operation="enroll", caller_key="next-server")
        body = enrollment_service.enroll_from_frames(req.frames)
        return JSONResponse(status_code=200, content=body)
    except BiometricError as e:
        return JSONResponse(status_code=e.status, content=e.to_body())
    except UnauthorizedCallerError:
        raise
