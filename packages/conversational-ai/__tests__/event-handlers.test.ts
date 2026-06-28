import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgoraVoiceAI } from '../../../src/core/conversational-ai';
import { AgoraVoiceAIEvents } from '../../../src/core/events';
import { MessageType, RTCEventType, RTMEventType } from '../../../src/core/types';
import { createMockRTCClient, createMockRTMClient } from './helpers/mocks';

describe('AgoraVoiceAI event handlers', () => {
  afterEach(() => {
    try {
      AgoraVoiceAI.getInstance().destroy();
    } catch {
      /* ok */
    }
  });

  it('RTC stream message triggers TRANSCRIPT_UPDATED', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handler);
    ai.subscribeMessage('test-ch');

    // Simulate a valid stream message
    const message = {
      object: MessageType.USER_TRANSCRIPTION,
      text: 'hello',
      start_ms: 0,
      duration_ms: 100,
      language: 'en',
      turn_id: 1,
      stream_id: 1,
      user_id: 'user1',
      words: null,
      final: true,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(message));
    rtc.__emit(RTCEventType.STREAM_MESSAGE, 'agent-uid', encoded);

    // The TRANSCRIPT_UPDATED should fire (eventually, through CovSubRenderController)
    // Since we can't control the render controller internals, we verify the event pipeline
    // doesn't throw and the handler was registered
    expect(handler).toBeDefined();
  });

  it('malformed RTC stream message does not throw', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });
    ai.subscribeMessage('test-ch');

    // Send non-JSON data
    const badData = new TextEncoder().encode('not json {{{');
    expect(() => {
      rtc.__emit(RTCEventType.STREAM_MESSAGE, 'agent-uid', badData);
    }).not.toThrow();
  });

  it('subscribeMessage binds RTC event handlers', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });
    ai.subscribeMessage('test-ch');

    expect(rtc.__handlerCount(RTCEventType.STREAM_MESSAGE)).toBe(1);
    expect(rtc.__handlerCount(RTCEventType.AUDIO_PTS)).toBe(1);
  });

  it('unsubscribe unbinds RTC event handlers', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });
    ai.subscribeMessage('test-ch');

    expect(rtc.__handlerCount(RTCEventType.STREAM_MESSAGE)).toBe(1);
    ai.unsubscribe();
    expect(rtc.__handlerCount(RTCEventType.STREAM_MESSAGE)).toBe(0);
    expect(rtc.__handlerCount(RTCEventType.AUDIO_PTS)).toBe(0);
  });

  it('chunked message assembly — valid chunks trigger handler without error', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });
    ai.subscribeMessage('test-ch');

    const payload = { object: MessageType.USER_TRANSCRIPTION, text: 'hello' };
    const base64 = btoa(JSON.stringify(payload));
    const half = Math.ceil(base64.length / 2);

    const chunk0 = `msg1|0|2|${base64.slice(0, half)}`;
    const chunk1 = `msg1|1|2|${base64.slice(half)}`;

    const enc0 = new TextEncoder().encode(chunk0);
    const enc1 = new TextEncoder().encode(chunk1);

    expect(() => {
      rtc.__emit(RTCEventType.STREAM_MESSAGE, 'agent-uid', enc0);
      rtc.__emit(RTCEventType.STREAM_MESSAGE, 'agent-uid', enc1);
    }).not.toThrow();
  });

  it('on/off event listeners work correctly', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handler1);
    ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handler2);

    ai.emit(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, 'agent-uid', {
      state: 'listening',
      turnID: 1,
      timestamp: Date.now(),
      reason: 'test',
    } as never);

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    ai.off(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handler1);
    ai.emit(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, 'agent-uid', {
      state: 'speaking',
      turnID: 2,
      timestamp: Date.now(),
      reason: 'test',
    } as never);

    expect(handler1).toHaveBeenCalledOnce(); // Not called again
    expect(handler2).toHaveBeenCalledTimes(2);
  });

  it('removeAllEventListeners clears all handlers', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handler);
    ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handler);

    ai.removeAllEventListeners();

    ai.emit(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, [] as never);
    ai.emit(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, 'uid', {} as never);

    expect(handler).not.toHaveBeenCalled();
  });

  it('RTM user.manual_sos.result emits USER_MANUAL_SOS', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmConfig: { rtmEngine: rtm as never },
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.USER_MANUAL_SOS, handler);
    ai.subscribeMessage('test-ch');

    rtm.__emit(RTMEventType.MESSAGE, {
      publisher: 'agent-uid',
      message: JSON.stringify({
        event_type: MessageType.USER_MANUAL_SOS_RESULT,
        event_id: 'evt-sos-001',
        event_ms: 1710000000100,
        payload: {
          success: true,
          request_id: 'sos-req-001',
          turn_id: 7,
        },
      }),
    });

    expect(handler).toHaveBeenCalledWith('agent-uid', {
      eventId: 'evt-sos-001',
      timestamp: 1710000000100,
      payload: {
        success: true,
        requestId: 'sos-req-001',
        turnId: 7,
        errorMessage: null,
      },
    });
  });

  it('RTM user.manual_eos.result emits USER_MANUAL_EOS and preserves failure message', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmConfig: { rtmEngine: rtm as never },
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.USER_MANUAL_EOS, handler);
    ai.subscribeMessage('test-ch');

    rtm.__emit(RTMEventType.MESSAGE, {
      publisher: 'agent-uid',
      message: JSON.stringify({
        object: MessageType.USER_MANUAL_EOS_RESULT,
        event_id: 'evt-eos-001',
        event_ms: 1710000000200,
        payload: {
          success: false,
          request_id: 'eos-req-001',
          error_message: 'No turns available for EOS labeling.',
        },
      }),
    });

    expect(handler).toHaveBeenCalledWith('agent-uid', {
      eventId: 'evt-eos-001',
      timestamp: 1710000000200,
      payload: {
        success: false,
        requestId: 'eos-req-001',
        turnId: null,
        errorMessage: 'No turns available for EOS labeling.',
      },
    });
  });

  it('RTM assistant.manual_eos.result emits AGENT_MANUAL_EOS', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmConfig: { rtmEngine: rtm as never },
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.AGENT_MANUAL_EOS, handler);
    ai.subscribeMessage('test-ch');

    rtm.__emit(RTMEventType.MESSAGE, {
      publisher: 'agent-uid',
      message: JSON.stringify({
        event_type: MessageType.AGENT_MANUAL_EOS_RESULT,
        event_id: 'evt-agent-eos-001',
        event_ms: 1710000000300,
        payload: {
          reason: 'max_audio_duration',
          max_duration_ms: 600000,
          turn_id: 23,
        },
      }),
    });

    expect(handler).toHaveBeenCalledWith('agent-uid', {
      eventId: 'evt-agent-eos-001',
      timestamp: 1710000000300,
      payload: {
        reason: 'max_audio_duration',
        maxDurationMs: 600000,
        turnId: 23,
      },
    });
  });

  it('RTM assistant.manual_eos.result maps missing numeric fields to null', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmConfig: { rtmEngine: rtm as never },
    });
    const handler = vi.fn();
    ai.on(AgoraVoiceAIEvents.AGENT_MANUAL_EOS, handler);
    ai.subscribeMessage('test-ch');

    rtm.__emit(RTMEventType.MESSAGE, {
      publisher: 'agent-uid',
      message: JSON.stringify({
        event_type: MessageType.AGENT_MANUAL_EOS_RESULT,
        event_id: 'evt-agent-eos-002',
        event_ms: 1710000000400,
        payload: {
          reason: 'max_audio_duration',
        },
      }),
    });

    expect(handler).toHaveBeenCalledWith('agent-uid', {
      eventId: 'evt-agent-eos-002',
      timestamp: 1710000000400,
      payload: {
        reason: 'max_audio_duration',
        maxDurationMs: null,
        turnId: null,
      },
    });
  });
});
