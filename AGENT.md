# AGENT.md

Reference for AI agents working in this repository.

## What this repo is

A pnpm monorepo containing:

- **`agora-agent-client-toolkit`** — framework-agnostic TypeScript SDK for Agora Conversational AI
- **`agora-agent-client-toolkit-react`** — React hooks wrapping the core SDK
- **`apps/demo`** — vanilla TS demo (Vite)
- **`apps/playground`** — interactive playground

## Commands

```bash
pnpm install                  # install all workspace deps
pnpm -r build                 # build all packages
pnpm --filter <name> build    # build one package
pnpm --filter <name> typecheck
```

## Source locations

| What | Where |
|------|-------|
| Core SDK source | `src/` |
| Core package config | `packages/conversational-ai/` |
| React hooks | `packages/react/src/` |
| Demo | `apps/demo/` |

> The tsup build for `agora-agent-client-toolkit` reads from `src/` (via `../../src` in `packages/conversational-ai/tsup.config.ts`). There is no source in `packages/conversational-ai/src/`.

## Public API surface

Exports from `agora-agent-client-toolkit`:

- `AgoraVoiceAI` — main singleton class (async `init()`)
- `AgoraVoiceAIConfig`, `RTMConfig` — config interfaces
- `AgoraVoiceAIEvents` — event name constants
- `CovSubRenderController` — transcript rendering controller
- `ChunkedMessageAssembler` — stream message assembly
- `IMetricsReporter`, `ConsoleMetricsReporter`, `AgoraMetricsReporter`
- All types and enums from `src/core/types.ts` and `src/core/events.ts`

Exports from `agora-agent-client-toolkit-react`:

- `useConversationalAI` — flagship lifecycle hook (init/destroy/subscribe + all events)
- `useTranscript` — standalone transcript observer
- `useAgentState` — standalone agent state observer
- `useAgentError` — standalone error observer (AGENT_ERROR + MESSAGE_ERROR)
- `useAgentMetrics` — standalone metrics observer

## Constraints

- **Do not modify `CovSubRenderController`** without explicit task scope. It is battle-tested rendering logic; bugs here are silent and hard to reproduce without real agent traffic.
- **RTM is optional** — never assume `rtmEngine` is present. Use `rtmConfig?.rtmEngine`.
- **`AgoraVoiceAI.init()` is async** — always `await`.
- **pnpm only** — no npm or yarn commands.
- **`jszip` and `@agora-js/report` are optional deps** — guard all usages.

## Key interfaces

```typescript
// Core config
interface AgoraVoiceAIConfig {
  rtcEngine: IAgoraRTCClient;       // required
  rtmConfig?: { rtmEngine: RTMClient }; // optional
  renderMode?: TranscriptHelperMode; // TEXT | WORD | AUTO
  enableLog?: boolean;
  enableAgoraMetrics?: boolean;
}
```

## Testing

```bash
# Core SDK tests
pnpm --filter agora-agent-client-toolkit test        # run once
pnpm --filter agora-agent-client-toolkit test:watch  # watch mode

# React hooks tests
pnpm --filter agora-agent-client-toolkit-react test
pnpm --filter agora-agent-client-toolkit-react test:watch
```

Core test files live in `packages/conversational-ai/__tests__/`:
- `chunked.test.ts` — `ChunkedMessageAssembler` assembly logic
- `chunked-validation.test.ts` — `ChunkedMessageAssembler` input validation
- `lifecycle.test.ts` — `AgoraVoiceAI` singleton lifecycle
- `messaging.test.ts` — RTM/RTC message handling
- `event-handlers.test.ts` — event emission and handler registration
- `concurrency.test.ts` — concurrent init and race conditions

React hook test files live in `packages/react/__tests__/`:
- `use-conversational-ai.test.tsx` — `useConversationalAI` lifecycle and state
- `standalone-hooks.test.tsx` — `useTranscript`, `useAgentState`, `useAgentError`, `useAgentMetrics`

Functional validation against real agent traffic still requires Agora sandbox credentials.

## npm Release

Release strategy:

- Do not use the final release version as the first validation artifact.
- Package and publish an RC first, for example `2.9.0-rc.1`.
- Validate the RC through web demo or clean-app consumption.
- If fixes are needed before final publish, publish the next RC.
- If a problem is found after the final version is published, do not overwrite or delete that version; publish a new version such as `2.9.1`.

Publishing is handled by GitHub Actions through npm, not Rehoboam. Both packages must use the same version:

- `agora-agent-client-toolkit`
- `agora-agent-client-toolkit-react`

Tag push publishes both packages and creates a GitHub Release. RC versions publish with npm dist-tag `rc`; final versions publish with `latest`.
