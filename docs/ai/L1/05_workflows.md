# 05 Workflows

> Step-by-step guides for common development tasks in the toolkit.

## Add a New Event Type

1. Define the event name in `src/core/events.ts` — add to `AgoraVoiceAIEvents` enum
2. Add the handler signature to `AgoraVoiceAIEventHandlers` in `src/core/types.ts`
3. Add the payload type to `src/core/types.ts`
4. Emit the event in the appropriate handler in `src/core/conversational-ai.ts`
5. Export any new types from `src/index.ts`
6. If the event should be exposed in React, add a standalone hook in `packages/react/src/`
7. Add tests in `packages/conversational-ai/__tests__/`

## Add a New Config Option

1. Add the field to `AgoraVoiceAIConfig` in `src/core/config.ts`
2. Read it in `AgoraVoiceAI.init()` in `src/core/conversational-ai.ts`
3. If React-specific, extend `UseConversationalAIConfig` in `packages/react/src/use-conversational-ai.ts`
4. Document the option in README.md
5. Add the type export to `src/index.ts` if a new type was created

## Add a React Hook

1. Create `packages/react/src/use-{name}.ts`
2. Subscribe to the relevant `AgoraVoiceAI` event using `EventHelper.on()`
3. Return typed state via React `useState`
4. Export from `packages/react/src/index.ts`
5. If it should work standalone (outside `useConversationalAI`), add context support in `packages/react/src/context.ts`
6. Add tests in `packages/react/__tests__/`

## Modify Message Parsing

1. Edit `src/messaging/chunked.ts` — `ChunkedMessageAssembler.assemble()`
2. Update wire format handling if message structure changed
3. Run `pnpm test` — chunked tests cover edge cases extensively
4. If the parsed object shape changed, update types in `src/core/types.ts`

## Run Tests

```bash
pnpm test                              # all tests
pnpm --filter conversational-ai test   # core tests only
pnpm --filter react test               # react tests only
```

## Build and Verify

```bash
pnpm build           # build all packages
pnpm typecheck       # verify type correctness
pnpm lint            # check code quality
pnpm format:check    # verify formatting
```

## Release a New Version

1. Update version in `packages/conversational-ai/package.json` and `packages/react/package.json`
2. Update `CHANGELOG.md` with changes
3. Update `MIGRATION.md` if there are breaking changes
4. Commit and tag: `git tag v{version}`
5. Push tag — CI publishes to npm automatically
6. CI creates GitHub Release with auto-generated notes

## Add a Demo or Example

1. Create directory under `apps/` or add to existing demo
2. Add to `pnpm-workspace.yaml` if a new workspace
3. Install peer deps: `agora-rtc-sdk-ng`, `agora-rtm` (optional)
4. Reference core package via workspace protocol in `package.json`

## Deprecate a Public API

1. Add `@deprecated` JSDoc tag to the export in `src/core/types.ts` or relevant file
2. Create a replacement API if applicable
3. Re-export the deprecated symbol with the tag (do not remove yet)
4. Document in `MIGRATION.md` with version and replacement instructions
5. Remove the deprecated symbol in the next major version

## Debug a Transcript Rendering Issue

1. Enable debug logging: `enableLog: true` in config
2. Check which render mode is active — `AUTO` infers from first message
3. If WORD mode, verify `AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true)` was called before client creation
4. Check browser console for `DEBUG_LOG` events
5. Look for `turn_status` transitions: 0 (IN_PROGRESS) → 1 (END) or 2 (INTERRUPTED)
6. If transcript is incomplete, check `ChunkedMessageAssembler` TTL (30s default) — slow networks may cause eviction

## Related Deep Dives

- [Build Pipeline](L2/build_pipeline.md) — Publish workflow, dual CJS/ESM output
- [Rendering Controller](L2/rendering_controller.md) — Transcript mode debugging
