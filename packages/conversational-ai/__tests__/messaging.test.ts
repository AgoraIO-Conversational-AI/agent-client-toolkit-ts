import { describe, it, expect, afterEach } from 'vitest';
import { AgoraVoiceAI } from '../../../src/core/conversational-ai';
import {
  ChatMessageType,
  ChatMessagePriority,
  ThinkListeningAction,
  ThinkSpeakingAction,
  ThinkThinkingAction,
  RTMRequiredError,
  ConversationalAIError,
} from '../../../src/core/types';
import { createMockRTCClient, createMockRTMClient } from './helpers/mocks';

describe('AgoraVoiceAI messaging', () => {
  afterEach(() => {
    try {
      AgoraVoiceAI.getInstance().destroy();
    } catch {
      /* ok */
    }
  });

  it('sendText() with valid RTM config calls rtmEngine.publish()', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.sendText('agent-uid', {
      messageType: ChatMessageType.TEXT,
      priority: ChatMessagePriority.INTERRUPTED,
      responseInterruptable: true,
      text: 'hello',
    });

    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId, payload] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
    const parsed = JSON.parse(payload as string);
    expect(parsed.message).toBe('hello');
  });

  it('sendText() without RTM config throws RTMRequiredError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(
      ai.sendText('agent-uid', {
        messageType: ChatMessageType.TEXT,
        priority: ChatMessagePriority.INTERRUPTED,
        responseInterruptable: true,
        text: 'hello',
      })
    ).rejects.toThrow(RTMRequiredError);
  });

  it('sendImage() with URL publishes correct payload structure', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.sendImage('agent-uid', {
      messageType: ChatMessageType.IMAGE,
      uuid: 'img-123',
      url: 'https://example.com/image.png',
    });

    expect(rtm.publish).toHaveBeenCalledOnce();
    const [, payload] = rtm.publish.mock.calls[0];
    const parsed = JSON.parse(payload as string);
    expect(parsed.uuid).toBe('img-123');
    expect(parsed.image_url).toBe('https://example.com/image.png');
  });

  it('speak() publishes documented defaults to the agent user', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.speak('agent-uid', { text: 'hello' });

    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId, payload, options] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
    expect(JSON.parse(payload as string)).toEqual({
      priority: 'INTERRUPT',
      interruptable: true,
      message: 'hello',
    });
    expect(options).toEqual({
      channelType: 'USER',
      customType: 'assistant.transcription',
    });
  });

  it.each([
    [ChatMessagePriority.INTERRUPTED, 'INTERRUPT'],
    [ChatMessagePriority.APPEND, 'APPEND'],
    [ChatMessagePriority.IGNORE, 'IGNORE'],
  ])('speak() serializes priority %s as %s', async (priority, expectedPriority) => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.speak('agent-uid', {
      text: 'hello',
      priority,
      interruptable: false,
    });

    const [, payload] = rtm.publish.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      priority: expectedPriority,
      interruptable: false,
      message: 'hello',
    });
  });

  it('speak() without RTM config throws RTMRequiredError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(ai.speak('agent-uid', { text: 'hello' })).rejects.toThrow(RTMRequiredError);
  });

  it('think() publishes documented defaults and omits metadata', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.think('agent-uid', { text: 'one plus one' });

    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId, payload, options] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
    expect(JSON.parse(payload as string)).toEqual({
      message: 'one plus one',
      on_listening_action: 'interrupt',
      on_thinking_action: 'ignore',
      on_speaking_action: 'ignore',
      interruptable: true,
    });
    expect(options).toEqual({
      channelType: 'USER',
      customType: 'user.transcription',
    });
  });

  it('think() serializes metadata and interruptable', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.think('agent-uid', {
      text: 'one plus one',
      interruptable: false,
      metadata: { requestId: 'request-001', source: 'web-demo' },
    });

    const [, payload] = rtm.publish.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({
      message: 'one plus one',
      on_listening_action: 'interrupt',
      on_thinking_action: 'ignore',
      on_speaking_action: 'ignore',
      interruptable: false,
      metadata: { requestId: 'request-001', source: 'web-demo' },
    });
  });

  it.each(Object.values(ThinkListeningAction))(
    'think() serializes listening action %s',
    async (onListeningAction) => {
      const rtc = createMockRTCClient();
      const rtm = createMockRTMClient();
      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtc as never,
        rtmEngine: rtm as never,
      });

      await ai.think('agent-uid', { text: 'hello', onListeningAction });

      const [, payload] = rtm.publish.mock.calls[0];
      expect(JSON.parse(payload as string).on_listening_action).toBe(onListeningAction);
    }
  );

  it.each(Object.values(ThinkThinkingAction))(
    'think() serializes thinking action %s',
    async (onThinkingAction) => {
      const rtc = createMockRTCClient();
      const rtm = createMockRTMClient();
      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtc as never,
        rtmEngine: rtm as never,
      });

      await ai.think('agent-uid', { text: 'hello', onThinkingAction });

      const [, payload] = rtm.publish.mock.calls[0];
      expect(JSON.parse(payload as string).on_thinking_action).toBe(onThinkingAction);
    }
  );

  it.each(Object.values(ThinkSpeakingAction))(
    'think() serializes speaking action %s',
    async (onSpeakingAction) => {
      const rtc = createMockRTCClient();
      const rtm = createMockRTMClient();
      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtc as never,
        rtmEngine: rtm as never,
      });

      await ai.think('agent-uid', { text: 'hello', onSpeakingAction });

      const [, payload] = rtm.publish.mock.calls[0];
      expect(JSON.parse(payload as string).on_speaking_action).toBe(onSpeakingAction);
    }
  );

  it('think() without RTM config throws RTMRequiredError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(ai.think('agent-uid', { text: 'hello' })).rejects.toThrow(RTMRequiredError);
  });

  it('interrupt() with valid RTM publishes interrupt payload', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.interrupt('agent-uid');

    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
  });

  it('interrupt() without RTM throws RTMRequiredError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(ai.interrupt('agent-uid')).rejects.toThrow(RTMRequiredError);
  });

  it('manualSOS() publishes request ID with manual SOS custom type', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    const requestId = await ai.manualSOS('agent-uid', 'sos-req-001');

    expect(requestId).toBe('sos-req-001');
    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId, payload, options] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
    expect(JSON.parse(payload as string)).toEqual({ request_id: 'sos-req-001' });
    expect(options).toEqual({ channelType: 'USER', customType: 'user.manual_sos' });
  });

  it('manualEOS() publishes request ID with manual EOS custom type', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    const requestId = await ai.manualEOS('agent-uid', 'eos-req-001');

    expect(requestId).toBe('eos-req-001');
    expect(rtm.publish).toHaveBeenCalledOnce();
    const [userId, payload, options] = rtm.publish.mock.calls[0];
    expect(userId).toBe('agent-uid');
    expect(JSON.parse(payload as string)).toEqual({ request_id: 'eos-req-001' });
    expect(options).toEqual({ channelType: 'USER', customType: 'user.manual_eos' });
  });

  it('manualSOS() generates a request ID when omitted', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    const requestId = await ai.manualSOS('agent-uid');

    expect(requestId).toMatch(/^sos-req-\d+-[a-z0-9]{8}$/);
    const [, payload] = rtm.publish.mock.calls[0];
    expect(JSON.parse(payload as string)).toEqual({ request_id: requestId });
  });

  it('manualEOS() rejects empty request ID before publishing', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await expect(ai.manualEOS('agent-uid', '')).rejects.toThrow(ConversationalAIError);
    expect(rtm.publish).not.toHaveBeenCalled();
  });

  it('manualSOS() without RTM throws RTMRequiredError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(ai.manualSOS('agent-uid')).rejects.toThrow(RTMRequiredError);
  });

  it('chat() with TEXT type dispatches to sendText()', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.chat('agent-uid', {
      messageType: ChatMessageType.TEXT,
      priority: ChatMessagePriority.INTERRUPTED,
      responseInterruptable: true,
      text: 'test message',
    });

    expect(rtm.publish).toHaveBeenCalledOnce();
  });

  it('chat() with IMAGE type dispatches to sendImage()', async () => {
    const rtc = createMockRTCClient();
    const rtm = createMockRTMClient();
    const ai = await AgoraVoiceAI.init({
      rtcEngine: rtc as never,
      rtmEngine: rtm as never,
    });

    await ai.chat('agent-uid', {
      messageType: ChatMessageType.IMAGE,
      uuid: 'img-456',
      url: 'https://example.com/img.jpg',
    });

    expect(rtm.publish).toHaveBeenCalledOnce();
  });

  it('chat() with unknown type throws ConversationalAIError', async () => {
    const rtc = createMockRTCClient();
    const ai = await AgoraVoiceAI.init({ rtcEngine: rtc as never });

    await expect(
      ai.chat('agent-uid', { messageType: 'unknown' as never } as never)
    ).rejects.toThrow(ConversationalAIError);
  });
});
