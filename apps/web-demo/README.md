# Conversational AI Web Demo

Focused web demo for validating the local `agora-agent-client-toolkit` and `agora-agent-client-toolkit-react` workspace packages, including manual SOS/EOS.

The demo opens directly to the session workspace. Use Settings to adjust SOS/EOS before startup, then use Start agent on the main page. SOS and EOS detection modes are locked for the active session after startup.

The startup flow is aligned with the Kotlin sample:

1. Request a user RTC/RTM token from the local demo server.
2. Join RTC and log in RTM with that token.
3. Ask the demo server to generate an agent token and a REST auth token.
4. The demo server POSTs `/join` with explicit `asr`, `tts`, and `llm` sections.

Channel, user ID, and agent user ID are generated on each start, following the Kotlin demo's random 6-digit UID pattern.

## Run

Run from the repository root:

```bash
pnpm install
cp apps/web-demo/.env.example apps/web-demo/.env
# Edit apps/web-demo/.env and fill AGORA_APP_ID and AGORA_APP_CERTIFICATE.
pnpm run build
pnpm run web-demo
```

Fill the ASR, LLM, and TTS provider keys before clicking Start agent.

Open `http://localhost:3001`.

The dev command starts both the React app and a thin local demo server. The browser only calls `/demo-api`; the demo server generates RTC+RTM tokens locally with `agora-token` and calls `https://api-test.agora.io`, keeping the app certificate, REST auth, and provider keys out of the browser bundle.

`AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` are read by the local demo server from `apps/web-demo/.env`. Server-only credentials and provider keys use non-`VITE_` variables so Vite does not expose them to the browser bundle.
