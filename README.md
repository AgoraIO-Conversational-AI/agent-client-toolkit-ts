# Agora Conversational AI Toolkit

A client-side toolkit for adding Agora Conversational AI features to applications already using the Agora RTC SDK. Runs in the browser alongside your existing RTC integration — adds transcript rendering, agent state tracking, and RTM-based messaging controls on top of `agora-rtc-sdk-ng`. Framework-agnostic core with optional React hooks.

[![CI](https://github.com/AgoraIO-Conversational-AI/agent-client-toolkit-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AgoraIO-Conversational-AI/agent-client-toolkit-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```bash
# Vanilla JS / TypeScript
pnpm add agora-agent-client-toolkit agora-rtc-sdk-ng

# React
pnpm add agora-agent-client-toolkit-react agora-agent-client-toolkit agora-rtc-react
```

## Migration

Upgrading from an earlier release? See the [migration guide](./MIGRATION.md), including the steps for `1.2.x -> 2.9.0`.

### Optional dependencies

The core package keeps optional features out of the default runtime bundle:

- `@agora-js/report`: used only when `enableAgoraMetrics: true`
- `jszip`: used only by ZIP-related helper paths

If these packages are not installed, the toolkit keeps working and falls back
to no-op / console behavior for those optional paths.

## Quick Start

### Vanilla JS

```typescript
import AgoraRTC from 'agora-rtc-sdk-ng';
import RTMClient from 'agora-rtm';
import { AgoraVoiceAI, AgoraVoiceAIEvents } from 'agora-agent-client-toolkit';

// --- Your existing Agora RTC + RTM setup ---
const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
const rtmClient = new RTMClient('APP_ID', 'USER_ID');

await rtmClient.login({ token: 'RTM_TOKEN' });
await rtcClient.join('APP_ID', 'CHANNEL', 'RTC_TOKEN', null);
const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
await rtcClient.publish([micTrack]);

// Subscribe to remote audio (agent playback)
rtcClient.on('user-published', async (user, mediaType) => {
  if (mediaType === 'audio') {
    await rtcClient.subscribe(user, 'audio');
    user.audioTrack?.play();
  }
});

// --- Add Conversational AI features ---
const ai = await AgoraVoiceAI.init({
  rtcEngine: rtcClient,
  rtmConfig: { rtmEngine: rtmClient },
});

ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcript) => {
  console.log(transcript); // full conversation history, replace don't append
});

ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_agentUserId, event) => {
  console.log(event.state); // deprecated compatibility event, still emitted
});
ai.on(AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED, (_agentUserId, active) => {
  console.log('listening', active);
});
ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (_agentUserId, active) => {
  console.log('thinking', active);
});
ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (_agentUserId, active) => {
  console.log('speaking', active);
});

// Subscribe before starting the agent through the REST API
ai.subscribeMessage('CHANNEL');

// Send a message or interrupt the agent (requires RTM)
await ai.sendText('AGENT_UID', { messageType: ChatMessageType.TEXT, text: 'Hello' });
await ai.interrupt('AGENT_UID');
```

> `AgoraVoiceAIEvents.AGENT_STATE_CHANGED` is deprecated but remains supported and continues to be emitted. Existing integrations do not need to migrate. Use the independent activity events when multiple flags are needed.

### React

```tsx
import { useMemo } from 'react';
import AgoraRTC, {
  AgoraRTCProvider,
  useJoin,
  useLocalMicrophoneTrack,
  usePublish,
} from 'agora-rtc-react';
import RTMClient from 'agora-rtm';
import {
  ConversationalAIProvider,
  useTranscript,
  useAgentState,
} from 'agora-agent-client-toolkit-react';

const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
const rtmClient = new RTMClient('APP_ID', 'USER_ID');
await rtmClient.login({ token: 'RTM_TOKEN' });

function App() {
  const config = useMemo(
    () => ({
      channel: 'my-channel',
      rtmConfig: { rtmEngine: rtmClient },
    }),
    []
  );

  return (
    // AgoraRTCProvider and ConversationalAIProvider layer on top of each other
    <AgoraRTCProvider client={rtcClient}>
      <ConversationalAIProvider config={config}>
        <VoiceSession />
      </ConversationalAIProvider>
    </AgoraRTCProvider>
  );
}

function VoiceSession() {
  // Agora RTC hooks — join, mic, publish (your existing integration)
  useJoin({ appid: 'APP_ID', channel: 'my-channel', token: 'RTC_TOKEN' });
  const { localMicrophoneTrack } = useLocalMicrophoneTrack();
  usePublish([localMicrophoneTrack]);

  // Conversational AI hooks — transcript, state, errors added on top
  const transcript = useTranscript();
  const { agentState } = useAgentState();

  return (
    <div>
      <p>Agent: {agentState ?? 'idle'}</p>
      <ul>
        {transcript.map((t) => (
          <li key={t.turn_id}>{t.text}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Packages

| Package                                                                      | Version | Description                        |
| ---------------------------------------------------------------------------- | ------- | ---------------------------------- |
| [`agora-agent-client-toolkit`](./packages/conversational-ai/README.md)       | 2.9.0   | Core SDK — vanilla JS / TypeScript |
| [`agora-agent-client-toolkit-react`](./packages/react/README.md)             | 2.9.0   | React hooks                        |

Full API reference, configuration options, and events are in each package's README.

## RTC-only mode (no RTM)

RTM is optional. Transcripts and agent state work without it — just omit `rtmConfig`:

```typescript
const ai = await AgoraVoiceAI.init({ rtcEngine: rtcClient });
```

RTM-backed methods throw without `rtmConfig`: `sendText`, `sendImage`, `interrupt`, `manualSOS`, and `manualEOS`.

## Repository layout

```
.
├── packages/
│   ├── conversational-ai/   # agora-agent-client-toolkit
│   └── react/               # agora-agent-client-toolkit-react
├── apps/
│   ├── demo/                # Vanilla TS demo (Vite)
│   └── playground/          # Interactive React playground
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Development

This repo uses [pnpm workspaces](https://pnpm.io/workspaces).

```bash
# Setup
pnpm install
pnpm -r build

# Test
pnpm --filter agora-agent-client-toolkit test
pnpm --filter agora-agent-client-toolkit-react test

# Type check
pnpm --filter agora-agent-client-toolkit typecheck
pnpm --filter agora-agent-client-toolkit-react typecheck

# Run the demo apps
pnpm --filter agora-conversational-ai-demo dev
pnpm --filter agora-conversational-ai-playground dev
```

## License

MIT
