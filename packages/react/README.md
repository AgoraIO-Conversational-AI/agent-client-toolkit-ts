# agora-agent-client-toolkit-react

React hooks for `agora-agent-client-toolkit`. Bridges the `AgoraVoiceAI` singleton into React state and effects.

For RTC primitives (microphone tracks, camera tracks, remote users, volume levels), use `agora-rtc-react` directly — this package focuses exclusively on toolkit-specific concerns.

## Install

```bash
pnpm add agora-agent-client-toolkit-react@2.9.0 agora-agent-client-toolkit@2.9.0 agora-rtc-react agora-rtc-sdk-ng agora-rtm
```

Keep `agora-agent-client-toolkit-react` and `agora-agent-client-toolkit` on the same version.

## Quick Start

Use `ConversationalAIProvider` to manage the AI lifecycle and give standalone hooks access via React context:

```tsx
import { useMemo } from 'react';
import AgoraRTC, { AgoraRTCProvider } from 'agora-rtc-react';
import RTMClient from 'agora-rtm';
import {
  ConversationalAIProvider,
  useTranscript,
  useAgentState,
} from 'agora-agent-client-toolkit-react';

const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
const rtmClient = new RTMClient('APP_ID', 'USER_ID');
await rtmClient.login({ token: 'RTM_TOKEN' });

function App() {
  const config = useMemo(
    () => ({ channel: 'my-channel', rtmConfig: { rtmEngine: rtmClient } }),
    []
  );

  return (
    <AgoraRTCProvider client={client}>
      <ConversationalAIProvider config={config}>
        <TranscriptPanel />
        <StatusBar />
      </ConversationalAIProvider>
    </AgoraRTCProvider>
  );
}

function TranscriptPanel() {
  const transcript = useTranscript(); // connects via context — no polling
  return <ul>{transcript.map((t) => <li key={t.turn_id}>{t.text}</li>)}</ul>;
}

function StatusBar() {
  const { agentState } = useAgentState(); // connects via context
  return <span>{agentState ?? 'idle'}</span>;
}
```

Alternatively, use `useConversationalAI` directly for a batteries-included hook:

```tsx
function VoiceAI() {
  const config = useMemo(
    () => ({ channel: 'my-channel', rtmConfig: { rtmEngine: rtmClient } }),
    []
  );
  const { transcript, agentState, isConnected, interrupt, manualSOS, manualEOS } =
    useConversationalAI(config);

  return (
    <div>
      <p>Agent: {agentState} | Connected: {String(isConnected)}</p>
      <button onClick={() => interrupt('AGENT_UID')}>Interrupt</button>
      <button onClick={() => manualSOS('AGENT_UID')}>SOS</button>
      <button onClick={() => manualEOS('AGENT_UID')}>EOS</button>
      <ul>
        {transcript.map((t) => <li key={t.uid}>{t.text}</li>)}
      </ul>
    </div>
  );
}
```

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 20.0.0 |
| React | >= 18 |
| `agora-rtc-react` | >= 2.0.0 |
| `agora-rtc-sdk-ng` | >= 4.23.4 |
| `agora-rtm` | >= 2.0.0 (required for state events and controls) |
| `agora-agent-client-toolkit` | 2.9.0 (same version as this package) |

## API Reference

### `ConversationalAIProvider`

Provider component that manages the `AgoraVoiceAI` lifecycle and exposes the AI instance via React context to standalone hooks. Use this when you have standalone hooks in child components.

```tsx
<AgoraRTCProvider client={rtcClient}>
  <ConversationalAIProvider
    config={{ channel: 'my-channel', rtmConfig: { rtmEngine: rtmClient } }}
  >
    {/* standalone hooks connect instantly via context */}
    <TranscriptPanel />
    <StatusBar />
  </ConversationalAIProvider>
</AgoraRTCProvider>
```

### `useConversationalAI(config)`

Flagship hook — initializes and manages the full `AgoraVoiceAI` lifecycle (init, subscribe, unsubscribe, destroy). Must be rendered inside an `AgoraRTCProvider`.

```typescript
const {
  transcript,
  agentState,
  isConnected,
  error,
  interrupt,
  manualSOS,
  manualEOS,
  sendMessage,
  metrics,
  messageReceipt,
} = useConversationalAI(config);
```

`config` extends `AgoraVoiceAIConfig` (omitting `rtcEngine`, which comes from the provider) and adds `channel: string`.

**Return values:**

| Field | Type | Description |
|-------|------|-------------|
| `transcript` | `TranscriptHelperItem[]` | Full conversation history. Updates on every `TRANSCRIPT_UPDATED` event. |
| `agentState` | `AgentState \| null` | Current agent state (`'idle'`, `'listening'`, `'thinking'`, `'speaking'`, `'silent'`). Null until the first event. |
| `isConnected` | `boolean` | `true` after `subscribeMessage` succeeds. |
| `error` | `ModuleError \| null` | Most recent error from `AGENT_ERROR`. Null until an error occurs. |
| `interrupt` | `(agentUserId: string) => Promise<void>` | Send an interrupt signal to the agent. Requires `rtmConfig`. |
| `manualSOS` | `(agentUserId: string, requestId?: string) => Promise<string>` | Trigger manual start-of-speech and return the request ID. Requires `rtmConfig`. |
| `manualEOS` | `(agentUserId: string, requestId?: string) => Promise<string>` | Trigger manual end-of-speech and return the request ID. Requires `rtmConfig`. |
| `sendMessage` | `(agentUserId: string, text: string) => Promise<void>` | Send a text message to the agent. Requires `rtmConfig`. |
| `metrics` | `AgentMetric \| null` | Latest metric from `AGENT_METRICS` (module type, name, value, timestamp). |
| `messageReceipt` | `MessageReceipt \| null` | Latest delivery receipt from `MESSAGE_RECEIPT_UPDATED`. |

> **Important:** Only `rtcClient` and `config.channel` are in the effect dependency array. Wrap inline config objects in `useMemo` to avoid unnecessary re-subscribe cycles.

### `useTranscript()`

Subscribe to transcript updates. Must be inside a `ConversationalAIProvider`.

```typescript
const transcript = useTranscript();
```

### `useAgentState()`

Subscribe to `AGENT_STATE_CHANGED` events. Returns the current agent state, full state-change event, and agent UID.
This hook remains the supported aggregate compatibility API. Direct core SDK
integrations can use the independent events when multiple activity flags are needed.

```typescript
const { agentState, stateEvent, agentUserId } = useAgentState();
// agentState: 'idle' | 'listening' | 'thinking' | 'speaking' | 'silent' | null
// stateEvent: { state, turnID, timestamp, reason } | null
```

### `useAgentError()`

Subscribe to both `AGENT_ERROR` and `MESSAGE_ERROR` events. Returns a discriminated union with `source: 'agent' | 'message'`.

```typescript
const { error, clearError } = useAgentError();
// error: { source: 'agent', agentUserId, error: ModuleError }
//      | { source: 'message', agentUserId, error: { type, code, message, timestamp } }
//      | null
```

Call `clearError()` to reset after dismissing an error (e.g. closing a toast).

### `useAgentMetrics()`

Subscribe to `AGENT_METRICS` events. Returns the latest metric and agent UID.

```typescript
const { metrics, agentUserId } = useAgentMetrics();
// metrics: { type: ModuleType, name: string, value: number, timestamp: number } | null
```

## Standalone hooks vs `useConversationalAI`

**`ConversationalAIProvider` + standalone hooks** is the recommended pattern. The provider manages the lifecycle, and standalone hooks connect via React context. Each hook subscribes to one slice of state, so only the components that need updates re-render.

**`useConversationalAI`** is a convenience hook for simple cases where a single component needs everything (transcript, state, controls) in one return value. Standalone hooks require a `ConversationalAIProvider` — they won't receive events without one.

```tsx
function StatusBar() {
  const { agentState } = useAgentState();
  const { error, clearError } = useAgentError();

  return (
    <div>
      <span>Agent: {agentState ?? 'idle'}</span>
      {error && (
        <span onClick={clearError}>
          Error: {error.error.message}
        </span>
      )}
    </div>
  );
}
```

### `useConversationalAIContext()`

Access SDK controls from any component inside a `ConversationalAIProvider`, without having to re-pass config. Returns `sendMessage`, `interrupt`, `manualSOS`, `manualEOS`, and the underlying `instance`.

```tsx
function ChatInput({ agentUid }: { agentUid: string }) {
  const { sendMessage, interrupt, manualSOS, manualEOS } = useConversationalAIContext();

  return (
    <div>
      <button onClick={() => interrupt(agentUid)}>Interrupt</button>
      <button onClick={() => manualSOS(agentUid)}>SOS</button>
      <button onClick={() => manualEOS(agentUid)}>EOS</button>
      <button onClick={() => sendMessage(agentUid, 'hello')}>Send</button>
    </div>
  );
}
```

Use this instead of prop-drilling controls down from the component that called `useConversationalAI`. For transcript and state data, prefer the dedicated standalone hooks.

## RTC primitives

For microphone/camera tracks, remote users, volume levels, and other RTC concerns, use `agora-rtc-react` directly:

- `useLocalMicrophoneTrack` — local mic
- `useLocalCameraTrack` — local camera
- `useRemoteUsers` — remote user list
- `useVolumeLevel` — audio volume (0-1)
- `useJoin`, `usePublish`, `useIsConnected` — connection management

See the [agora-rtc-react docs](https://github.com/AgoraIO-Extensions/agora-rtc-react) for full API reference.

## Core package

For vanilla JS / framework-agnostic usage, see [agora-agent-client-toolkit](../conversational-ai/README.md).
