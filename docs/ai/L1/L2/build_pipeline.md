# Build Pipeline

> **When to Read This:** Load this document when changing build configuration, adding new packages to the monorepo, or troubleshooting the publish workflow.

## Overview

The monorepo uses pnpm workspaces with tsup for bundling. Two packages are published to npm; two apps are for development only.

## Workspace Structure

```
pnpm-workspace.yaml
├── packages/
│   ├── conversational-ai/    → published as agora-agent-client-toolkit
│   └── react/                → published as agora-agent-client-toolkit-react
└── apps/
    ├── demo/                 → not published (Vite vanilla TS)
    └── playground/           → not published (React playground)
```

## Source Location Quirk

The core package (`packages/conversational-ai/`) contains **no source files**. All source lives in root `src/`. The package's `tsup.config.ts` entry point is `../../src/index.ts`.

The React package is self-contained with source in `packages/react/src/`.

## Build Output (Both Packages)

| Output           | Format | Purpose        |
| ---------------- | ------ | -------------- |
| `dist/index.js`  | CJS    | CommonJS entry |
| `dist/index.mjs` | ESM    | ES module entry |
| `dist/index.d.ts` | Types | CJS type declarations |
| `dist/index.d.mts` | Types | ESM type declarations |

- `sideEffects: false` enables tree-shaking
- Both packages export via `exports` field in `package.json`

## CI Pipeline (`.github/workflows/ci.yml`)

### Build + Test Job (Release Gate)
- Matrix: Node 20, 22, 24 (`fail-fast: false` — all variants must pass)
- Steps: lint → format check → build core → build react → typecheck → typecheck:interop → test → coverage
- `typecheck:interop` type-checks `packages/conversational-ai/__typetests__/interop.ts` — a type-level test verifying structural typing contracts work with foreign SDK shapes. Catches breaking changes to engine contracts.
- Coverage runs only on Node 20 and writes a GitHub Step Summary. Coverage thresholds are enforced by vitest config.

### Publish Job
- `needs: [build-and-test]` — ALL matrix variants must pass before publish proceeds. This makes `build-and-test` the hard release gate.
- Trigger: tag push (`v*`) or manual workflow dispatch
- Publishes both packages to npm with `--provenance`
- Skips if version already published (checks npm registry)
- Creates GitHub Release with auto-generated notes

## Adding a New Package

1. Create directory under `packages/` or `apps/`
2. It's automatically included via `pnpm-workspace.yaml` globs
3. Add `package.json` with `name`, `version`, build scripts
4. Add `tsup.config.ts` for build configuration
5. Add `vitest.config.ts` for tests
6. Reference other workspace packages via `"workspace:*"` protocol
7. Update CI if the new package should be published

## See Also

- [Back to Setup](../01_setup.md)
- [Back to Code Map](../03_code_map.md)
