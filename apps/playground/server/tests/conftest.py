from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVER_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class FakeAgentService:
    app_id = "0123456789abcdef0123456789abcdef"
    app_certificate = "fedcba9876543210fedcba9876543210"

    def __init__(self) -> None:
        self.started: list[dict[str, object]] = []
        self.stopped: list[str] = []

    async def start(self, **kwargs):
        self.started.append(kwargs)
        return {
            "agent_id": "agent-test-id",
            "channel_name": kwargs["channel_name"],
            "status": "started",
        }

    async def stop(self, agent_id: str) -> None:
        self.stopped.append(agent_id)


@pytest.fixture
def server_module(monkeypatch):
    monkeypatch.setenv("AGORA_APP_ID", FakeAgentService.app_id)
    monkeypatch.setenv("AGORA_APP_CERTIFICATE", FakeAgentService.app_certificate)
    import server.src.server as module

    module = importlib.reload(module)
    fake = FakeAgentService()
    module.agent_service = fake
    module.fake_agent_service = fake
    return module


@pytest.fixture
def client(server_module):
    with TestClient(server_module.app, raise_server_exceptions=False) as test_client:
        yield test_client
