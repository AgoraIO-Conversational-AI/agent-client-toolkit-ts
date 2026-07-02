# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).
Migration notes for each release should link to the matching section in [MIGRATION.md](./MIGRATION.md).

## [v2.9.0-rc.1] - 2026-07-02

Release candidate for the 2.9.0 ConvoAI API line.

### agora-agent-client-toolkit

#### Added

- Added manual turn control APIs: `manualSOS(agentUserId, requestId?)` and `manualEOS(agentUserId, requestId?)`.
- Added server result event types for `user.manual_sos.result`, `user.manual_eos.result`, and `assistant.manual_eos.result`.
- Added turn-finished latency event support through `AGENT_TURN_FINISHED`.
- Added message SAL / voiceprint status event support through `MESSAGE_SAL_STATUS`.
- Added image-message publishing support through `sendImage(...)`.

#### Changed

- Version aligned with the 2.9.0 ConvoAI API release line.
- Web demo startup flow now subscribes to toolkit messages before starting the agent so transcript and state events are not missed during startup.

#### Upgrade notes

- RTM is required for `sendText`, `sendImage`, `interrupt`, `manualSOS`, and `manualEOS`.
- `manualSOS()` and `manualEOS()` resolve when RTM publish succeeds. Server validation arrives later through the manual turn result events.
- Applications should register event handlers and subscribe to the channel before starting the agent.

### agora-agent-client-toolkit-react

#### Added

- Added React hook/context accessors for `manualSOS(...)` and `manualEOS(...)`.

#### Changed

- Version aligned with `agora-agent-client-toolkit`.

## [v1.2.0] — 2026-04-06

### agora-agent-client-toolkit

#### Changed
- TypeScript public config contracts now use toolkit-owned structural interfaces: `RTCEngine` and `RTMEngine`
- `AgoraVoiceAI.init()` now accepts compatible RTC/RTM client objects without requiring `as unknown as` casts in strict package-manager layouts
- Public type surface no longer depends on `agora-rtm` event/class types (`RTMClient`, `RTMEvents`) for config and transcript event payload typing
- Tightened RTC structural typing with transcript-focused helper interfaces (`RTCStreamMessageLike`, `RTCDataStreamParamsLike`) and stricter `RTCEngine.on/off` overloads for `'stream-message'` and `'audio-pts'`
- Added development-time engine-shape validation in `AgoraVoiceAI.init()` with actionable error messages when required RTC/RTM methods are missing
- Improved public API discoverability with expanded JSDoc for `AgoraVoiceAIConfig`, `renderMode`, React hooks, and `TranscriptHelperItem<T>` generic typing

#### Added
- Interop type-check fixture: `packages/conversational-ai/__typetests__/interop.ts` with `typecheck:interop` script
- Coverage command surface (`test:coverage`) for root, core, and React packages
- CI coverage summary output in GitHub Actions step summary
- Additional lifecycle tests for invalid RTC/RTM engine inputs and React hook test coverage expansion

#### Upgrade notes
- Quick guide: see [MIGRATION.md#11x---120](./MIGRATION.md#11x---120) for `1.1.x -> 1.2.0`.
- `AgoraVoiceAIConfig.rtcEngine` and `RTMConfig.rtmEngine` now use structural contracts (`RTCEngine`, `RTMEngine`) instead of peer SDK class/interface types.
- Existing real Agora RTC/RTM clients continue to work without code changes.
- If your app previously used casts (for example `as unknown as`), they are now redundant and can be removed.
- If you authored custom wrappers, ensure they implement the required methods:
  - RTC: `on`, `off`
  - RTM: `publish`, `addEventListener`, `removeEventListener`
- Runtime checks now fail fast in development when required engine methods are missing; align custom test doubles with the structural contracts.
- Coverage policy now explicitly aligns with the configured Vitest thresholds in `CONTRIBUTING.md`.

### agora-agent-client-toolkit-react

#### Changed
- Removed internal `rtcEngine` cast workaround when passing `useRTCClient()` into `AgoraVoiceAI.init()`

## [v1.1.0] — 2026-03-17

### agora-agent-client-toolkit

#### Fixed
- `ChunkedMessageAssembler`: explicitly reject `rawPartIdx < 1` before normalization — a zero value from the wire (invalid for 1-based format) previously passed through silently as chunk index 0, causing incorrect message assembly
- `ChunkedMessageAssembler`: simplified `part_idx` normalization to `rawPartIdx - 1` now that the `< 1` guard makes the conditional expression redundant
- `CovSubRenderController`: fix uid resolution in `handleTextMessage` and `_handleTranscriptChunk` — uid is now determined by `message.object === MessageType.USER_TRANSCRIPTION` rather than `stream_id` presence, preventing agent transcriptions from being attributed to the wrong uid
- `SubRenderPTS.setPts()`: allow PTS to reset to `0` on stream restart — previous `pts !== 0` guard blocked this, causing word rendering to freeze after reconnection

### agora-agent-client-toolkit-react

#### Fixed
- `context.ts`: updated context exports to correctly reflect renamed core package imports

### Docs

- `README.md`: updated install instructions to use `pnpm add` and removed pre-release note
- `AGENT.md`: added full test file inventory for core and React packages with commands for both
- `CLAUDE.md`: added Test section with commands, added `AGENT_ERROR` vs `MESSAGE_ERROR` routing table
- `CHANGELOG.md`: retroactively corrected v0.1.0 → v1.0.0 for initial release

---

## [v1.0.0] — 2026-03-11

Initial public release.

### agora-agent-client-toolkit

- `AgoraVoiceAI` singleton with async `init()`
- Event system: `TRANSCRIPT_UPDATED`, `AGENT_STATE_CHANGED`, `AGENT_ERROR`, `AGENT_METRICS`, `AGENT_INTERRUPTED`, `MESSAGE_ERROR`, `MESSAGE_RECEIPT_UPDATED`, `MESSAGE_SAL_STATUS`, `DEBUG_LOG`
- RTC-only mode — RTM is optional; methods requiring RTM (`sendText`, `sendImage`, `interrupt`) throw `RTMRequiredError`
- `CovSubRenderController` with TEXT, WORD, and AUTO rendering modes
- `ChunkedMessageAssembler` for stream message reassembly with input validation and cache size limits
- Structured error classes: `ConversationalAIError`, `NotInitializedError`, `RTMRequiredError`
- Optional Agora metrics via `enableAgoraMetrics: true` (requires `@agora-js/report`)
- Zero required runtime dependencies

### agora-agent-client-toolkit-react

- `useConversationalAI` — flagship lifecycle hook (init, subscribe, destroy)
- `useTranscript` — standalone transcript observer
- `useAgentState` — standalone agent state observer
- `useAgentError` — standalone error observer (AGENT_ERROR + MESSAGE_ERROR)
- `useAgentMetrics` — standalone metrics observer
