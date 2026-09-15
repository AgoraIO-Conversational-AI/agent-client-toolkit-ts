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

## Releasing

Releases publish both SDK packages together. The workflow in
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) is the source of truth;
the steps below describe its current contract.

### Prepare the release PR

1. Choose an unused stable SemVer version. Confirm that it is not already on
   npm:

   ```bash
   npm view "agora-agent-client-toolkit@X.Y.Z" version
   npm view "agora-agent-client-toolkit-react@X.Y.Z" version
   ```

   Both lookups should report that the version does not exist. npm versions
   cannot be overwritten after publication. These `npm view` commands only
   inspect the registry; continue to use pnpm for workspace dependencies and
   scripts.

2. Update the release version in all required locations:

   - `package.json` (private workspace metadata)
   - `packages/conversational-ai/package.json` (published core package)
   - `packages/react/package.json` (published React package)
   - `src/core/conversational-ai.ts` (`VERSION`, used in SDK diagnostics)

   The core and React package versions must match; CI rejects mismatched
   versions. `apps/playground/package.json` is private and is not published or
   validated by the release job, so update it only when intentionally aligning
   the Playground version with the SDK release.

3. Update the release-facing documentation:

   - Add the release to `CHANGELOG.md`.
   - Add `MIGRATION.md` guidance when consumers must change code or behavior.
   - Update version references and migration links in the root and package
     READMEs.

4. Open a focused release PR and confirm every PR check passes, including the
   Node 20/22/24 matrix, coverage, Playground build/tests, and Docker smoke
   test. To run the release checks locally:

   ```bash
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm format:check
   pnpm build
   pnpm --filter agora-agent-client-toolkit typecheck
   pnpm --filter agora-agent-client-toolkit typecheck:interop
   pnpm test
   pnpm --filter agora-conversational-ai-playground backend:setup
   pnpm --filter agora-conversational-ai-playground build
   pnpm --filter agora-conversational-ai-playground test
   ```

### Publish from a tag

After the release PR is merged and the `main` CI run succeeds, tag that exact
commit and push the tag:

```bash
git switch main
git pull --ff-only origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Use the `vX.Y.Z` convention and do not move or reuse a release tag. The workflow
currently runs for every pushed tag, not only tags beginning with `v`.

The tag workflow reruns the Node matrix and Playground gate. After both pass,
the publish job:

- verifies that the core and React versions match;
- builds and packs both packages;
- publishes each package publicly to npm with provenance;
- skips a package when that exact version already exists; and
- creates a GitHub Release with generated notes for the pushed tag.

The `workflow_dispatch` path publishes only when `publish_packages` is set to
`true`. It does not create a GitHub Release, so reserve it for deliberate
publish recovery rather than the normal release path.

### Verify the release

Confirm the workflow succeeded, the GitHub Release exists, and npm's `latest`
tag resolves to the new version for both packages:

```bash
gh release view vX.Y.Z
npm view agora-agent-client-toolkit version dist-tags --json
npm view agora-agent-client-toolkit-react version dist-tags --json
```

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected vs actual behavior
- SDK version and environment (browser, Node.js version)
