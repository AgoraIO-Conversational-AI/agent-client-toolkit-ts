# Contributing

Thanks for your interest in contributing to the Agora Agent Client Toolkit.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+ (**required** — do not use npm or yarn)

### Install and build

```bash
pnpm install
pnpm -r build
```

### Run tests

```bash
# Core package
pnpm --filter agora-agent-client-toolkit test

# React package
pnpm --filter agora-agent-client-toolkit-react test
```

### Run the demo

```bash
pnpm --filter agora-conversational-ai-demo dev  # see apps/demo/README.md
# Requires local server credentials; see apps/playground/README.md
pnpm --filter agora-conversational-ai-playground dev
```

## Project Structure

```
src/                              # Core SDK source (canonical location)
packages/conversational-ai/       # Build config + package.json for core
packages/react/src/               # React hooks source
apps/demo/                        # Vanilla TS demo
apps/playground/                  # Full-stack React playground + FastAPI server
```

`packages/conversational-ai/tsup.config.ts` points at `../../src` — edit source files in `src/`, not inside `packages/conversational-ai/`.

## Code Style

- **No `any`** — use `unknown` and narrow with type guards.
- **No `@ts-ignore`** — except for documented unavoidable SDK private APIs.
- **pnpm only** — `npm` and `yarn` lockfiles will be rejected.
- Keep optional dependencies (`jszip`, `@agora-js/report`) behind dynamic `import()` with try/catch.

## Rendering Controller Constraint

**Do not modify** `src/rendering/sub-render.ts`, `src/rendering/sub-render-queue.ts`, or `src/rendering/sub-render-pts.ts` without a dedicated, approved task. These files contain the highest-risk logic in the codebase and require testing against real agent traffic — unit tests alone are not sufficient.

## Pull Requests

1. Create a feature branch from `main` (e.g. `feat/add-new-hook`, `fix/destroy-race`).
2. Make your changes. Add or update tests as appropriate.
3. Before pushing, run:
   ```bash
   pnpm -r build
   pnpm --filter agora-agent-client-toolkit test
   pnpm --filter agora-agent-client-toolkit-react test
   pnpm --filter agora-agent-client-toolkit typecheck
   pnpm format:check
   ```
4. Open a PR with a clear description of what changed and why.
5. Keep PRs focused — one feature or fix per PR.

## Testing

- Core tests use vitest with jsdom. Test files live in `packages/conversational-ai/__tests__/`.
- React hook tests use `@testing-library/react` with `renderHook`. Test files live in `packages/react/__tests__/`.
- All new public API surface should have corresponding tests.
- Test error paths, not just happy paths.
- Coverage thresholds are enforced in package `vitest.config.ts` files:
  - Core (`packages/conversational-ai`): lines/statements 40%, functions 50%, branches 65%
  - React (`packages/react`): lines/functions/statements 70%, branches 60%
- Treat these as minimum gates; prefer raising coverage when touching low-covered areas.

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected vs actual behavior
- SDK version and environment (browser, Node.js version)
