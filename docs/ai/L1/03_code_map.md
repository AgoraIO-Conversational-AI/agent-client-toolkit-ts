# 03 Code Map

> Directory structure, module responsibilities, and where to find things in the monorepo.

## Top-Level Layout

```
repo-root/
├── src/                          # Core SDK source (canonical)
│   ├── core/                     # Singleton, config, types, events
│   ├── rendering/                # Transcript rendering controller
│   ├── messaging/                # Chunked message assembly
│   ├── utils/                    # Debug logging, metrics reporters
│   └── index.ts                  # Public export barrel
├── packages/
│   ├── conversational-ai/        # Core package (build config only)
│   │   ├── __tests__/            # Core tests
│   │   ├── __typetests__/        # Type-level tests
│   │   ├── tsup.config.ts
│   │   ├── vitest.config.ts
│   │   └── package.json
│   └── react/                    # React hooks package
│       ├── src/                  # React source
│       ├── __tests__/            # React tests
│       ├── tsup.config.ts
│       ├── vitest.config.ts
│       └── package.json
├── apps/
│   ├── demo/                     # Vanilla TS demo (Vite)
│   └── playground/               # React playground
├── .github/workflows/ci.yml     # CI pipeline
├── pnpm-workspace.yaml          # Workspace config
└── package.json                  # Root workspace scripts
```

## Core SDK Modules (`src/`)

| File                              | Responsibility                                          | Lines | Risk   |
| --------------------------------- | ------------------------------------------------------- | ----- | ------ |
| `core/conversational-ai.ts`      | `AgoraVoiceAI` singleton — lifecycle, RTC/RTM binding   | ~850  | High   |
| `core/types.ts`                   | All type definitions, enums, error classes               | ~350  | Medium |
| `core/events.ts`                  | `EventHelper` base class, event type definitions         | ~150  | Medium |
| `core/config.ts`                  | Configuration types and defaults                         | ~90   | Low    |
| `rendering/sub-render.ts`         | `CovSubRenderController` — transcript rendering          | ~740  | High   |
| `rendering/sub-render-queue.ts`   | `SubRenderQueue` — chat history and queue management     | ~570  | High   |
| `rendering/sub-render-pts.ts`     | `SubRenderPTS` — PTS-based word timing                   | ~100  | High   |
| `messaging/chunked.ts`            | `ChunkedMessageAssembler` — multi-part message assembly  | ~200  | Medium |
| `utils/debug.ts`                  | Debug logging utilities                                  | ~50   | Low    |
| `utils/metrics.ts`                | Metrics reporters (Console + optional Agora)             | ~80   | Low    |
| `index.ts`                        | Public export barrel                                     | ~60   | Low    |

## React Package (`packages/react/src/`)

| File                           | Responsibility                                      |
| ------------------------------ | --------------------------------------------------- |
| `use-conversational-ai.ts`     | Flagship hook — init, subscribe, event handling      |
| `context.ts`                   | `ConversationalAIProvider` + standalone hooks         |
| `use-transcript.ts`            | Standalone transcript hook (reads from context)      |
| `use-agent-state.ts`           | Standalone agent state hook                          |
| `use-agent-metrics.ts`         | Standalone metrics hook                              |
| `index.ts`                     | Public export barrel                                 |

## Key Observation

- **Source lives in root `src/`** — the `packages/conversational-ai/` directory has build config and tests but no source files
- This means the core package's `tsup.config.ts` points to `../../src/index.ts` as entry

## Core Files by Task

| Task                              | Start Here                                |
| --------------------------------- | ----------------------------------------- |
| Add a new event type              | `src/core/events.ts` + `src/core/types.ts` |
| Modify transcript rendering       | `src/rendering/sub-render.ts`             |
| Change message parsing            | `src/messaging/chunked.ts`                |
| Add a React hook                  | `packages/react/src/`                     |
| Update public API                 | `src/index.ts` + package `index.ts`       |
| Add a new config option           | `src/core/config.ts` + `src/core/types.ts` |
| Fix singleton lifecycle           | `src/core/conversational-ai.ts`           |
| Update CI pipeline                | `.github/workflows/ci.yml`                |

## Related Deep Dives

- [Build Pipeline](L2/build_pipeline.md) — How source maps to packages, dual CJS/ESM output
