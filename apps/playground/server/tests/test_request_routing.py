from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest

from server.src.agent import AgentService

APP_ID = "0" * 32
APP_CERTIFICATE = "1" * 32
CARTESIA_API_KEY = "test-cartesia-api-key"
CUSTOM_BASE_URL = "https://api.example.test/preview"


@pytest.mark.parametrize(
    ("base_url", "namespace"),
    [
        (None, None),
        (" ", " "),
        (None, " test-namespace "),
        (CUSTOM_BASE_URL, None),
        (CUSTOM_BASE_URL, " test-namespace "),
        (f" {CUSTOM_BASE_URL}/ ", "test-namespace"),
    ],
)
@pytest.mark.parametrize("tracked_stop_fails", [False, True])
@pytest.mark.parametrize("tts_vendor", ["minimax", "cartesia"])
def test_agent_requests_preserve_routing_and_authentication(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    base_url: str | None,
    namespace: str | None,
    tracked_stop_fails: bool,
    tts_vendor: str,
) -> None:
    caplog.set_level("DEBUG", logger="agora_agent")
    for name, value in {
        "AGORA_AGENTS_API_BASE_URL": base_url,
        "AGORA_AGENTS_SERVICE_NAMESPACE": namespace,
        "AGENT_TTS_VENDOR": tts_vendor,
        "CARTESIA_API_KEY": CARTESIA_API_KEY,
    }.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    requests: list[httpx.Request] = []

    def handle_request(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/join"):
            return httpx.Response(200, json={"agent_id": "agent-test"})
        if tracked_stop_fails and len(requests) == 2:
            return httpx.Response(400, json={"message": "Tracked stop failed"})
        return httpx.Response(200, json={})

    async def exercise_lifecycle() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handle_request)
        ) as http_client:
            def create_httpx_client(**kwargs: Any) -> httpx.AsyncClient:
                http_client.event_hooks.update(kwargs.get("event_hooks", {}))
                return http_client

            monkeypatch.setattr(httpx, "AsyncClient", create_httpx_client)
            service = AgentService(APP_ID, APP_CERTIFICATE)
            configured_url = (base_url or "").strip().rstrip("/")
            expected_base_url = (
                f"{configured_url}/api/conversational-ai-agent"
                if configured_url
                else service.client.get_current_url()
            )
            assert service.client.get_current_url() == expected_base_url
            result = await service.start(
                "channel-test", 98765432, 123456, "vad", "vad"
            )
            assert result["agent_id"] == "agent-test"
            await service.stop(result["agent_id"])
            await service.stop("agent-unknown")
            prefix = f"{expected_base_url}/v2/projects/{APP_ID}"
            expected_urls = [
                f"{prefix}/join",
                f"{prefix}/agents/agent-test/leave",
            ]
            if tracked_stop_fails:
                expected_urls.append(f"{prefix}/agents/agent-test/leave")
            expected_urls.append(f"{prefix}/agents/agent-unknown/leave")
            assert [str(request.url) for request in requests] == expected_urls
            assert requests[0].headers["Content-Type"] == "application/json"
            for request in requests:
                assert request.method == "POST"
                assert request.headers.get("X-Service-Namespace") == (
                    (namespace or "").strip() or None
                )
                assert request.headers["Authorization"].startswith("agora token=")

    asyncio.run(exercise_lifecycle())

    sdk_messages = [
        record.getMessage()
        for record in caplog.records
        if record.name == "agora_agent"
    ]
    request_messages = [
        message for message in sdk_messages if message.startswith("HTTP request:")
    ]
    response_messages = [
        message for message in sdk_messages if message.startswith("HTTP response:")
    ]
    assert len(request_messages) == len(requests)
    assert len(response_messages) == len(requests)
    if tracked_stop_fails:
        assert any("status=400" in message for message in response_messages)
    for request, message in zip(requests, request_messages):
        assert str(request.url).replace(APP_ID, "[REDACTED]") in message
        assert request.headers["Authorization"] not in message
        if namespace and namespace.strip():
            assert f"'x-service-namespace': '{namespace.strip()}'" in message

    request_body = json.loads(requests[0].content)
    logged_body = json.loads(request_messages[0].split(" body=", 1)[1])
    assert logged_body["properties"]["token"] == "[REDACTED]"
    tts = request_body["properties"]["tts"]
    if tts_vendor == "cartesia":
        assert tts["credential_mode"] == "byok"
        assert tts["params"]["api_key"] == CARTESIA_API_KEY
        assert logged_body["properties"]["tts"] == {
            **tts,
            "params": {**tts["params"], "api_key": "[REDACTED]"},
        }
    else:
        assert tts["vendor"] == "minimax"
        assert "api_key" not in tts["params"]
        assert logged_body["properties"]["tts"] == tts
    assert CARTESIA_API_KEY not in caplog.text
    assert request_body["properties"]["token"] not in caplog.text
    assert APP_ID not in caplog.text
    assert APP_CERTIFICATE not in caplog.text
