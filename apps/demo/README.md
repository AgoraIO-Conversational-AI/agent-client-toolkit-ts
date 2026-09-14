# Conversational AI Demo

Vanilla TypeScript demo for `agora-agent-client-toolkit`. Shows the complete join → publish → transcript → leave flow using `AgoraRTC.createClient()` directly.

## Prerequisites

- Node.js 20+
- pnpm 9+
- An [Agora account](https://console.agora.io) with a project (App ID + tokens)

## Setup

### 1. Install dependencies

From the workspace root:

```bash
pnpm install
```

### 2. Configure credentials

Open `apps/demo/demo.ts` and replace the `CONFIG` block at the top of the file:

```typescript
const CONFIG = {
  appId: 'YOUR_AGORA_APP_ID',    // From Agora Console → Project Management
  rtcToken: 'YOUR_RTC_TOKEN',    // Generate from your backend or Agora Console
  rtmToken: 'YOUR_RTM_TOKEN',    // Required only if using RTM message APIs
  channelName: 'voice-ai-demo',
  userId: 'user_' + Math.floor(Math.random() * 10000),
  agentUserId: '46307123',       // The AI agent's UID in the channel
};
```

Tokens should be generated server-side for production. For local testing, use the Agora Console token builder (24-hour tokens are fine).

### 3. Start the dev server

```bash
pnpm --filter agora-conversational-ai-demo dev
```

The demo is served at `http://localhost:5173` by default.

## What the demo covers

- Initializing `AgoraVoiceAI` with `AgoraRTC.createClient()` (async `init()`)
- Joining and publishing local audio
- Subscribing to `TRANSCRIPT_UPDATED` and `AGENT_STATE_CHANGED` events
- Optional RTM: sending text/image messages, direct speech, think instructions, and interrupts
- Graceful cleanup on page unload

## Build

```bash
pnpm --filter agora-conversational-ai-demo build
```

Output goes to `apps/demo/dist/`.
