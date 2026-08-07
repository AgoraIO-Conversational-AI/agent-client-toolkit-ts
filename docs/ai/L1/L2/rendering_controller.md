# Rendering Controller

> **When to Read This:** Load this document when modifying transcript rendering logic, debugging transcript display issues, or working with PTS-based word timing.

## Overview

The rendering controller (`CovSubRenderController`) processes incoming RTC stream messages and RTM presence events to produce a coherent transcript. It supports three rendering modes plus auto-detection.

## Rendering Modes

| Mode    | How It Works                                              | Use Case                      |
| ------- | --------------------------------------------------------- | ----------------------------- |
| `TEXT`  | Full text replacement per message                         | Simple, low-latency display   |
| `WORD`  | Individual words timed to audio PTS                       | Lip-sync, karaoke-style       |
| `CHUNK` | Streaming chunks assembled incrementally                  | Typewriter effect              |
| `AUTO`  | Detects mode from first agent message; becomes one of above | Default — most apps use this |

## Architecture

```
RTC stream-message
    │
    ▼
CovSubRenderController.handleMessage(uid, data)
    │
    ├── TEXT mode: replaces current turn text
    ├── WORD mode: queues words, releases via PTS timing
    └── CHUNK mode: appends chunks to current turn
    │
    ▼
SubRenderQueue.push(message)
    │ manages chat history array
    │ handles turn boundaries (turn_id, turn_status)
    │ deduplicates by turn_seq_id
    ▼
emit TRANSCRIPT_UPDATED (full history array)
```

## SubRenderQueue

- Maintains the complete conversation history as an ordered array
- Handles turn lifecycle: IN_PROGRESS → END → INTERRUPTED
- Deduplicates messages by `turn_seq_id` within a turn
- Manages both user and agent transcriptions
- Emits full history on every change (not incremental diffs)

## SubRenderPTS (WORD Mode)

- Receives PTS (Presentation Timestamp) values from RTC `audio-pts` events
- Releases individual words when their `start_ms` matches current PTS
- Words have `stable` flag — unstable words may be revised by later messages
- Requires `AgoraRTC.setParameter('ENABLE_AUDIO_PTS_METADATA', true)` before client creation

## Critical Constraints

- These files are intentionally large (~740, ~570, ~100 lines); do not split without architectural justification
- Silent failures in production — rendering bugs may not throw errors but produce incorrect transcripts
- Queue ordering is sensitive to network jitter; the queue system handles out-of-order messages
- PTS timing depends on audio stream continuity; gaps in audio cause word release delays

## Turn Status Values

| Value | Name          | Meaning                                 |
| ----- | ------------- | --------------------------------------- |
| 0     | IN_PROGRESS   | Agent or user still speaking            |
| 1     | END           | Turn completed normally                 |
| 2     | INTERRUPTED   | Turn interrupted by user or system      |

## See Also

- [Back to Architecture](../02_architecture.md)
- [Back to Gotchas](../07_gotchas.md)
