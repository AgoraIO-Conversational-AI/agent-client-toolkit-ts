# 01 Setup

> Environment setup, dependencies, build commands, and local development for the toolkit monorepo.

## Prerequisites

| Requirement | Version   | Notes                            |
| ----------- | --------- | -------------------------------- |
| Node.js     | ≥20       | CI tests on 20, 22, 24          |
| pnpm        | ≥9        | Only supported package manager   |

- npm and yarn lockfiles are rejected; pnpm only
- No `.env` files required — this is a library, not a service

## Install and Build

```bash
pnpm install
pnpm build          # builds both core and react packages
```

## Quick Commands

| Command              | What It Does                                    |
| -------------------- | ----------------------------------------------- |
| `pnpm install`       | Install all workspace dependencies              |
| `pnpm build`         | Build core + react packages (tsup)              |
| `pnpm test`          | Run all tests (vitest)                          |
| `pnpm lint`          | Run ESLint across all packages                  |
| `pnpm format`        | Run Prettier across all packages                |
| `pnpm format:check`  | Check Prettier formatting without writing       |
| `pnpm typecheck`     | Type-check all packages                         |

## Package Manager

- **pnpm only** — workspace uses `pnpm-workspace.yaml`
- Workspaces: `packages/*` and `apps/*`
- The `packages/conversational-ai` package references source in root `src/` (no source duplication)

## Build System

- **tsup** — bundles both packages to CJS + ESM + type declarations
- Output: `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts`, `dist/index.d.mts`
- Tree-shakeable (`sideEffects: false`)

## Running Demo Apps

```bash
cd apps/demo && pnpm dev        # Vanilla TS demo (Vite)
cd apps/playground && pnpm dev  # React playground
```

Both apps require valid Agora App ID and token — see their respective README files.

## CI Pipeline

- GitHub Actions: `.github/workflows/ci.yml`
- Matrix: Node 20, 22, 24 on Ubuntu
- Steps: lint → format check → build → typecheck → test → coverage (Node 20 only)
- Publish: triggered by tag push; publishes both packages to npm with provenance

## Package Filter Names

| Filter Name                          | Resolves To              |
| ------------------------------------ | ------------------------ |
| `agora-agent-client-toolkit`         | Core SDK package         |
| `agora-agent-client-toolkit-react`   | React hooks package      |
| `agora-conversational-ai-demo`       | Vanilla TS demo app      |

Use with `pnpm --filter <name> <script>` to target a specific package.

## Peer Dependencies (for consuming apps)

| Package              | Version   | Required? |
| -------------------- | --------- | --------- |
| `agora-rtc-sdk-ng`   | ≥4.23.4   | Yes       |
| `agora-rtm`          | ≥2.0.0    | Optional  |
| `react`              | ≥18       | React only |
| `agora-rtc-react`    | ≥2.0      | React only |

## Common Setup Issues

- **Wrong package manager** — `npm install` or `yarn install` will fail; use `pnpm install`
- **Node version too low** — Node 18 may work but is not tested; use ≥20
- **Missing peer deps in apps** — demo apps need `agora-rtc-sdk-ng` installed separately
- **Workspace protocol errors** — if you see `workspace:*` resolution errors, run `pnpm install` from repo root
- **Build order matters** — core package must build before react package; `pnpm build` handles this automatically

## Related Deep Dives

- [Build Pipeline](L2/build_pipeline.md) — Multi-target builds, workspace structure, publish workflow
