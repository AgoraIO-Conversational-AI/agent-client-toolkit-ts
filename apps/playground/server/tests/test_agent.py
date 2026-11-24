from __future__ import annotations

import asyncio
import os

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


def test_sdk_client_uses_overseas_region():
    service = AgentService("0" * 32, "1" * 32)

    assert service.client.area_scope == "global"


@pytest.mark.parametrize(
    "name", ["CARTESIA_API_KEY", "CARTESIA_VOICE_ID", "CARTESIA_MODEL_ID"]
)
@pytest.mark.parametrize("value", [None, "", " ", "your_cartesia_value"])
def test_requires_selected_cartesia_configuration(monkeypatch, name, value):
    monkeypatch.setenv("AGENT_TTS_VENDOR", "cartesia")
    monkeypatch.setenv("CARTESIA_API_KEY", "test-cartesia-api-key")
    if value is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        AgentService("0" * 32, "1" * 32)


@pytest.mark.parametrize("vendor", [None, "", " ", "unsupported"])
def test_rejects_missing_or_unknown_tts_vendor(monkeypatch, vendor):
    if vendor is None:
        monkeypatch.delenv("AGENT_TTS_VENDOR", raising=False)
    else:
        monkeypatch.setenv("AGENT_TTS_VENDOR", vendor)
    with pytest.raises(ValueError, match="AGENT_TTS_VENDOR"):
        AgentService("0" * 32, "1" * 32)


@pytest.mark.parametrize(
    ("tts_vendor", "cartesia_api_key", "voice_id", "model_id"),
    [
        (None, None, None, None),
        ("minimax", "", "", ""),
        (" minimax ", "your_cartesia_api_key", None, None),
        ("MINIMAX", "unused-cartesia-key", None, None),
        ("cartesia", "test-cartesia-api-key", None, None),
        (" Cartesia ", " second-cartesia-api-key ", " custom-voice ", " sonic-2 "),
    ],
)
def test_start_builds_selected_pipeline_and_turn_modes(
    monkeypatch, tts_vendor, cartesia_api_key, voice_id, model_id
):
    for name, value in {
        "AGENT_TTS_VENDOR": tts_vendor,
        "CARTESIA_API_KEY": cartesia_api_key,
        "CARTESIA_VOICE_ID": voice_id,
        "CARTESIA_MODEL_ID": model_id,
    }.items():
        if value is not None:
            monkeypatch.setenv(name, value)
    monkeypatch.setenv("AGENT_PROMPT", "Test system prompt")
    monkeypatch.setenv("AGENT_GREETING", "Test greeting")
    monkeypatch.setenv("AGENT_FAILURE_MESSAGE", "Test failure message")
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
    assert captured["config"]["llm"]["system_messages"] == [
        {"role": "system", "content": "Test system prompt"}
    ]
    assert captured["config"]["llm"]["greeting_message"] == "Test greeting"
    assert captured["config"]["llm"]["failure_message"] == "Test failure message"
    if (tts_vendor or "").strip().lower() == "cartesia":
        assert captured["config"]["tts"] == {
            "vendor": "cartesia",
            "credential_mode": "byok",
            "params": {
                "api_key": cartesia_api_key.strip(),
                "model_id": os.environ["CARTESIA_MODEL_ID"].strip(),
                "voice": {"mode": "id", "id": os.environ["CARTESIA_VOICE_ID"].strip()},
            },
        }
    else:
        assert captured["config"]["tts"] == {
            "vendor": "minimax",
            "_minimax_preset_model": "speech_2_6_turbo",
            "params": {"voice_setting": {"voice_id": "English_captivating_female1"}},
        }
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
