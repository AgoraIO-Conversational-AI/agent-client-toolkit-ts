import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgoraVoiceAI } from '../../../src/core/conversational-ai';
import { AgoraVoiceAIEvents } from '../../../src/core/events';
import { ConversationalAIError, NotFoundError } from '../../../src/core/types';

// Minimal RTC client mock — only the methods AgoraVoiceAI calls
function makeRtcClient() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  };
}

describe('AgoraVoiceAI lifecycle', () => {
  // Ensure singleton is cleared between tests
  afterEach(async () => {
    try {
      AgoraVoiceAI.getInstance().destroy();
    } catch {
      // already destroyed / never initialized — fine
    }
  });

  it('getInstance() throws NotFoundError before init()', () => {
    expect(() => AgoraVoiceAI.getInstance()).toThrow(NotFoundError);
  });

  it('init() resolves to an AgoraVoiceAI instance', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    expect(ai).toBeInstanceOf(AgoraVoiceAI);
  });

  it('getInstance() returns the same instance after init()', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    expect(AgoraVoiceAI.getInstance()).toBe(ai);
  });

  it('subscribeMessage() binds RTC events on the client', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    ai.subscribeMessage('test-channel');
    expect(rtcClient.on).toHaveBeenCalled();
  });

  it('sendText() without rtmEngine throws with a descriptive message', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    await expect(
      ai.sendText('agent-uid', { messageType: 0, priority: 0, responseInterruptable: true, text: 'hi' } as never)
    ).rejects.toThrow('requires RTM');
  });

  it('interrupt() without rtmEngine throws with a descriptive message', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    await expect(ai.interrupt('agent-uid')).rejects.toThrow('requires RTM');
  });

  it('on() + emit() — TRANSCRIPT_UPDATED event reaches subscriber', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handler);
    ai.emit(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, [] as never);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('off() removes the event listener', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handler);
    ai.off(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handler);
    ai.emit(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, [] as never);
    expect(handler).not.toHaveBeenCalled();
  });

  it('destroy() resets the singleton — getInstance() throws again', async () => {
    const rtcClient = makeRtcClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    ai.destroy();
    expect(() => AgoraVoiceAI.getInstance()).toThrow(NotFoundError);
  });

  it('init() after destroy() creates a fresh instance', async () => {
    const rtcClient = makeRtcClient();
    const ai1 = await AgoraVoiceAI.init({
      rtcEngine: rtcClient as never,
    });
    ai1.destroy();

    const rtcClient2 = makeRtcClient();
    const ai2 = await AgoraVoiceAI.init({
      rtcEngine: rtcClient2 as never,
    });
    expect(ai2).toBeInstanceOf(AgoraVoiceAI);
    expect(AgoraVoiceAI.getInstance()).toBe(ai2);
  });

  it('init() throws a descriptive error when rtcEngine.on is missing', async () => {
    await expect(
      AgoraVoiceAI.init({
        rtcEngine: { off: vi.fn() } as never,
      })
    ).rejects.toThrow(ConversationalAIError);
    await expect(
      AgoraVoiceAI.init({
        rtcEngine: { off: vi.fn() } as never,
      })
    ).rejects.toThrow('rtcEngine.on(eventName, listener)');
  });

  it('init() throws a descriptive error when rtmEngine.publish is missing', async () => {
    const rtcClient = makeRtcClient();
    await expect(
      AgoraVoiceAI.init({
        rtcEngine: rtcClient as never,
        rtmEngine: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as never,
      })
    ).rejects.toThrow(ConversationalAIError);
    await expect(
      AgoraVoiceAI.init({
        rtcEngine: rtcClient as never,
        rtmEngine: {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        } as never,
      })
    ).rejects.toThrow('rtmEngine.publish(channelName, message, options?)');
  });
});
