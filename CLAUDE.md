# CLAUDE.md

Guidelines for AI-assisted development in this repository.

## Package manager

**pnpm only.** Do not use npm or yarn.

```bash
pnpm install                          # install all workspace deps
pnpm -r build                         # build all packages
pnpm --filter <package-name> <script> # run a script in one package
```

Package filter names: `agora-agent-client-toolkit`, `agora-agent-client-toolkit-react`, `agora-conversational-ai-demo`.

## Source layout

The canonical source lives in **`src/`** at the repo root. `packages/conversational-ai/tsup.config.ts` points at `../../src` — the `packages/` directories contain build config and `package.json` only.

```
src/                              ← edit source here
packages/conversational-ai/       ← build config + package.json only
packages/react/src/               ← React hooks source (self-contained)
apps/demo/                        ← vanilla TS demo
apps/playground/                  ← full-stack React playground + FastAPI server
```

## Build

```bash
# Core package
pnpm --filter agora-agent-client-toolkit build

# React package
pnpm --filter agora-agent-client-toolkit-react build

# Type check only (no emit)
pnpm --filter agora-agent-client-toolkit typecheck
```

## Test

```bash
# Core SDK
pnpm --filter agora-agent-client-toolkit test

# React hooks
pnpm --filter agora-agent-client-toolkit-react test

# Format check (runs in CI)
pnpm format:check
```

## Do not touch

**`src/rendering/sub-render.ts`, `src/rendering/sub-render-queue.ts`, `src/rendering/sub-render-pts.ts`**

The rendering controller is the most complex and highest-risk module in the codebase. The `CovSubRenderController` public interface (`handleMessage`, `handleAgentStatus`, `setMode`, `setPts`, `run`, `cleanup`) must not change without a dedicated task. Any change to rendering logic requires testing against real agent traffic — unit tests are not sufficient.

## Key architecture facts

- `AgoraVoiceAI` is a **singleton** — `init()` creates it, `getInstance()` retrieves it, `destroy()` clears it.
- `AgoraVoiceAI.init()` is **async** — always `await` it.
- RTM is **optional** — use the top-level `rtmEngine` field. RTM-backed methods, including `speak()` and `think()`, throw if it is omitted.
- `AgoraVoiceAIConfig` is defined in `src/core/config.ts`. `src/core/conversational-ai.ts` re-exports it — don't define it there.

## Package names

| What you type                      | Resolves to |
| ---------------------------------- | ----------- |
| `agora-agent-client-toolkit`       | core SDK    |
| `agora-agent-client-toolkit-react` | React hooks |

## Error event routing

Two error events exist — do not conflate them:

| Event           | When it fires                                                                     | Handler                                                   |
| --------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `AGENT_ERROR`   | Agent-side module error (TTS, STT, LLM failures)                                  | `onAgentError(uid, { type, code, message, timestamp })`   |
| `MESSAGE_ERROR` | Client-side message delivery failure (image upload rejected, context parse error) | `onMessageError(uid, { type, code, message, timestamp })` |

When adding error handling: agent runtime failures → `AGENT_ERROR`. Outbound message failures → `MESSAGE_ERROR`.

## Optional dependencies

`jszip` and `@agora-js/report` are in `optionalDependencies`. Do not move them to `dependencies`. Code that uses them must guard with a try/catch dynamic import.

## File size

Three files intentionally exceed the 400-line guideline: `src/rendering/sub-render.ts` (741 lines), `src/rendering/sub-render-queue.ts` (568 lines), `src/core/conversational-ai.ts` (~850 lines). Do not split these further without a dedicated task — further splitting would require architectural justification.
