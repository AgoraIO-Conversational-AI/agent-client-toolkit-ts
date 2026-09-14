from __future__ import annotations

import asyncio

import pytest

from server.src.agent import AgentService, TOKEN_LIFETIME_SECONDS


def test_requires_agora_credentials(monkeypatch):
    monkeypatch.delenv("AGORA_APP_ID", raising=False)
    monkeypatch.delenv("AGORA_APP_CERTIFICATE", raising=False)
    with pytest.raises(ValueError, match="AGORA_APP_ID"):
        AgentService()


def test_rejects_example_placeholders():
    with pytest.raises(ValueError, match="AGORA_APP_ID"):
        AgentService("your_agora_app_id", "your_agora_app_certificate")


def test_start_builds_managed_pipeline_and_turn_modes(monkeypatch):
    service = AgentService("0" * 32, "1" * 32)
    captured = {}

    class FakeSession:
        async def start(self):
            return "agent-123"

    def fake_create_async_session(sdk_agent, **kwargs):
        captured["config"] = sdk_agent.config
        captured["session"] = kwargs
        return FakeSession()

    from agora_agent.agentkit import Agent

    monkeypatch.setattr(Agent, "create_async_session", fake_create_async_session)
    result = asyncio.run(
        service.start(
            channel_name="channel-test",
            agent_uid=98765432,
            user_uid=123456,
            start_of_speech_mode="manual",
            end_of_speech_mode="semantic",
        )
    )

    assert result["agent_id"] == "agent-123"
    assert captured["config"]["turn_detection"]["config"] == {
        "start_of_speech": {"mode": "manual"},
        "end_of_speech": {"mode": "semantic"},
    }
    assert captured["config"]["advanced_features"] == {
        "enable_sal": False,
        "enable_rtm": True,
    }
    assert captured["config"]["parameters"] == {
        "data_channel": "rtm",
        "enable_metrics": True,
        "enable_error_message": True,
    }
    assert captured["session"]["agent_uid"] == "98765432"
    assert captured["session"]["remote_uids"] == ["123456"]
    assert captured["session"]["idle_timeout"] == 120
    assert captured["session"]["expires_in"] == TOKEN_LIFETIME_SECONDS
    assert captured["session"]["enable_string_uid"] is False
    assert captured["config"]["stt"] == {"vendor": "ares"}
    assert captured["config"]["llm"]["params"]["model"] == "gpt-4o-mini"
    assert "api_key" not in captured["config"]["llm"]
    assert captured["config"]["tts"]["vendor"] == "minimax"
    assert captured["config"]["tts"]["_minimax_preset_model"] == "speech_2_6_turbo"
    assert "key" not in captured["config"]["tts"]["params"]
    assert captured["session"]["name"].startswith("web-")


def test_start_rejects_invalid_turn_mode():
    service = AgentService("0" * 32, "1" * 32)
    with pytest.raises(ValueError, match="startOfSpeechMode"):
        asyncio.run(
            service.start("channel", 1, 2, "invalid", "vad")
        )


def test_stop_uses_tracked_session_then_stateless_fallback(monkeypatch):
    service = AgentService("0" * 32, "1" * 32)
    calls = []

    class FakeSession:
        async def stop(self):
            calls.append("session")

    async def fake_stop_agent(agent_id: str):
        calls.append(f"fallback:{agent_id}")

    service._sessions["tracked"] = FakeSession()
    monkeypatch.setattr(service.client, "stop_agent", fake_stop_agent)

    asyncio.run(service.stop("tracked"))
    asyncio.run(service.stop("unknown"))
    assert calls == ["session", "fallback:unknown"]
