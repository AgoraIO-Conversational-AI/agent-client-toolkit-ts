# 04 Conventions

> Coding patterns, naming rules, error handling, and testing standards used across the toolkit.

## TypeScript Rules

- **Strict mode** — enforced across all packages
- **No `any`** — use `unknown` with type guards instead
- **No `@ts-ignore`** — except for documented unavoidable SDK private APIs
- **Structural typing** — RTC/RTM engine contracts defined in toolkit (`RTCEngine`, `RTMEngine`), not imported from peer SDKs

## Naming Conventions

| Element             | Convention                   | Example                       |
| ------------------- | ---------------------------- | ----------------------------- |
| Classes             | PascalCase                   | `AgoraVoiceAI`                |
| Interfaces/Types    | PascalCase                   | `RTCEngine`, `RTMConfig`      |
| Enums               | PascalCase, UPPER_SNAKE vals | `AgentState.SPEAKING`         |
| Methods (public)    | camelCase                    | `subscribeMessage()`          |
| Methods (private)   | `_camelCase`                 | `_handleRtcStreamMessage()`   |
| Event names         | UPPER_SNAKE_CASE             | `TRANSCRIPT_UPDATED`          |
| Files               | kebab-case                   | `sub-render-queue.ts`         |
| Test files           | `*.test.ts` / `*.test.tsx`  | `chunked.test.ts`             |

## Module Organization

- Exports concentrated in `index.ts` barrel files
- Source in `src/`, tests in `__tests__/` (sibling to build config)
- Type definitions centralized in `types.ts`
- Type imports first, then regular imports

## Error Handling

- Custom errors extend `ConversationalAIError` base class
- Error classes: `NotInitializedError`, `RTMRequiredError`
- Descriptive messages include context (method name, trace ID)
- Two event-based error channels:
  - `AGENT_ERROR` — agent-side module failures (LLM, TTS, context)
  - `MESSAGE_ERROR` — client-side RTM delivery failures
  - Never conflate these; use separate handlers

## Logging

- Controlled by `enableLog` config flag (default: false)
- Log levels: `NONE`, `ERRORS`, `DEBUG`
- Lazy logging via `callMessagePrint()` guard — no string construction if logging disabled
- Trace IDs attached for distributed tracing

## Testing

- **Framework:** vitest (jest-compatible syntax)
- **Coverage thresholds (CI-enforced):**

| Package | Lines | Functions | Branches |
| ------- | ----- | --------- | -------- |
| Core    | 40%   | 50%       | 65%      |
| React   | 70%   | 70%       | 60%      |

- React tests use `@testing-library/react`
- Type-level tests in `__typetests__/` verify structural typing contracts

## Performance Patterns

- Pre-bound event handlers — stored as instance fields; avoids re-binding per event
- Callback wrapping — each listener in try/catch for error isolation
- Incremental transcript updates via queue system
- Optional dependencies (`@agora-js/report`, `jszip`) loaded via dynamic import with try/catch

## Code Style

- **ESLint + Prettier** — enforced in CI
- **JSDoc** — required on all public API methods with `@example`, `@remarks`, `@throws`
- **No narrative prose in comments** — prefer self-documenting code; add comments only for non-obvious decisions

## Structural Typing Pattern

Engine contracts (`RTCEngine`, `RTMEngine`) are defined in the toolkit, not imported from peer SDKs:

- Defined in `src/core/types.ts` — toolkit owns the contract shape
- Apps pass their actual Agora SDK instances; TypeScript checks structural compatibility
- This decouples the toolkit from specific peer SDK versions
- Engine validation (method presence checks) runs in development mode only

## Deprecation Pattern

- Deprecated types are re-exported with `@deprecated` JSDoc tags
- Example: `NotFoundError` is a deprecated alias for `NotInitializedError`
- Migration guidance documented in `MIGRATION.md` per version
- Breaking changes follow semver — major version bump required

## Related Deep Dives

- None
