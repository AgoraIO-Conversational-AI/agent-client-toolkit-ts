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
