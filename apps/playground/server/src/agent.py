"""Agora Conversational AI agent lifecycle service."""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any

from agora_agent import Area, AsyncAgora
from agora_agent.agentkit import Agent
from agora_agent.agentkit.vendors import AresSTT, MiniMaxTTS, OpenAI

logger = logging.getLogger("uvicorn.error")

TURN_DETECTION_MODES = frozenset({"vad", "semantic", "manual"})
TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

DEFAULT_PROMPT = (
    "You are a concise, helpful voice assistant. Keep replies short unless the "
    "user asks for more detail."
)
DEFAULT_GREETING = "Hello! How can I help you today?"
DEFAULT_FAILURE_MESSAGE = "Please wait a moment."


class AgentService:
    """Builds SDK sessions and keeps active sessions for stateful stop calls."""

    def __init__(self, app_id: str | None = None, app_certificate: str | None = None):
        self.app_id = (app_id or os.getenv("AGORA_APP_ID") or "").strip()
        self.app_certificate = (
            app_certificate or os.getenv("AGORA_APP_CERTIFICATE") or ""
        ).strip()
        if (
            not self.app_id
            or not self.app_certificate
            or self.app_id.startswith("your_")
            or self.app_certificate.startswith("your_")
        ):
            raise ValueError("AGORA_APP_ID and AGORA_APP_CERTIFICATE are required")

        self.prompt = os.getenv("AGENT_PROMPT", DEFAULT_PROMPT)
        self.greeting = os.getenv("AGENT_GREETING", DEFAULT_GREETING)
        self.client = AsyncAgora(
            area=Area.US,
            app_id=self.app_id,
            app_certificate=self.app_certificate,
        )
        self._sessions: dict[str, Any] = {}

    async def start(
        self,
        channel_name: str,
        agent_uid: int,
        user_uid: int,
        start_of_speech_mode: str,
        end_of_speech_mode: str,
    ) -> dict[str, str]:
        channel_name = channel_name.strip()
        if not channel_name:
            raise ValueError("channelName must not be empty")
        if agent_uid <= 0:
            raise ValueError("agentUid must be a positive integer")
        if user_uid <= 0:
            raise ValueError("userUid must be a positive integer")
        self._validate_turn_mode("startOfSpeechMode", start_of_speech_mode)
        self._validate_turn_mode("endOfSpeechMode", end_of_speech_mode)

        sdk_agent = Agent(
            client=self.client,
            turn_detection={
                "mode": "default",
                "language": "en-US",
                "config": {
                    "start_of_speech": {"mode": start_of_speech_mode},
                    "end_of_speech": {"mode": end_of_speech_mode},
                },
            },
            advanced_features={"enable_sal": False, "enable_rtm": True},
            parameters={
                "data_channel": "rtm",
                "enable_metrics": True,
                "enable_error_message": True,
            },
        ).with_stt(
            AresSTT()
        ).with_llm(
            OpenAI(
                model="gpt-4o-mini",
                system_messages=[{"role": "system", "content": self.prompt}],
                greeting_message=self.greeting,
                failure_message=DEFAULT_FAILURE_MESSAGE,
                max_history=50,
                params={
                    "max_tokens": 1024,
                    "temperature": 0.7,
                    "top_p": 0.95,
                },
            )
        ).with_tts(
            MiniMaxTTS(
                model="speech_2_6_turbo",
                voice_id="English_captivating_female1",
            )
        )

        session = sdk_agent.create_async_session(
            name=f"web-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}",
            channel=channel_name,
            agent_uid=str(agent_uid),
            remote_uids=[str(user_uid)],
            enable_string_uid=False,
            idle_timeout=120,
            expires_in=TOKEN_LIFETIME_SECONDS,
        )

        logger.info(
            "Starting Agora agent channel=%s agent_uid=%s user_uid=%s",
            channel_name,
            agent_uid,
            user_uid,
        )
        agent_id = await session.start()
        if not agent_id:
            raise RuntimeError("Agora Agent SDK returned an empty agent ID")

        self._sessions[agent_id] = session
        logger.info("Started Agora agent agent_id=%s channel=%s", agent_id, channel_name)
        return {
            "agent_id": agent_id,
            "channel_name": channel_name,
            "status": "started",
        }

    async def stop(self, agent_id: str) -> None:
        agent_id = agent_id.strip()
        if not agent_id:
            raise ValueError("agentId must not be empty")

        session = self._sessions.pop(agent_id, None)
        if session is not None:
            try:
                await session.stop()
                logger.info("Stopped tracked Agora agent agent_id=%s", agent_id)
                return
            except Exception:
                logger.warning(
                    "Tracked stop failed; using stateless SDK stop agent_id=%s",
                    agent_id,
                    exc_info=True,
                )

        await self.client.stop_agent(agent_id)
        logger.info("Stopped Agora agent through stateless SDK agent_id=%s", agent_id)

    @staticmethod
    def _validate_turn_mode(field: str, mode: str) -> None:
        if mode not in TURN_DETECTION_MODES:
            values = ", ".join(sorted(TURN_DETECTION_MODES))
            raise ValueError(f"{field} must be one of: {values}")
