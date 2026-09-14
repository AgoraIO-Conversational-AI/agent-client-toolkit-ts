def test_root_is_a_human_readable_smoke_check(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "code": 0,
        "data": {
            "service": "Agora Conversational AI Playground Backend",
            "configured": True,
            "health": "/health",
            "docs": "/docs",
        },
        "msg": "success",
    }

    favicon = client.get("/favicon.ico")
    assert favicon.status_code == 204


def test_health_reports_configured(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "code": 0,
        "data": {"configured": True},
        "msg": "success",
    }


def test_get_config_honors_channel_and_uid(client):
    response = client.get(
        "/get_config",
        params={"channel": "channel-kotlin-test", "uid": 123456},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 0
    assert body["data"]["app_id"] == "0123456789abcdef0123456789abcdef"
    assert body["data"]["channel_name"] == "channel-kotlin-test"
    assert body["data"]["uid"] == "123456"
    assert body["data"]["agent_uid"].isdigit()
    assert body["data"]["token"].startswith("007")


def test_get_config_replaces_non_positive_uid(client):
    response = client.get("/get_config", params={"uid": 0})
    assert response.status_code == 200
    assert int(response.json()["data"]["uid"]) > 0


def test_start_agent_forwards_independent_turn_modes(client, server_module):
    response = client.post(
        "/startAgent",
        json={
            "channelName": "channel-test",
            "agentUid": 87654321,
            "userUid": 123456,
            "startOfSpeechMode": "manual",
            "endOfSpeechMode": "semantic",
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["agent_id"] == "agent-test-id"
    assert server_module.fake_agent_service.started == [
        {
            "channel_name": "channel-test",
            "agent_uid": 87654321,
            "user_uid": 123456,
            "start_of_speech_mode": "manual",
            "end_of_speech_mode": "semantic",
        }
    ]


def test_invalid_start_request_uses_error_envelope(client):
    response = client.post(
        "/startAgent",
        json={
            "channelName": "channel-test",
            "agentUid": 0,
            "userUid": 123456,
            "startOfSpeechMode": "vad",
            "endOfSpeechMode": "semantic",
        },
    )
    assert response.status_code == 422
    assert response.json() == {"code": 422, "data": None, "msg": "Invalid request"}


def test_sdk_start_failure_does_not_expose_internal_error(client, server_module):
    async def fail_start(**_kwargs):
        raise RuntimeError("internal token or provider detail")

    server_module.fake_agent_service.start = fail_start
    response = client.post(
        "/startAgent",
        json={
            "channelName": "channel-test",
            "agentUid": 87654321,
            "userUid": 123456,
            "startOfSpeechMode": "vad",
            "endOfSpeechMode": "semantic",
        },
    )

    assert response.status_code == 502
    assert response.json() == {
        "code": 502,
        "data": None,
        "msg": "Failed to start agent",
    }
    assert "internal token" not in response.text


def test_stop_agent_is_forwarded(client, server_module):
    response = client.post("/stopAgent", json={"agentId": "agent-test-id"})
    assert response.status_code == 200
    assert response.json() == {"code": 0, "data": None, "msg": "success"}
    assert server_module.fake_agent_service.stopped == ["agent-test-id"]


def test_unconfigured_backend_uses_safe_envelope(client, server_module):
    server_module.agent_service = None
    for path in ("/health", "/get_config"):
        response = client.get(path)
        assert response.status_code == 503
        assert response.json() == {
            "code": 503,
            "data": None,
            "msg": "Backend is not configured. Check server/.env.local.",
        }
