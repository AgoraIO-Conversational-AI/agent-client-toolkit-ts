"""FastAPI facade used by the local Web toolkit playground."""

from __future__ import annotations

import logging
import os
import random
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from agora_agent.agentkit.token import generate_convo_ai_token

from .agent import AgentService, TOKEN_LIFETIME_SECONDS

logger = logging.getLogger("uvicorn.error")

SERVER_DIR = Path(__file__).resolve().parent.parent
load_dotenv(SERVER_DIR / ".env")
load_dotenv(SERVER_DIR / ".env.local", override=True)


class StartAgentRequest(BaseModel):
    channelName: str = Field(min_length=1)
    agentUid: int = Field(gt=0)
    userUid: int = Field(gt=0)
    startOfSpeechMode: str
    endOfSpeechMode: str


class StopAgentRequest(BaseModel):
    agentId: str = Field(min_length=1)


def success(data: Any = None) -> dict[str, Any]:
    return {"code": 0, "data": data, "msg": "success"}


def error_response(status_code: int, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "data": None, "msg": message},
    )


def create_agent_service() -> AgentService | None:
    try:
        return AgentService()
    except ValueError as exc:
        logger.warning("Agora backend is not configured: %s", exc)
        return None


agent_service = create_agent_service()

app = FastAPI(
    title="Agora Conversational AI Playground Backend",
    version="1.0.0",
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(
    _request: Request,
    _exc: RequestValidationError,
) -> JSONResponse:
    return error_response(422, 422, "Invalid request")


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return error_response(exc.status_code, exc.status_code, message)


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled backend error error_type=%s", type(exc).__name__)
    return error_response(500, 500, "Internal server error")


def require_agent_service() -> AgentService:
    if agent_service is None:
        raise HTTPException(
            status_code=503,
            detail="Backend is not configured. Check server/.env.local.",
        )
    return agent_service


def generate_channel_name() -> str:
    return f"channel_web_{int(time.time())}_{random.randint(1000, 9999)}"


@app.get("/")
async def root() -> dict[str, Any]:
    return success(
        {
            "service": "Agora Conversational AI Playground Backend",
            "configured": agent_service is not None,
            "health": "/health",
            "docs": "/docs",
        }
    )


@app.get("/favicon.ico", include_in_schema=False)
async def favicon() -> Response:
    return Response(status_code=204)


@app.get("/health")
async def health() -> dict[str, Any]:
    require_agent_service()
    return success({"configured": True})


@app.get("/get_config")
async def get_config(
    channel: str | None = Query(default=None),
    uid: int | None = Query(default=None),
) -> dict[str, Any]:
    service = require_agent_service()
    user_uid = uid if uid is not None and uid > 0 else random.randint(100000, 999999)
    agent_uid = random.randint(10_000_000, 99_999_999)
    channel_name = channel.strip() if channel and channel.strip() else generate_channel_name()

    token = generate_convo_ai_token(
        app_id=service.app_id,
        app_certificate=service.app_certificate,
        channel_name=channel_name,
        uid=user_uid,
        token_expire=TOKEN_LIFETIME_SECONDS,
    )
    return success(
        {
            "app_id": service.app_id,
            "token": token,
            "uid": str(user_uid),
            "agent_uid": str(agent_uid),
            "channel_name": channel_name,
        }
    )


@app.post("/startAgent")
async def start_agent(request: StartAgentRequest) -> dict[str, Any]:
    service = require_agent_service()
    try:
        result = await service.start(
            channel_name=request.channelName,
            agent_uid=request.agentUid,
            user_uid=request.userUid,
            start_of_speech_mode=request.startOfSpeechMode,
            end_of_speech_mode=request.endOfSpeechMode,
        )
        return success(result)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Failed to start agent channel=%s agent_uid=%s user_uid=%s",
            request.channelName,
            request.agentUid,
            request.userUid,
        )
        raise HTTPException(status_code=502, detail="Failed to start agent") from exc


@app.post("/stopAgent")
async def stop_agent(request: StopAgentRequest) -> dict[str, Any]:
    service = require_agent_service()
    try:
        await service.stop(request.agentId)
        return success()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Failed to stop agent agent_id=%s", request.agentId)
        raise HTTPException(status_code=502, detail="Failed to stop agent") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("PORT", "8002")),
        reload=False,
    )
