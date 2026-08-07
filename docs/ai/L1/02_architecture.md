# 02 Architecture

> System design overview: singleton lifecycle, event-driven rendering, and structural typing for Agora RTC/RTM integration.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Application                            │
│  (Vanilla JS / React / any framework)                               │
└──────────┬────────────────────────────────────┬─────────────────────┘
           │                                    │
    ┌──────▼──────────┐              ┌──────────▼──────────┐
    │  Core SDK        │              │  React Package       │
    │  agora-agent-    │◄─────────────│  agora-agent-        │
    │  client-toolkit  │  wraps       │  client-toolkit-     │
    │                  │              │  react                │
    └──────┬──────────┘              └─────────────────────┘
           │
    ┌──────▼──────────────────────────────────────────────┐
    │                  AgoraVoiceAI (singleton)            │
    │                                                      │
    │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
    │  │ Chunked      │  │ SubRender    │  │ Event      │ │
    │  │ Message      │  │ Controller   │  │ Helper     │ │
    │  │ Assembler    │  │ (TEXT/WORD/  │  │ (typed     │ │
    │  │              │  │  CHUNK/AUTO) │  │  emitter)  │ │
    │  └──────┬───────┘  └──────┬──────┘  └─────┬──────┘ │
    └─────────┼─────────────────┼────────────────┼────────┘
              │                 │                │
    ┌─────────▼─────────────────▼────────────────▼────────┐
    │          Agora Peer SDKs (structural contracts)      │
    │  ┌──────────────┐          ┌──────────────┐         │
    │  │ RTCEngine    │          │ RTMEngine    │         │
    │  │ (required)   │          │ (optional)   │         │
    │  └──────────────┘          └──────────────┘         │
    └─────────────────────────────────────────────────────┘
```

## Package Structure

| Package                            | Purpose                           | Dependencies          |
| ---------------------------------- | --------------------------------- | --------------------- |
| `agora-agent-client-toolkit`       | Core SDK — framework-agnostic     | Zero runtime deps     |
| `agora-agent-client-toolkit-react` | React hooks wrapping core SDK     | Peer: react, core SDK |

- Core package is usable standalone (Vanilla JS, Vue, Angular, etc.)
- React package adds hooks and context; depends on core via workspace protocol

## Singleton Lifecycle

```
init(config) ──► getInstance() ──► subscribeMessage(channel)
                                          │
                                   binds RTC listeners
                                   binds RTM listeners (if present)
                                   starts SubRenderController
                                          │
                                   ◄── events flow ──►
                                          │
                              unsubscribe() ──► destroy()
```

- `init()` is async; validates engine shape in dev mode
- Calling `init()` while already initializing waits for first, then re-inits
- `destroy()` is idempotent; resets singleton to null

## Message Processing Pipeline

```
RTC stream-message ──► ChunkedMessageAssembler.assemble()
                              │ (reassembles multi-part messages)
                              ▼
                       CovSubRenderController.handleMessage()
                              │ (TEXT/WORD/CHUNK/AUTO mode)
                              ▼
                       SubRenderQueue (manages history)
                              │
                              ▼
                       emit TRANSCRIPT_UPDATED
```

## Agent State Flow

```
RTM presence event ──► AgoraVoiceAI._handleRtmPresence()
                              │
                              ▼
                       CovSubRenderController.handleAgentStatus()
                              │
                              ▼
                       emit AGENT_STATE_CHANGED
```

## Key Design Decisions

- **Structural typing** — RTC/RTM engines matched by method shape, not by importing peer SDK types; eliminates version coupling
- **Optional RTM** — RTC-only mode works for receive-only use cases; RTM adds send/interrupt/state
- **Pre-bound handlers** — event handlers stored as instance fields for reliable unbinding
- **Callback wrapping** — each listener wrapped in try/catch so one error does not crash others
- **Optional dependencies** — `@agora-js/report` and `jszip` dynamically imported with fallback

## Related Deep Dives

- [Rendering Controller](L2/rendering_controller.md) — TEXT/WORD/CHUNK modes, PTS timing, queue system
- [Event System](L2/event_system.md) — Event types, listener management, error routing
