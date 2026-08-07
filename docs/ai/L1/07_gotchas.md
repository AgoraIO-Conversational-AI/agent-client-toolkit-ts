# 07 Gotchas

> Critical gotchas, tribal knowledge, and non-obvious behaviors in the toolkit.

## High-Risk Modules — Do Not Modify Without Explicit Task

These files are battle-tested against real agent traffic. Silent failures in production are hard to debug:

| File                            | Lines | Why It's High-Risk                            |
| ------------------------------- | ----- | --------------------------------------------- |
| `src/rendering/sub-render.ts`   | ~740  | Transcript rendering logic; subtle state bugs |
| `src/rendering/sub-render-queue.ts` | ~570 | Queue ordering; race conditions possible   |
| `src/rendering/sub-render-pts.ts`   | ~100 | PTS timing; audio sync sensitivity        |

These files are intentionally large. Do not split without architectural justification.

## Singleton Lifecycle Quirks

- `getInstance()` throws `NotInitializedError` if called before `init()`
- Calling `init()` while another `init()` is in-flight waits for the first, then re-inits
- `destroy()` is idempotent — safe to call multiple times
- React `StrictMode` double-invokes effects; the hook tracks a `cancelled` flag to handle this

## RTM Is Optional but Silent

- Three methods require RTM and throw `RTMRequiredError`: `sendText()`, `sendImage()`, `interrupt()`
- RTM-dependent **events** (`AGENT_STATE_CHANGED`, `MESSAGE_RECEIPT_UPDATED`, `MESSAGE_ERROR`) simply do not fire if RTM is not configured — **no error thrown**
- These events also require specific agent-side config: `enable_rtm: true`, `data_channel: "rtm"`, `enable_error_message: true`, `enable_metrics: true`

## Transcript Mode Detection

- `AUTO` mode (default) infers rendering mode from the first agent message
- `WORD` mode requires `AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true)` **before** client creation
- Switching modes after init requires full re-initialization

## Chunked Message Assembly

- Wire format is 1-based; `part_idx < 1` is rejected
- `part_sum === "???"` treated as unknown (`-1`)
- Deduplication by `part_idx` prevents replay attacks
- TTL of 30 seconds; older incomplete messages auto-evicted
- Cache cap of 1000 entries; oldest evicted when exceeded

## Event Listener Limits

- Default max 10 listeners per event (Node.js convention)
- Exceeding the limit logs a warning; set `setMaxListeners(0)` to disable
- Can indicate memory leaks — investigate before suppressing

## React Config Stability

- Dev-mode warning if config object changes identity without channel change
- Wrap config in `useMemo([])` to maintain stable identity
- Changing identity triggers unnecessary re-init cycle

## Error Event Routing

- `AGENT_ERROR` = agent-side module failures (LLM, TTS, context errors)
- `MESSAGE_ERROR` = client-side RTM message delivery failures
- **Never conflate these** — use different handlers
- `AGENT_ERROR` requires `enable_error_message: true` in agent start params

## Dev vs Production Behavior

- Engine validation (method presence checks on RTCEngine/RTMEngine) runs **only in development**
- Production skips validation for performance
- If an engine is missing methods, dev will error; production will crash at runtime

## Optional Dependencies

- `@agora-js/report` — dynamically imported; falls back to `ConsoleMetricsReporter` if missing
- `jszip` — dynamically imported; used in helper paths
- Both guarded with try/catch on import; library continues working without them

## Monorepo Gotcha

- `packages/conversational-ai/` has **no source files** — all source lives in root `src/`
- Build config (`tsup.config.ts`) points to `../../src/index.ts`
- This is intentional; do not add source files to the package directory

## Related Deep Dives

- [Rendering Controller](L2/rendering_controller.md) — Detailed rendering mode behavior and edge cases
- [Event System](L2/event_system.md) — Error routing details
