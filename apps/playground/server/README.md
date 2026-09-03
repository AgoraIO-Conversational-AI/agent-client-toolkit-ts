# Playground Python Server

This local FastAPI service owns Agora credentials, unified user token
generation, and Agent lifecycle operations for `apps/playground`. It uses
`agora-agents>=2.4.1,<3.0.0`.

`src/agent.py` configures Agora Ares STT with managed OpenAI LLM and
MiniMax TTS. Only `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` are required in
the Git-ignored `.env.local` file.

Create `.env.local` with `agora project env write server/.env.local`, or copy
`.env.example` and set the required Agora credentials manually. The template
also includes optional `AGENT_PROMPT`, `AGENT_GREETING`, and `PORT` overrides.
Keep `PORT` at `8002` unless the playground's Vite proxy is updated to the same
value.

## Run the backend only

From `apps/playground`, initialize the Python environment and start only the
FastAPI backend:

```bash
pnpm run backend:setup
pnpm run server
```

The server listens on `http://127.0.0.1:8002` by default. Verify it after
startup with:

```bash
curl http://127.0.0.1:8002/health
```

Open `http://127.0.0.1:8002/docs` for the API summary. Press `Ctrl+C` in the
server terminal to stop it. The `server` command loads `server/.env.local`,
including its optional `PORT` value.

To start both the FastAPI backend and Vite frontend, use `pnpm dev` instead.
That command creates the Python virtual environment and installs its
dependencies when `.venv` is missing. Neither command creates `.env.local`;
valid Agora credentials must be supplied explicitly.

## Endpoints

| Endpoint      | Method | Purpose                                      |
| ------------- | ------ | -------------------------------------------- |
| `/health`     | GET    | Backend readiness                            |
| `/get_config` | GET    | App ID, unified user token, channel and UIDs |
| `/startAgent` | POST   | Start an `AsyncAgentSession`                 |
| `/stopAgent`  | POST   | Stop a tracked or stateless SDK Agent        |

All responses use `{ "code": 0, "data": ..., "msg": "success" }`. Errors
use a non-2xx status, non-zero code, and a safe message without credentials or
provider details.

## Test

From `apps/playground`:

```bash
pnpm run backend:setup
pnpm run test:server
```
