// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EConversationalAIAPIEvents } from 'agora-agent-client-toolkit';
import { App } from './App';

const mocks = vi.hoisted(() => {
  const track = { close: vi.fn(), setEnabled: vi.fn(), getVolumeLevel: () => 0 };
  const rtc = {
    join: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    remoteUsers: [],
  };
  const rtm = {
    login: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    logout: vi.fn(),
  };
  const handlers = new Map<string, (...args: any[]) => void>();
  const ai = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => handlers.set(event, handler)),
    subscribeMessage: vi.fn(),
    unsubscribe: vi.fn(),
    destroy: vi.fn(),
    chat: vi.fn(),
  };
  return {
    track,
    rtc,
    rtm,
    handlers,
    ai,
    microphone: vi.fn(),
    init: vi.fn(),
    config: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
});

vi.mock('agora-rtc-react', () => ({
  default: {
    createClient: () => mocks.rtc,
    createMicrophoneAudioTrack: mocks.microphone,
    setParameter: vi.fn(),
  },
  AgoraRTCProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('agora-rtm', () => ({ default: { RTM: vi.fn(() => mocks.rtm) } }));
vi.mock('agora-agent-client-toolkit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('agora-agent-client-toolkit')>()),
  ConversationalAIAPI: { init: mocks.init, getInstance: () => mocks.ai },
}));
vi.mock('./demo-api', () => ({
  getSessionConfig: mocks.config,
  startAgent: mocks.start,
  stopAgent: mocks.stop,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function connect() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Start agent' }));
  await screen.findByText(/Agent started successfully/);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  mocks.config.mockResolvedValue({
    appId: 'app-id',
    token: 'token',
    channel: 'test-channel',
    userId: '123',
    agentUserId: '456',
    sosDetectionMode: 'vad',
    eosDetectionMode: 'semantic',
  });
  for (const fn of [
    mocks.rtc.join,
    mocks.rtc.publish,
    mocks.rtc.unpublish,
    mocks.rtc.leave,
    mocks.rtm.login,
    mocks.rtm.subscribe,
    mocks.rtm.unsubscribe,
    mocks.rtm.logout,
    mocks.ai.chat,
  ]) {
    fn.mockResolvedValue(undefined);
  }
  mocks.microphone.mockResolvedValue(mocks.track);
  mocks.init.mockResolvedValue(mocks.ai);
  mocks.start.mockResolvedValue({ agentId: 'agent-123' });
  mocks.stop.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Playground session controls', () => {
  it.each([false, true])(
    'stops local media while backend stop is pending (transport cleanup pending: %s)',
    async (hangTransport) => {
      const stop = deferred<void>();
      const transport = deferred<void>();
      mocks.stop.mockReturnValue(stop.promise);
      if (hangTransport) {
        mocks.rtc.unpublish.mockReturnValue(transport.promise);
        mocks.rtm.unsubscribe.mockReturnValue(transport.promise);
      }
      await connect();

      fireEvent.click(screen.getByRole('button', { name: 'Stop agent' }));

      expect(mocks.track.close).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        expect(mocks.rtc.leave).toHaveBeenCalledTimes(1);
        expect(mocks.rtm.logout).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByRole('button', { name: 'Start agent' }).hasAttribute('disabled')).toBe(
        false
      );
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      expect(mocks.stop).toHaveBeenCalledWith('agent-123');
      expect(mocks.ai.destroy).toHaveBeenCalledTimes(1);
      await act(async () => {
        stop.reject(new Error('backend unavailable'));
        transport.resolve();
      });
    }
  );

  it('closes a microphone acquired after unmount without publishing it', async () => {
    const microphone = deferred<typeof mocks.track>();
    mocks.microphone.mockReturnValue(microphone.promise);
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start agent' }));
    await waitFor(() => expect(mocks.microphone).toHaveBeenCalled());
    view.unmount();
    await act(async () => {
      microphone.resolve(mocks.track);
    });

    expect(mocks.track.close).toHaveBeenCalledTimes(1);
    expect(mocks.rtc.publish).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('stops an agent whose startup completes after unmount', async () => {
    const start = deferred<{ agentId: string }>();
    mocks.start.mockReturnValue(start.promise);
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start agent' }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    view.unmount();
    expect(mocks.track.close).toHaveBeenCalledTimes(1);
    await act(async () => {
      start.resolve({ agentId: 'late-agent' });
    });

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledWith('late-agent');
    expect(screen.queryByText(/Agent started successfully/)).toBeNull();
  });

  it('shows an Agent rejection after RTM accepts an image message', async () => {
    await connect();
    fireEvent.click(screen.getByRole('button', { name: 'Image', exact: true }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'https://example.com/image.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
    await waitFor(() => expect(mocks.ai.chat).toHaveBeenCalled());
    act(() => {
      mocks.handlers.get(EConversationalAIAPIEvents.MESSAGE_ERROR)?.('456', {
        type: 'image',
        code: 1001,
        message: 'Image rejected by agent',
        timestamp: 123,
      });
    });

    expect(screen.getByText(/Image rejected by agent/).closest('.log-line')?.className).toContain(
      'error'
    );
    expect(screen.getByText(/Image rejected by agent/).textContent).toContain('1001');
  });

  it('shows message receipts with their Agent and turn details', async () => {
    await connect();
    act(() => {
      mocks.handlers.get(EConversationalAIAPIEvents.MESSAGE_RECEIPT_UPDATED)?.('456', {
        moduleType: 'mllm',
        messageType: 'image',
        message: 'Image processed',
        turnId: 42,
      });
    });

    const receipt = screen.getByText(/Image processed/);
    expect(receipt.textContent).toContain('456');
    expect(receipt.textContent).toContain('42');
  });
});
