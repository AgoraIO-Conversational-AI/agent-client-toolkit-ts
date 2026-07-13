# Migration Guide

Use this file for all version-to-version upgrade steps.

## Version index

- [1.2.x -> 2.9.0](#12x---290)
- [1.1.x -> 1.2.0](#11x---120)

---

## 1.2.x -> 2.9.0

### TL;DR

1. Upgrade the core package:

```bash
pnpm add agora-agent-client-toolkit@2.9.0
```

2. React applications must keep the wrapper and core package on the same version:

```bash
pnpm add agora-agent-client-toolkit-react@2.9.0 agora-agent-client-toolkit@2.9.0
```

3. Register event handlers and call `subscribeMessage(channel)` before starting the agent through the REST API.
4. Provide `rtmConfig` when using RTM-backed controls or result events.
5. Ensure local Node.js is `20+`.

Existing RTC-only transcript integrations do not require a configuration change. The new RTM-backed APIs and events are optional.

### What changed

- Added manual turn controls: `manualSOS(agentUserId, requestId?)` and `manualEOS(agentUserId, requestId?)`.
- Added manual turn result events: `USER_MANUAL_SOS`, `USER_MANUAL_EOS`, and `AGENT_MANUAL_EOS`.
- Added the `AGENT_TURN_FINISHED` event.
- Added React hook and context accessors for `manualSOS(...)` and `manualEOS(...)`.

### Subscribe before agent startup

Subscribe after initializing the toolkit and before sending the agent `/join` request. This prevents early transcript, state, or manual-turn result events from being missed.

```ts
const ai = await AgoraVoiceAI.init({
  rtcEngine: rtcClient,
  rtmConfig: { rtmEngine: rtmClient },
});

ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handleTranscript);
ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handleAgentState);
ai.subscribeMessage(channel);

await startAgent();
```

### RTM-backed methods and result events

The following methods require `rtmConfig` and throw `RTMRequiredError` when it is omitted:

- `sendText(...)`
- `sendImage(...)`
- `interrupt(...)`
- `manualSOS(...)`
- `manualEOS(...)`

`manualSOS()` and `manualEOS()` resolve with the request ID after RTM publish succeeds. This is not the final server result. Handle `USER_MANUAL_SOS`, `USER_MANUAL_EOS`, and `AGENT_MANUAL_EOS` for server validation and automatic EOS notifications.

When these RTM events are needed, keep `advanced_features.enable_rtm: true` and `parameters.data_channel: "rtm"` in the Agent start request. Manual SOS/EOS requests are validated against the Agent's active turn-detection mode, and rejected requests are reported through the result events.

### Post-upgrade checks

Run your application's normal type check, build, and test commands. For example:

```bash
pnpm exec tsc --noEmit
pnpm run build
pnpm test
```

---

## 1.1.x -> 1.2.0

### TL;DR

1. Upgrade packages:

```bash
pnpm add agora-agent-client-toolkit@^1.2.0
pnpm add agora-agent-client-toolkit-react@^1.2.0
```

2. Remove old `as unknown as` init casts.
3. Keep passing your normal Agora RTC/RTM clients directly.
4. Ensure local Node.js is `20+`.

### What changed

- `rtcEngine` and `rtmEngine` now use toolkit-owned structural interfaces (`RTCEngine`, `RTMEngine`).
- `AgoraVoiceAI.init()` accepts compatible engine shapes without peer-path type coupling.
- Development-time validation now checks required engine methods and fails fast for invalid wrappers/mocks.

### Update examples

Before (`1.1.x`):

```ts
import type { IAgoraRTCClient, RTMConfig } from 'agora-agent-client-toolkit';

await AgoraVoiceAI.init({
  rtcEngine: rtcClient as unknown as IAgoraRTCClient,
  rtmConfig: {
    rtmEngine: rtmClient as unknown as RTMConfig['rtmEngine'],
  },
});
```

After (`1.2.0`):

```ts
await AgoraVoiceAI.init({
  rtcEngine: rtcClient,
  rtmConfig: { rtmEngine: rtmClient },
});
```

### RTC-only mode

No change. RTM remains optional:

```ts
await AgoraVoiceAI.init({ rtcEngine: rtcClient });
```

`sendText`, `sendImage`, and `interrupt` still require RTM and throw `RTMRequiredError` when `rtmConfig` is omitted.

### If you use custom wrappers/mocks

Required methods:

- RTC: `on`, `off`
- RTM: `publish`, `addEventListener`, `removeEventListener`

### Post-upgrade checks

Run your application's normal type check, build, and test commands. For example:

```bash
pnpm exec tsc --noEmit
pnpm run build
pnpm test
```
