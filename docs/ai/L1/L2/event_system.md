# Event System

> **When to Read This:** Load this document when adding new event types, debugging event flow, or modifying error routing between agent-side and client-side errors.

## Overview

The event system is built on `EventHelper<T>`, a generic typed event emitter. `AgoraVoiceAI` extends it with specific event types for conversational AI.

## EventHelper Base Class

- Generic over handler map type `T`
- Methods: `on(event, listener)`, `off(event, listener)`, `emit(event, ...args)`
- Default max 10 listeners per event; configurable via `setMaxListeners(n)`
- Exceeding limit logs a warning (potential memory leak indicator)
- Each listener is wrapped in try/catch — one failing listener does not crash others

## Event Types and Sources

| Event                      | Source     | Requires RTM? | Requires Agent Config?          |
| -------------------------- | ---------- | ------------- | ------------------------------- |
| `TRANSCRIPT_UPDATED`       | RTC        | No            | No                              |
| `AGENT_STATE_CHANGED`      | RTM        | Yes           | `enable_rtm: true`              |
| `AGENT_INTERRUPTED`        | RTM        | Yes           | `enable_rtm: true`              |
| `AGENT_METRICS`            | RTM        | Yes           | `enable_metrics: true`          |
| `AGENT_ERROR`              | RTM        | Yes           | `enable_error_message: true`    |
| `MESSAGE_RECEIPT_UPDATED`  | RTM        | Yes           | `enable_rtm: true`              |
| `MESSAGE_ERROR`            | Client RTM | Yes           | No (client-side delivery error) |
| `MESSAGE_SAL_STATUS`       | RTM        | Yes           | `enable_rtm: true`              |
| `DEBUG_LOG`                | Internal   | No            | `enableLog: true`               |

## Error Routing

Two distinct error channels exist:

### AGENT_ERROR
- Fired when the AI agent's internal modules fail (LLM timeout, TTS error, context overflow)
- Payload includes: `module` (which agent module), error details, `turn_id`
- Requires `enable_error_message: true` in agent start parameters

### MESSAGE_ERROR
- Fired when the client's RTM message delivery fails
- Payload includes: delivery failure details, message metadata
- Client-side error — does not require agent config

### React useAgentError() Hook
- Aggregates both `AGENT_ERROR` and `MESSAGE_ERROR` into a discriminated union
- `source: 'agent' | 'message'` distinguishes the two
- `clearError()` resets the error state

## Listener Lifecycle

```
AgoraVoiceAI.init(config)
    │
    ▼
subscribeMessage(channel)
    │ binds pre-bound handlers to RTC/RTM
    │ stores handler references for later unbinding
    ▼
[events flow to registered listeners]
    │
    ▼
unsubscribe()
    │ unbinds handlers using stored references
    ▼
destroy()
    │ removes all listeners
    │ resets singleton
```

- Handlers are pre-bound as instance fields (not arrow functions in methods)
- This allows `off()` to match the same function reference used in `on()`
- React hooks register listeners in `useEffect` cleanup cycle

## See Also

- [Back to Interfaces](../06_interfaces.md)
- [Back to Architecture](../02_architecture.md)
