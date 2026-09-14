import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { useMemo } from 'react';

// --- Mocks ---

const mockOn = vi.fn();
const mockOff = vi.fn();
const mockUnsubscribe = vi.fn();
const mockDestroy = vi.fn();
const mockSubscribeMessage = vi.fn();
const mockInterrupt = vi.fn();
const mockManualSOS = vi.fn();
const mockManualEOS = vi.fn();
const mockSendText = vi.fn();
const mockSpeak = vi.fn();
const mockThink = vi.fn();

let mockInstance: Record<string, unknown>;

function createMockInstance() {
  return {
    on: mockOn,
    off: mockOff,
    unsubscribe: mockUnsubscribe,
    destroy: mockDestroy,
    subscribeMessage: mockSubscribeMessage,
    interrupt: mockInterrupt,
    manualSOS: mockManualSOS,
    manualEOS: mockManualEOS,
    sendText: mockSendText,
    speak: mockSpeak,
    think: mockThink,
  };
}

const mockInit = vi.fn();
const mockGetInstance = vi.fn();
const mockRtcClient = { uid: 'mock-client' };

vi.mock('agora-rtc-react', () => ({
  useRTCClient: () => mockRtcClient,
}));

vi.mock('agora-agent-client-toolkit', () => ({
  AgoraVoiceAI: {
    init: (...args: unknown[]) => mockInit(...args),
    getInstance: (...args: unknown[]) => mockGetInstance(...args),
  },
  AgoraVoiceAIEvents: {
    TRANSCRIPT_UPDATED: 'transcript-updated',
    AGENT_STATE_CHANGED: 'agent-state-changed',
    AGENT_ERROR: 'agent-error',
    AGENT_METRICS: 'agent-metrics',
    MESSAGE_RECEIPT_UPDATED: 'message-receipt-updated',
    AGENT_INTERRUPTED: 'agent-interrupted',
    DEBUG_LOG: 'debug-log',
    MESSAGE_ERROR: 'message-error',
    MESSAGE_SAL_STATUS: 'message-sal-status',
  },
  ChatMessageType: { TEXT: 'text', IMAGE: 'image', UNKNOWN: 'unknown' },
  ChatMessagePriority: { INTERRUPTED: 'interrupted' },
  ModuleType: { UNKNOWN: 'unknown' },
}));

// Import after mocks are set up
import { useConversationalAI } from '../src/use-conversational-ai';
import type { UseConversationalAIConfig } from '../src/use-conversational-ai';

/**
 * Wrapper that stabilizes config via useMemo to avoid triggering the
 * hook's identity-change warning and extra re-renders.
 */
function renderConversationalAI(config: UseConversationalAIConfig) {
  return renderHook(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const stableConfig = useMemo(() => config, [config.channel]);
    return useConversationalAI(stableConfig);
  });
}

describe('useConversationalAI', () => {
  // Track event handlers so we can fire them in tests
  const eventHandlers = new Map<string, Function[]>();

  beforeEach(() => {
    eventHandlers.clear();
    mockInstance = createMockInstance();

    mockOn.mockImplementation((event: string, handler: Function) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    });
    mockOff.mockImplementation((event: string, handler: Function) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    });

    mockInit.mockResolvedValue(mockInstance);
    mockGetInstance.mockReturnValue(mockInstance);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function emitEvent(event: string, ...args: unknown[]) {
    const handlers = eventHandlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }

  // --- Init + cleanup lifecycle ---
  it('calls init with config and rtcEngine, then subscribes to channel', async () => {
    const { unmount } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ channel: 'test-channel' }));
    });
    expect(mockSubscribeMessage).toHaveBeenCalledWith('test-channel');

    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('calls unsubscribe and destroy on unmount', async () => {
    const { unmount } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    unmount();
    expect(mockOff).toHaveBeenCalledWith('transcript-updated', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('agent-state-changed', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('agent-error', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('agent-metrics', expect.any(Function));
    expect(mockOff).toHaveBeenCalledWith('message-receipt-updated', expect.any(Function));
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  // --- StrictMode double-invoke ---
  it('does not destroy a newer instance during StrictMode cleanup', async () => {
    // Use independent spies so we can distinguish calls per instance
    const firstDestroy = vi.fn();
    const firstUnsubscribe = vi.fn();
    const firstInstance = {
      ...createMockInstance(),
      destroy: firstDestroy,
      unsubscribe: firstUnsubscribe,
    };
    const secondDestroy = vi.fn();
    const secondUnsubscribe = vi.fn();
    const secondInstance = {
      ...createMockInstance(),
      destroy: secondDestroy,
      unsubscribe: secondUnsubscribe,
    };

    let initCallCount = 0;
    mockInit.mockImplementation(() => {
      initCallCount++;
      return Promise.resolve(initCallCount === 1 ? firstInstance : secondInstance);
    });

    // When cleanup checks getInstance(), return the second (live) instance
    mockGetInstance.mockReturnValue(secondInstance);

    const { unmount } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled();
    });

    unmount();

    // The key invariant: first instance's unsubscribe and destroy are NOT
    // called because getInstance() returns secondInstance !== firstInstance.
    // Validates that StrictMode cleanup does not destroy a newer singleton.
    expect(firstDestroy).not.toHaveBeenCalled();
    expect(firstUnsubscribe).not.toHaveBeenCalled();
  });

  // --- Event subscription ---
  it('subscribes to all 5 events after init', async () => {
    renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockOn).toHaveBeenCalledWith('transcript-updated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('agent-state-changed', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('agent-error', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('agent-metrics', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('message-receipt-updated', expect.any(Function));
    });
  });

  it('updates transcript state when TRANSCRIPT_UPDATED fires', async () => {
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    const transcriptData = [{ uid: 'u1', text: 'hello', turn_id: 1 }];
    act(() => emitEvent('transcript-updated', transcriptData));
    expect(result.current.transcript).toEqual(transcriptData);
  });

  it('updates agentState when AGENT_STATE_CHANGED fires', async () => {
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    act(() => emitEvent('agent-state-changed', 'agent-uid', { state: 'speaking' }));
    expect(result.current.agentState).toBe('speaking');
  });

  // --- Error state ---
  it('sets error state when init() rejects', async () => {
    mockInit.mockRejectedValue(new Error('RTC client invalid'));

    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error!.message).toContain('RTC client invalid');
    expect(result.current.error!.code).toBe(-1);
  });

  it('sets error state when AGENT_ERROR fires', async () => {
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    const errorPayload = { type: 'llm', code: 500, message: 'LLM failed', timestamp: 123 };
    act(() => emitEvent('agent-error', 'agent-uid', errorPayload));
    expect(result.current.error).toEqual(errorPayload);
  });

  // --- Channel change ---
  it('re-initializes when config.channel changes', async () => {
    const { rerender } = renderHook(
      ({ channel }: { channel: string }) => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        const config = useMemo(() => ({ channel }), [channel]);
        return useConversationalAI(config);
      },
      { initialProps: { channel: 'channel-1' } }
    );

    await waitFor(() => {
      expect(mockInit).toHaveBeenCalled();
      expect(mockSubscribeMessage).toHaveBeenCalledWith('channel-1');
    });

    const initCallsBefore = mockInit.mock.calls.length;

    rerender({ channel: 'channel-2' });

    await waitFor(() => {
      expect(mockInit.mock.calls.length).toBeGreaterThan(initCallsBefore);
    });
    // Cleanup for first channel should have run
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  // --- Cancelled init (unmount before init resolves) ---
  it('does not set state when unmounted before init resolves', async () => {
    let resolveInit!: (val: unknown) => void;
    mockInit.mockReturnValue(
      new Promise((resolve) => {
        resolveInit = resolve;
      })
    );

    const { result, unmount } = renderConversationalAI({ channel: 'test-channel' });

    // Unmount before init resolves
    unmount();

    // Now resolve init
    await act(async () => {
      resolveInit(mockInstance);
    });

    // isConnected should still be false — state was not set
    expect(result.current.isConnected).toBe(false);
    expect(mockSubscribeMessage).not.toHaveBeenCalled();
  });

  // --- Controls ---
  it('exposes interrupt and sendMessage callbacks', async () => {
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    expect(typeof result.current.interrupt).toBe('function');
    expect(typeof result.current.sendMessage).toBe('function');
  });

  it('forwards speak and think messages to the AI instance', async () => {
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    const speakMessage = { text: 'hello' };
    const thinkMessage = { text: 'one plus one' };
    await result.current.speak('agent-uid', speakMessage);
    await result.current.think('agent-uid', thinkMessage);

    expect(mockSpeak).toHaveBeenCalledWith('agent-uid', speakMessage);
    expect(mockThink).toHaveBeenCalledWith('agent-uid', thinkMessage);
  });

  it('speak and think reject before the AI instance is ready', async () => {
    mockInit.mockReturnValue(new Promise(() => undefined));
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await expect(result.current.speak('agent-uid', { text: 'hello' })).rejects.toThrow(
      'not initialized yet'
    );
    await expect(result.current.think('agent-uid', { text: 'hello' })).rejects.toThrow(
      'not initialized yet'
    );
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(mockThink).not.toHaveBeenCalled();
  });

  it('exposes manualSOS and manualEOS callbacks', async () => {
    mockManualSOS.mockResolvedValue('sos-req-001');
    mockManualEOS.mockResolvedValue('eos-req-001');
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await waitFor(() => {
      expect(mockSubscribeMessage).toHaveBeenCalled();
    });

    await expect(result.current.manualSOS('agent-uid', 'sos-req-001')).resolves.toBe('sos-req-001');
    await expect(result.current.manualEOS('agent-uid', 'eos-req-001')).resolves.toBe('eos-req-001');
    expect(mockManualSOS).toHaveBeenCalledWith('agent-uid', 'sos-req-001');
    expect(mockManualEOS).toHaveBeenCalledWith('agent-uid', 'eos-req-001');
  });

  it('manualSOS and manualEOS reject before the AI instance is ready', async () => {
    mockInit.mockReturnValue(new Promise(() => undefined));
    const { result } = renderConversationalAI({ channel: 'test-channel' });

    await expect(result.current.manualSOS('agent-uid')).rejects.toThrow('not initialized yet');
    await expect(result.current.manualEOS('agent-uid')).rejects.toThrow('not initialized yet');
    expect(mockManualSOS).not.toHaveBeenCalled();
    expect(mockManualEOS).not.toHaveBeenCalled();
  });
});
