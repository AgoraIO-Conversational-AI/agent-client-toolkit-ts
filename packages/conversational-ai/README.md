# agora-agent-client-toolkit

Framework-agnostic TypeScript SDK for building real-time conversational AI experiences with Agora RTC and RTM.

## Install

```bash
pnpm add agora-agent-client-toolkit agora-rtc-sdk-ng
# RTM is optional — only required for sendText, sendImage, interrupt, manualSOS, manualEOS
pnpm add agora-rtm
```

## Quick Start

```typescript
import AgoraRTC from 'agora-rtc-sdk-ng';
import RTMClient from 'agora-rtm';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  TranscriptHelperMode,
} from 'agora-agent-client-toolkit';
// 1. Create the RTC and RTM clients
const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
const rtmClient = new RTMClient('YOUR_APP_ID', 'YOUR_USER_ID');
await rtmClient.login({ token: 'YOUR_RTM_TOKEN' });

// 2. Initialize the AI singleton
const ai = await AgoraVoiceAI.init({
  rtcEngine: rtcClient,
  rtmEngine: rtmClient,
  renderMode: TranscriptHelperMode.WORD,
});

// 3. Subscribe to events
// TRANSCRIPT_UPDATED delivers the complete conversation history — replace, don't append
ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcript) => {
  console.log('Transcript:', transcript);
});

ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
  console.log('Agent state:', agentUserId, event.state); // deprecated but supported
});
ai.on(AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED, (agentUserId, active) => {
  console.log('Agent listening:', agentUserId, active);
});
ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (agentUserId, active) => {
  console.log('Agent thinking:', agentUserId, active);
});
ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (agentUserId, active) => {
  console.log('Agent speaking:', agentUserId, active);
});

// 4. Join and publish via the RTC client directly — AgoraVoiceAI does not wrap join/publish
await rtcClient.join('YOUR_APP_ID', 'YOUR_CHANNEL', 'YOUR_TOKEN', null);
const micTrack = await AgoraRTC.createMicrophoneAudioTrack();
await rtcClient.publish([micTrack]);

// 5. Subscribe before starting the agent through the REST API
ai.subscribeMessage('YOUR_CHANNEL');
```

## Prerequisites

| Requirement | Version |
|-------------|---------|
| `agora-rtc-sdk-ng` | ≥ 4.23.4 |
| `agora-rtm` | ≥ 2.0.0 (optional) |
| TypeScript | ≥ 5.0 |
| Node.js | ≥ 20.0.0 |
| Browser target | ES2020+ |

For WORD-mode transcript rendering, set `ENABLE_AUDIO_PTS_METADATA` before creating the RTC client:

```typescript
AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true);
const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
```

### Agent start parameters

The following parameters must be set when starting the AI agent via the Agora REST API. Missing any will cause events to not fire — no runtime error is thrown.

| Parameter | Required for |
|-----------|-------------|
| `advanced_features.enable_rtm: true` | Agent activity events, `AGENT_STATE_CHANGED`, `MESSAGE_RECEIPT_UPDATED`, `MESSAGE_ERROR`, `MESSAGE_SAL_STATUS`, manual turn result events |
| `parameters.data_channel: "rtm"` | Same as above |
| `parameters.enable_metrics: true` | `AGENT_METRICS` |
| `parameters.enable_error_message: true` | `AGENT_ERROR` |

## Configuration Reference

`AgoraVoiceAIConfig` fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rtcEngine` | `RTCEngine` | Yes | Structural RTC client contract (`on/off` for `'audio-pts'` and `'stream-message'`) |
| `rtmEngine` | `RTMEngine` | No | Structural RTM client contract (`publish`, `addEventListener`, `removeEventListener`) |
| `renderMode` | `TranscriptHelperMode` | No | `TEXT`, `WORD`, `CHUNK`, or `AUTO`. If omitted, defaults to `AUTO` — mode is detected from the first agent message. |
| `enableLog` | `boolean` | No | Enable debug logging (default: `false`) |
| `enableRenderModeFallback` | `boolean` | No | Fall back from `WORD` to `TEXT` when word timing data is missing (default: `true`) |
| `enableAgoraMetrics` | `boolean` | No | Load `@agora-js/report` for usage metrics (default: `false`) |

`RTCEngine` and `RTMEngine` are toolkit-exported structural interfaces. A normal `agora-rtc-sdk-ng` client and `agora-rtm` client satisfy them directly, and no `as unknown as` casts are required.

## API Reference

### `AgoraVoiceAI`

#### Static methods

```typescript
AgoraVoiceAI.init(config: AgoraVoiceAIConfig): Promise<AgoraVoiceAI>
AgoraVoiceAI.getInstance(): AgoraVoiceAI  // throws NotInitializedError if not yet initialized
```

#### Instance methods

```typescript
ai.subscribeMessage(channel: string): void
ai.unsubscribe(): void
ai.chat(agentUserId: string, message: ChatMessageText | ChatMessageImage): Promise<void>
ai.sendText(agentUserId: string, message: ChatMessageText): Promise<void>   // requires rtmEngine
ai.sendImage(agentUserId: string, message: ChatMessageImage): Promise<void> // requires rtmEngine
ai.interrupt(agentUserId: string): Promise<void>                            // requires rtmEngine
ai.manualSOS(agentUserId: string, requestId?: string): Promise<string>      // requires rtmEngine
ai.manualEOS(agentUserId: string, requestId?: string): Promise<string>      // requires rtmEngine
ai.destroy(): void
ai.getCfg(): { rtcEngine, rtmEngine, renderMode, channel, enableLog, enableRenderModeFallback }
ai.on(event, handler): void
ai.off(event, handler): void
```

> **Note:** `AgoraVoiceAI` does not wrap RTC join/publish. Call `rtcClient.join()` and `rtcClient.publish()` directly on your Agora RTC client before calling `ai.subscribeMessage()`.

#### Advanced API

```typescript
ai.getState(): AgoraVoiceAIState
// Returns a snapshot of SDK state: { initialized, channel, hasRtm, renderMode, listenerCounts }

ai.setMaxListeners(n: number): AgoraVoiceAI
// Set the maximum number of listeners per event before a warning is logged.
// Defaults to 10. Set to 0 to disable the warning.

ai.setLogLevel(level: EventLogLevel): AgoraVoiceAI
// Set the log verbosity for event lifecycle.
// EventLogLevel.NONE (default) | EventLogLevel.ERRORS | EventLogLevel.DEBUG

ai.once(event, handler): AgoraVoiceAI
// Register a one-time handler that is automatically removed after the first invocation.

ai.removeAllEventListeners(): void
// Remove all registered event handlers. Called internally by destroy().
```

### Events

#### `TRANSCRIPT_UPDATED`

Fires whenever the transcript changes. Delivers the **complete conversation history array** — not an incremental update. Always re-render your UI from the full array.

```typescript
ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcript: TranscriptHelperItem[]) => {
  renderTranscript(transcript); // replace, don't append
});
```

Top-level fields per item: `uid`, `stream_id`, `turn_id`, `_time`, `text`, `status` (`TurnStatus`), `metadata`.
Word-level timing is at `metadata.words` — not at the top level.

---

#### Agent activity events _(requires `rtmEngine`)_

Use the independent activity events for new integrations. More than one flag
may be active at the same time.

```typescript
ai.on(AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED, (agentUserId, active) => {
  console.log(agentUserId, 'listening', active);
});
ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, (agentUserId, active) => {
  console.log(agentUserId, 'thinking', active);
});
ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (agentUserId, active) => {
  console.log(agentUserId, 'speaking', active);
});
```

> Requires `advanced_features.enable_rtm: true` and `parameters.data_channel: "rtm"` in the agent start request.

---

#### `AGENT_STATE_CHANGED` _(deprecated, requires `rtmEngine`)_

This event is deprecated but remains supported and continues to be emitted.
Existing integrations do not need to migrate. Use the independent activity
events when multiple flags are needed.

```typescript
ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
  // agentUserId: string
  // event: { state: AgentState, turnID: number, timestamp: number, reason: string }
  console.log(agentUserId, event.state);
});
```

`AgentState` values: `idle` | `listening` | `thinking` | `speaking` | `silent`

> Requires `advanced_features.enable_rtm: true` and `parameters.data_channel: "rtm"` in the agent start request.

---

#### `AGENT_INTERRUPTED`

Fires when the agent's current turn is interrupted.

```typescript
ai.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, (agentUserId, event) => {
  // agentUserId: string
  // event: { turnID: number, timestamp: number }
});
```

---

#### `AGENT_METRICS`

Fires when a performance metrics message is received from an agent module.

```typescript
ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (agentUserId, metrics) => {
  // agentUserId: string
  // metrics: { type: ModuleType, name: string, value: number, timestamp: number }
});
// ModuleType: 'asr' | 'llm' | 'mllm' | 'tts' | 'context' | 'unknown'
```

> Requires `parameters.enable_metrics: true` in the agent start request.

---

#### `AGENT_ERROR`

Fires when an agent module reports an error.

```typescript
ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
  // agentUserId: string
  // error: { type: ModuleType, code: number, message: string, timestamp: number }
});
```

> Requires `parameters.enable_error_message: true` in the agent start request.

---

#### `MESSAGE_RECEIPT_UPDATED` _(requires `rtmEngine`)_

Fires when a delivery or read receipt is received for a sent message.

```typescript
ai.on(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, (agentUserId, receipt) => {
  // agentUserId: string
  // receipt: { moduleType: ModuleType, messageType: ChatMessageType, message: string, turnId: number }
});
// ChatMessageType: 'text' | 'image' | 'unknown'
```

---

#### `MESSAGE_ERROR` _(requires `rtmEngine`)_

Fires when a chat message fails to deliver.

```typescript
ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
  // agentUserId: string
  // error: { type: ChatMessageType, code: number, message: string, timestamp: number }
  // type = the type of message that errored (ChatMessageType, not ModuleType)
});
```

---

#### `MESSAGE_SAL_STATUS` _(requires `rtmEngine`)_

Fires when the Speech Activity Level (SAL) registration status changes.

```typescript
ai.on(AgoraVoiceAIEvents.MESSAGE_SAL_STATUS, (agentUserId, salStatus) => {
  // agentUserId: string
  // salStatus: MessageSalStatusData — { status: MessageSalStatus, timestamp: number, ... }
});
// MessageSalStatus: VP_DISABLED | VP_UNREGISTER | VP_REGISTERING | VP_REGISTER_SUCCESS | VP_REGISTER_FAIL | VP_REGISTER_DUPLICATE
```

---

#### `USER_MANUAL_SOS` / `USER_MANUAL_EOS` / `AGENT_MANUAL_EOS` _(requires `rtmEngine`)_

Manual turn control is a two-step flow. `manualSOS()` and `manualEOS()` publish an RTM marker and resolve with the `requestId` used in the payload. That only means RTM publish succeeded; server validation arrives later through events.

```typescript
const sosRequestId = await ai.manualSOS(agentUserId);
const eosRequestId = await ai.manualEOS(agentUserId, 'eos-req-20260612-001');

ai.on(AgoraVoiceAIEvents.USER_MANUAL_SOS, (agentUserId, event) => {
  // event: { eventId, timestamp, payload: { success, requestId, turnId, errorMessage } }
});

ai.on(AgoraVoiceAIEvents.USER_MANUAL_EOS, (agentUserId, event) => {
  // Failed server results may have payload.turnId === null.
});

ai.on(AgoraVoiceAIEvents.AGENT_MANUAL_EOS, (agentUserId, event) => {
  // Server automatic EOS notification in manual mode.
  // event.payload: { reason, maxDurationMs, turnId }
});
```

Wire mapping:

| Client call / server event | RTM custom type or event type |
|----------------------------|-------------------------------|
| `manualSOS()` | `user.manual_sos` with `{ "request_id": "..." }` |
| `manualEOS()` | `user.manual_eos` with `{ "request_id": "..." }` |
| `USER_MANUAL_SOS` | `user.manual_sos.result` |
| `USER_MANUAL_EOS` | `user.manual_eos.result` |
| `AGENT_MANUAL_EOS` | `assistant.manual_eos.result` |

Common `errorMessage` values are `Current mode is not manual.`, `No turns available for SOS labeling.`, and `No turns available for EOS labeling.`. The SDK preserves the server string and does not locally decide whether the current mode is manual.

### `TranscriptHelperMode`

| Value | Behavior |
|-------|----------|
| `TEXT` | Full-sentence updates, lower frequency |
| `WORD` | Word-by-word updates using PTS metadata (requires `ENABLE_AUDIO_PTS_METADATA`) |
| `CHUNK` | Chunked message assembly mode for stream data |
| `AUTO` | Mode is detected automatically from the first agent message (default when omitted) |
| _(omitted)_ | Same as `AUTO` — detected automatically from the first agent message |

### `ChunkedMessageAssembler`

Reassembles multi-part stream messages sent in `msg_id|part_idx|part_sum|base64_data` format. Used internally; also exported for custom stream handling.

```typescript
const assembler = new ChunkedMessageAssembler();
const result = assembler.assemble(rawStreamMessage); // returns parsed object or null
assembler.clear(); // release cached chunks
```

### Metrics

By default, the SDK logs to `console.debug`. Opt in to Agora metrics:

```typescript
const ai = await AgoraVoiceAI.init({ rtcEngine, enableAgoraMetrics: true });
```

Advanced: implement `IMetricsReporter` or use the exported `ConsoleMetricsReporter` / `AgoraMetricsReporter` directly.

## Error Reference

### Thrown Errors

| Error Class | When Thrown | Recovery |
|------------|------------|----------|
| `NotInitializedError` | `getInstance()` or `getCfg()` called before `init()` | Call `await AgoraVoiceAI.init(config)` first |
| `RTMRequiredError` | `sendText()`, `sendImage()`, `interrupt()`, `manualSOS()`, or `manualEOS()` called without RTM | Pass `rtmEngine` in `init()` config |
| `ConversationalAIError` | `chat()` called with unsupported message type | Check `message.messageType` is TEXT or IMAGE |

All error classes extend `ConversationalAIError`, which extends `Error`. Use `instanceof` to catch specific error types.

### Error Events

| Event | Payload | When Emitted |
|-------|---------|-------------|
| `AGENT_ERROR` | `{ type: ModuleType, code: number, message: string, timestamp: number }` | Agent pipeline error (LLM, TTS, context). Requires `enable_error_message: true` in agent config |
| `MESSAGE_ERROR` | `{ type: ChatMessageType, code: number, message: string, timestamp: number }` | RTM message delivery failure. Requires RTM |

### Error Handling Example

```typescript
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  RTMRequiredError,
  ModuleType,
} from 'agora-agent-client-toolkit';

// Catch thrown errors
try {
  await ai.sendText(agentUserId, {
    messageType: ChatMessageType.TEXT,
    priority: ChatMessagePriority.INTERRUPTED,
    responseInterruptable: true,
    text: 'Hello',
  });
} catch (e) {
  if (e instanceof RTMRequiredError) {
    console.error('RTM not configured — pass rtmEngine to init()');
  }
}

// Listen for error events
ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
  console.error(`Agent error [${error.type}]: ${error.message}`);
  if (error.type === ModuleType.LLM) {
    showToast('AI model error — please retry');
  }
});
```

### Sending an Image

```typescript
await ai.sendImage(agentUserId, {
  messageType: ChatMessageType.IMAGE,
  uuid: crypto.randomUUID(),
  url: 'https://example.com/image.png',
});
```

### Graceful Cleanup

```typescript
window.addEventListener('beforeunload', () => {
  const ai = AgoraVoiceAI.getInstance();
  ai.unsubscribe();
  ai.destroy();
});
```

## Troubleshooting

### Events not firing

**Symptoms:** `AGENT_STATE_CHANGED`, `AGENT_METRICS`, or `AGENT_ERROR` events never fire.

**Cause:** These events require specific parameters when starting the agent via the Agora REST API. Missing parameters cause events to silently not emit — no runtime error is thrown.

**Fix:** Ensure your agent start request includes:

| Event | Required Agent Parameter |
|-------|------------------------|
| `AGENT_STATE_CHANGED` | `advanced_features.enable_rtm: true` AND `parameters.data_channel: "rtm"` |
| `AGENT_METRICS` | `parameters.enable_metrics: true` |
| `AGENT_ERROR` | `parameters.enable_error_message: true` |

See the [Agora Conversational AI documentation](https://docs.agora.io/en/conversational-ai/overview) for the full agent start request format.

### Standalone hooks not receiving events

**Cause:** Standalone hooks (`useTranscript`, `useAgentState`, etc.) need access to the `AgoraVoiceAI` instance. Without a `ConversationalAIProvider`, they fall back to a single `getInstance()` attempt which may miss the instance if `init()` hasn't completed yet.

**Fix:** Wrap your component tree in `ConversationalAIProvider` so standalone hooks connect through React context. Pass `rtmEngine` when the child hooks consume RTM-backed state or controls:

```tsx
<ConversationalAIProvider
  config={{ channel: 'my-channel', rtmEngine: rtmClient }}
>
  <TranscriptPanel />  {/* useTranscript() connects via context */}
  <StatusBar />         {/* useAgentState() connects via context */}
</ConversationalAIProvider>
```

### Transcript not updating in WORD mode

**Cause:** WORD mode requires PTS (Presentation Timestamp) metadata from the RTC audio stream. This must be enabled before creating the RTC client.

**Fix:** Call `AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true)` before `AgoraRTC.createClient()`, or use `renderMode: TranscriptHelperMode.TEXT` which doesn't require PTS.

## Optional Dependencies

| Package | Feature | Fallback behavior |
|---------|---------|-------------------|
| `@agora-js/report` | `enableAgoraMetrics: true` | Falls back to `console.debug` |
