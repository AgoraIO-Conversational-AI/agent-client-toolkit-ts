# Conversational AI Web Demo

Focused web demo for validating the local `agora-agent-client-toolkit` and `agora-agent-client-toolkit-react` workspace packages, including manual SOS/EOS.

The demo opens directly to the session workspace. Use Settings to adjust SOS/EOS before startup, then use Start agent on the main page. SOS and EOS detection modes are locked for the active session after startup.

The startup flow is aligned with the Kotlin sample:

1. Request a user RTC/RTM token from the business token server.
2. Join RTC and log in RTM with that token.
3. Ask the demo server to request an agent token and a REST auth token.
4. The demo server POSTs `/join` with explicit `asr`, `tts`, and `llm` sections.

Channel, user ID, and agent user ID are generated on each start, following the Kotlin demo's random 6-digit UID pattern.

## Run

Run from the repository root:

```bash
pnpm install
pnpm --filter agora-agent-client-toolkit build
pnpm --filter agora-agent-client-toolkit-react build
pnpm --filter agora-agent-client-toolkit-web-demo dev
```

Open `http://localhost:3001`.

The dev command starts both the React app and a thin local demo server. The browser only calls `/demo-api`; the demo server calls the token service and `https://api-test.agora.io`, keeping REST auth and provider keys out of the browser bundle.

`VITE_AGORA_APP_ID` is shared by the browser RTC/RTM client and the local demo server. Server-only credentials and provider keys use non-`VITE_` variables so Vite does not expose them to the browser bundle.

The token server is expected to expose the same shape as the Kotlin demo token service:

```text
POST {AGORA_TOKEN_SERVER_URL}/v2/token/generate
```

It should return either `{ "code": 0, "data": { "token": "..." } }` or `{ "token": "..." }`.
