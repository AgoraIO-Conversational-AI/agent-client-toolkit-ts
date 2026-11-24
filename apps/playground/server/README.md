# Playground Python Server

This local FastAPI service owns Agora credentials, unified user token
generation, and Agent lifecycle operations for `apps/playground`. It uses
`agora-agents>=2.14.0`.

`src/agent.py` configures Agora Ares STT with managed OpenAI LLM and MiniMax
TTS as configured in `.env.example`. Copy its Agent configuration to the
Git-ignored `.env.local` file and fill in `AGORA_APP_ID` and
`AGORA_APP_CERTIFICATE`. Agent configuration values are read directly from
the environment without built-in defaults. To validate Cartesia BYOK, set
`AGENT_TTS_VENDOR=cartesia` and `CARTESIA_API_KEY`, keeping `CARTESIA_VOICE_ID`
and `CARTESIA_MODEL_ID` configured in the same file.

The backend uses an overseas Agora project and `Area.US`. Keep Ares as the
ASR vendor for this global service; the Chinese mainland `fengming` vendor
cannot be used with it.

Create `.env.local` with `agora project env write server/.env.local`, or copy
`.env.example` and set the required credentials manually. The template
also includes `AGENT_PROMPT`, `AGENT_GREETING`, `AGENT_FAILURE_MESSAGE`, and
`PORT` settings.
Keep `PORT` at `8002` unless the playground's Vite proxy is updated to the same
value.

For custom Agora API routing, optionally set `AGORA_AGENTS_API_BASE_URL` to
the service origin and any path prefix. The SDK appends
`/api/conversational-ai-agent` automatically. Set
`AGORA_AGENTS_SERVICE_NAMESPACE` to add an `X-Service-Namespace` header to
Agent start and stop requests. Empty values use the default global endpoint
and omit the namespace header. These settings configure the backend's
upstream API requests; the browser still connects through the local backend.
Restart the backend after changing them.

SDK HTTP debug logging is enabled for this local backend. Its terminal output
includes the actual request method, URL, headers and JSON body, plus response
status and headers. The SDK redacts credentials and limits request body logs
to 2000 characters.
Agent start failures also log the upstream status, request ID, and redacted
SDK response body. The HTTP response sent to the app keeps its safe message.

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
That command creates the Python virtual environment when `.venv` is missing
and installs any missing or outdated dependencies from `requirements-dev.txt`.
An installed Agora SDK version satisfying `agora-agents>=2.14.0` is retained.
Neither command creates `.env.local`;
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
