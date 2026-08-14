# Conversational AI Playground

Full-stack validation app for `agora-agent-client-toolkit`. The React frontend
exercises the browser SDK while a local FastAPI server generates the unified
user token and starts or stops the Agora Agent session.

The playground covers transcript rendering, independent Agent activity,
latency metrics, text and image chat, direct Speak, Think instructions,
interrupt, and manual SOS/EOS.

## Architecture

```text
server/.env.local
  AGORA_APP_ID
  AGORA_APP_CERTIFICATE
        -> FastAPI + agora-agents
        -> unified RTC/RTM user token and Agent lifecycle

React frontend
        -> RTC audio
        -> RTM message APIs
        -> agora-agent-client-toolkit
```

The App Certificate and Agent credentials stay in the local server. They are
never sent to the browser. The server uses `agora-agents==2.4.1` with Agora
Fengming STT, managed OpenAI `gpt-4o-mini`, and MiniMax
`speech_2_6_turbo` TTS.

## Configure

From `apps/playground`:

```bash
agora project env write server/.env.local
```

Alternatively, create the file manually and set the required Agora project
credentials:

```bash
cp server/.env.example server/.env.local
# Set AGORA_APP_ID and AGORA_APP_CERTIFICATE in server/.env.local.
```

The template also supports `AGENT_PROMPT`, `AGENT_GREETING`, and `PORT`.
Keep `PORT=8002` unless the proxy in `vite.config.ts` is changed too.

## Run

```bash
pnpm dev
```

When the Python virtual environment is missing, this command creates it and
installs the server dependencies automatically. It does not create or populate
`server/.env.local`; missing or placeholder credentials produce setup
instructions and stop startup.

Open `http://127.0.0.1:3000`. The FastAPI server listens on
`http://127.0.0.1:8002`.

The startup flow is:

1. `GET /get_config` returns the App ID, unified RTC/RTM token, channel, user
   UID, and Agent UID.
2. The browser joins RTC, logs in to RTM, and subscribes the Toolkit to the RTM
   message channel.
3. `POST /startAgent` starts the managed Agent session.
4. `POST /stopAgent` stops the tracked session, with stateless SDK fallback.

## Message API Coverage

- Text chat: interrupt, append, and ignore priorities
- Image chat: image URL and generated message UUID
- Speak: interrupt (default), append, and ignore priorities, plus
  `interruptable`
- Think: every listening, thinking, and speaking action, plus `interruptable`
  and optional metadata
- Agent interrupt and manual SOS/EOS controls

## Verify

```bash
pnpm test
pnpm build
```

Frontend API tests mock the FastAPI boundary. Server tests mock the Agent SDK
session boundary and do not call Agora cloud services. A real voice round trip
still requires valid Agora credentials and browser microphone permission.
