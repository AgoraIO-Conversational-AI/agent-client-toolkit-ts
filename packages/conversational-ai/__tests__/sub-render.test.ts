import { afterEach, describe, expect, it, vi } from 'vitest';
import { CovSubRenderController } from '../../../src/rendering/sub-render';
import {
  MessageType,
  TranscriptHelperMode,
  TurnStatus,
  type AgentTranscription,
} from '../../../src/core/types';

function createAgentTranscription(
  turnId: number,
  text: string,
  words: AgentTranscription['words']
): AgentTranscription {
  return {
    object: MessageType.AGENT_TRANSCRIPTION,
    text,
    start_ms: 0,
    duration_ms: 0,
    language: 'en-US',
    turn_id: turnId,
    stream_id: 0,
    user_id: 'agent',
    words,
    quiet: false,
    turn_seq_id: turnId,
    turn_status: TurnStatus.END,
  };
}

describe('CovSubRenderController render-mode fallback', () => {
  const controllers: CovSubRenderController[] = [];

  afterEach(() => {
    controllers.forEach((controller) => controller.cleanup());
    vi.useRealTimers();
  });

  it('falls back from WORD to TEXT when word timing data is missing', () => {
    const onChatHistoryUpdated = vi.fn();
    const controller = new CovSubRenderController({ onChatHistoryUpdated });
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD, { enableRenderModeFallback: true });
    controller.run();

    controller.handleMessage(createAgentTranscription(1, 'plain text', null), {
      publisher: 'agent',
    });
    controller.handleMessage(
      createAgentTranscription(2, 'timed text', [
        { word: 'timed', start_ms: 1000, duration_ms: 100, stable: true },
      ]),
      { publisher: 'agent' }
    );

    expect(controller.chatHistory.map((item) => item.text)).toEqual(['plain text', 'timed text']);
    expect(onChatHistoryUpdated).toHaveBeenCalledTimes(2);
  });

  it('enables render-mode fallback by default', () => {
    const controller = new CovSubRenderController();
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD);
    controller.run();

    controller.handleMessage(createAgentTranscription(1, 'plain text', null), {
      publisher: 'agent',
    });

    expect(controller.chatHistory.map((item) => item.text)).toEqual(['plain text']);
  });

  it('preserves only rendered WORD text when falling back to TEXT', () => {
    vi.useFakeTimers();
    const controller = new CovSubRenderController();
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD, { enableRenderModeFallback: true });
    controller.run();
    controller.setPts(200);

    controller.handleMessage(
      createAgentTranscription(1, 'hello', [
        { word: 'h', start_ms: 100, duration_ms: 100, stable: true },
        { word: 'e', start_ms: 200, duration_ms: 100, stable: true },
        { word: 'l', start_ms: 300, duration_ms: 100, stable: true },
        { word: 'l', start_ms: 400, duration_ms: 100, stable: true },
        { word: 'o', start_ms: 500, duration_ms: 100, stable: true },
      ]),
      { publisher: 'agent' }
    );
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('he');

    controller.handleMessage(createAgentTranscription(2, 'plain text', null), {
      publisher: 'agent',
    });

    expect(controller.chatHistory.map((item) => item.text)).toEqual(['he', 'plain text']);
  });

  it('does not restore unplayed text for an interrupted WORD turn', () => {
    vi.useFakeTimers();
    const controller = new CovSubRenderController();
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD, { enableRenderModeFallback: true });
    controller.run();
    controller.setPts(200);

    controller.handleMessage(
      createAgentTranscription(1, 'hello', [
        { word: 'h', start_ms: 100, duration_ms: 100, stable: true },
        { word: 'e', start_ms: 200, duration_ms: 100, stable: true },
        { word: 'l', start_ms: 300, duration_ms: 100, stable: true },
        { word: 'l', start_ms: 400, duration_ms: 100, stable: true },
        { word: 'o', start_ms: 500, duration_ms: 100, stable: true },
      ]),
      { publisher: 'agent' }
    );
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('he');

    controller.handleMessage(
      {
        object: MessageType.MSG_INTERRUPTED,
        message_id: 'interrupt-1',
        data_type: 'message',
        turn_id: 1,
        start_ms: 200,
        send_ts: 200,
      },
      { publisher: 'agent' }
    );
    controller.handleMessage(createAgentTranscription(2, 'plain text', null), {
      publisher: 'agent',
    });

    expect(controller.chatHistory[0]?.text).toBe('he');
  });

  // -------------------------------------------------------------------------
  // word-same-timestamp-dedup-fix: I1–I3 (in-progress messages, relative start_ms)
  // -------------------------------------------------------------------------
  function wordMessage(turnId: number, labels: string[]): AgentTranscription {
    return {
      ...createAgentTranscription(
        turnId,
        '',
        labels.map((label) => {
          const at = label.lastIndexOf('@');
          const raw = label.slice(0, at);
          return {
            word: raw === '␠' ? ' ' : raw,
            start_ms: Number(label.slice(at + 1)),
            duration_ms: 0,
            stable: true,
          };
        })
      ),
      turn_status: TurnStatus.IN_PROGRESS,
    };
  }

  function createWordController() {
    vi.useFakeTimers();
    const controller = new CovSubRenderController();
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD, { enableRenderModeFallback: true });
    controller.run();
    return controller;
  }

  it('I1: Cartesia playback keeps different@6984 across messages', () => {
    const controller = createWordController();
    controller.setPts(7400);
    const k = ['try@6744', '␠@6902', 'a@6984'];
    const m1 = ['try@6744', '␠@6902', 'a@6984', '␠@6983', 'different@6984'];
    const m2 = ['␠@6902', 'a@6984', '␠@6983', 'different@6984', '␠@7222', 'one.@7304'];
    controller.handleMessage(wordMessage(1, k), { publisher: 'agent' });
    controller.handleMessage(wordMessage(1, m1), { publisher: 'agent' });
    controller.handleMessage(wordMessage(1, m2), { publisher: 'agent' });
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('try  adifferent one.');
  });

  it('I2: Chinese first message keeps both 团', () => {
    const controller = createWordController();
    controller.setPts(7700);
    controller.handleMessage(
      wordMessage(1, ['想@6932', '～@7195', '团@7195', '团@7413', '昨@7686']),
      { publisher: 'agent' }
    );
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('想～团团昨');
  });

  it('I3: words arriving after an interrupt keep the interrupt point', () => {
    const controller = createWordController();
    controller.setPts(6990);
    controller.handleMessage(wordMessage(1, ['try@6744', '␠@6902', 'a@6984']), {
      publisher: 'agent',
    });
    vi.advanceTimersByTime(200);

    controller.handleMessage(
      {
        object: MessageType.MSG_INTERRUPTED,
        message_id: 'interrupt-i3',
        data_type: 'message',
        turn_id: 1,
        start_ms: 6984,
        send_ts: 6984,
      },
      { publisher: 'agent' }
    );
    controller.handleMessage(
      wordMessage(1, ['␠@6902', 'a@6984', '␠@6983', 'different@6984', '␠@7222', 'one.@7304']),
      { publisher: 'agent' }
    );
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('try  adifferent');
    expect(controller.chatHistory[0]?.status).toBe(TurnStatus.INTERRUPTED);

    controller.setPts(7400);
    vi.advanceTimersByTime(200);
    expect(controller.chatHistory[0]?.text).toBe('try  adifferent');
  });

  it('keeps WORD mode when render-mode fallback is disabled', () => {
    const controller = new CovSubRenderController();
    controllers.push(controller);
    controller.setMode(TranscriptHelperMode.WORD, { enableRenderModeFallback: false });
    controller.run();

    controller.handleMessage(createAgentTranscription(1, 'plain text', null), {
      publisher: 'agent',
    });

    expect(controller.chatHistory).toEqual([]);
  });
});
