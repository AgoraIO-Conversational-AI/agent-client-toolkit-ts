# 08 Security

> Security model, trust boundaries, credential handling, and input validation for the toolkit.

## Trust Boundaries

```
┌─────────────────────────────────────┐
│  User Application (trusted)         │
│  - Holds Agora App ID and Token     │
│  - Creates RTC/RTM engine instances │
│  - Passes engines to toolkit        │
└──────────────┬──────────────────────┘
               │ structural contract
┌──────────────▼──────────────────────┐
│  Toolkit (this library)             │
│  - Never stores credentials         │
│  - Validates engine shape (dev only)│
│  - Processes messages from RTC/RTM  │
└──────────────┬──────────────────────┘
               │ peer SDK calls
┌──────────────▼──────────────────────┐
│  Agora Peer SDKs (external)         │
│  - RTC: audio streaming, PTS        │
│  - RTM: messaging, presence         │
│  - Handle network transport + auth  │
└─────────────────────────────────────┘
```

## Credential Handling

- **The toolkit never handles credentials directly** — it receives pre-initialized engine instances
- Agora App ID, tokens, and channel names are the application's responsibility
- No `.env` files, no secret storage, no token generation in this library
- Token refresh is handled by the application and the peer SDKs

## Input Validation

- **Engine validation** — `AgoraVoiceAI.init()` validates that passed engines have required methods (dev mode only)
- **Chunked message validation** — `ChunkedMessageAssembler` validates:
  - Part index bounds (rejects `part_idx < 1`)
  - NaN checks on numeric fields
  - Deduplication by part index
  - TTL-based eviction (30s) for incomplete messages
  - Cache size cap (1000) to prevent unbounded growth
- **No user input sanitization** — the toolkit processes messages from Agora infrastructure, not direct user input

## Vulnerability Reporting

- Security issues reported via GitHub private advisory (see `SECURITY.md`)
- Scope: credentials handling, token patterns, SDK integration security
- Response timeline: 48h acknowledgment, 7d resolution target

## Dependency Security

- **Zero runtime dependencies** — core package has no `dependencies` field
- **Peer dependencies** — version-pinned minimums:
  - `agora-rtc-sdk-ng` ≥4.23.4
  - `agora-rtm` ≥2.0.0 (optional)
- **Optional dependencies** — dynamically imported with try/catch:
  - `@agora-js/report` ≥4.19.0
  - `jszip` ≥3.0.0
- **npm provenance** — CI publishes with `--provenance` flag for supply chain verification

## Message Trust Model

- RTC stream messages are received from Agora infrastructure (not directly from other users)
- RTM messages are published via Agora's authenticated channels
- The toolkit trusts message content from these channels — it does not re-validate or sanitize payloads
- Message integrity is the responsibility of Agora's transport layer

## Safe Defaults

- Logging disabled by default (`enableLog: false`)
- Metrics reporting disabled by default (`enableAgoraMetrics: false`)
- RTM disabled by default (RTC-only mode)
- No automatic network requests beyond what peer SDKs initiate

## Related Deep Dives

- None
