# 06 Interfaces

> Public API surface, engine contracts, event schemas, and message wire formats.

## Public API — Core Package

### AgoraVoiceAI (singleton)

| Method                            | Returns            | Notes                          |
| --------------------------------- | ------------------ | ------------------------------ |
| `init(config)`                    | `Promise<void>`    | Async; validates engines in dev |
| `getInstance()`                   | `AgoraVoiceAI`     | Throws `NotInitializedError`   |
| `subscribeMessage(channel)`       | `void`             | Binds RTC/RTM listeners        |
| `unsubscribe()`                   | `void`             | Unbinds listeners              |
| `destroy()`                       | `void`             | Idempotent; resets singleton   |
| `chat(agentUserId, message)`      | `Promise<void>`    | Dispatches to send methods     |
| `sendText(agentUserId, message)`  | `Promise<void>`    | Requires RTM                   |
| `sendImage(agentUserId, message)` | `Promise<void>`    | Requires RTM                   |
| `interrupt(agentUserId)`          | `Promise<void>`    | Requires RTM                   |

### Configuration

```typescript
interface AgoraVoiceAIConfig {
  rtcEngine: RTCEngine;           // required
  rtmConfig?: RTMConfig;          // optional — enables messaging
  renderMode?: TranscriptHelperMode;  // TEXT | WORD | CHUNK | AUTO (default)
  enableLog?: boolean;            // default false
  enableAgoraMetrics?: boolean;   // default false
}
```

## Engine Contracts (Structural Types)

### RTCEngine

```typescript
interface RTCEngine {
  on(event: 'audio-pts', listener: (pts: number) => void): void;
  on(event: 'stream-message', listener: (uid: number, data: Uint8Array) => void): void;
  off(event: string, listener: Function): void;
}
```

### RTMEngine

```typescript
interface RTMEngine {
  publish(channel: string, message: string, options?: object): Promise<void>;
  addEventListener(event: string, listener: Function): void;
  removeEventListener(event: string, listener: Function): void;
}
```

These are toolkit-owned contracts matched by shape; apps pass their actual Agora SDK instances.

## Events

| Event                      | Payload Type          | When Fired                               |
| -------------------------- | --------------------- | ---------------------------------------- |
| `TRANSCRIPT_UPDATED`       | Full transcript array | Any transcript change (full replacement) |
| `AGENT_STATE_CHANGED`      | Agent state + user ID | Agent state transition via RTM           |
| `AGENT_INTERRUPTED`        | Agent user ID         | Agent turn interrupted                   |
| `AGENT_METRICS`            | Metrics object        | Performance data from agent modules      |
| `AGENT_ERROR`              | Error object          | Agent-side module failure                |
| `MESSAGE_RECEIPT_UPDATED`  | Receipt object        | Delivery/read receipt via RTM            |
| `MESSAGE_ERROR`            | Error object          | RTM message delivery failure             |
| `MESSAGE_SAL_STATUS`       | SAL status            | Speech Activity Level registration       |
| `DEBUG_LOG`                | Log data              | Debug info (when `enableLog: true`)      |

## RTC Stream Message Wire Format

Multi-part chunked format: `msg_id|part_idx|part_sum|base64_data`

- `part_idx` — 1-based on wire, normalized to 0-based internally
- `part_sum` — total parts, or `"???"` for unknown
- Assembled payload is JSON:

```json
{
  "object": "user.transcription | assistant.transcription",
  "text": "hello world",
  "turn_id": 1,
  "turn_seq_id": 1,
  "turn_status": 0,
  "final": true,
  "words": [{ "word": "hello", "start_ms": 0, "duration_ms": 50, "stable": true }]
}
```

## RTM Presence Event (Agent State)

```json
{
  "publisher": "agent_uid",
  "stateChanged": {
    "state": "idle | listening | thinking | speaking | silent",
    "turn_id": "1"
  }
}
```

## RTM Message (Agent Metrics)

```json
{
  "object": "message.metrics",
  "module": "llm | tts | context | mllm",
  "metric_name": "response_time",
  "latency_ms": 150,
  "turn_id": 1
}
```

## Public API — React Package

| Export                         | Type      | Purpose                                    |
| ------------------------------ | --------- | ------------------------------------------ |
| `useConversationalAI(config)` | Hook      | Flagship hook — full lifecycle management  |
| `ConversationalAIProvider`     | Component | Context provider for standalone hooks      |
| `useTranscript()`              | Hook      | Transcript array from context              |
| `useAgentState()`              | Hook      | Agent state + event from context           |
| `useAgentError()`              | Hook      | Aggregated errors + clearError()           |
| `useAgentMetrics()`            | Hook      | Metrics from context                       |
| `useConversationalAIContext()` | Hook      | Controls (sendMessage, interrupt, instance) |

## Related Deep Dives

- [Event System](L2/event_system.md) — Event lifecycle, listener management, error routing
- [Rendering Controller](L2/rendering_controller.md) — How transcript messages are processed
