import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSessionConfig, startAgent, stopAgent, type DemoConfig } from './demo-api';

const config: DemoConfig = {
  appId: '',
  token: '',
  channel: 'channel_web_123456',
  userId: '123456',
  agentUserId: '',
  sosDetectionMode: 'manual',
  eosDetectionMode: 'semantic',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Python backend API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps get_config into the RTC/RTM session config', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        data: {
          app_id: '0123456789abcdef0123456789abcdef',
          token: 'unified-user-token',
          uid: '123456',
          agent_uid: '87654321',
          channel_name: 'channel_web_123456',
        },
        msg: 'success',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getSessionConfig(config);

    expect(fetchMock).toHaveBeenCalledWith('/get_config?channel=channel_web_123456&uid=123456');
    expect(result).toMatchObject({
      appId: '0123456789abcdef0123456789abcdef',
      token: 'unified-user-token',
      userId: '123456',
      agentUserId: '87654321',
    });
  });

  it('starts the SDK agent without provider credentials or REST auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ code: 0, data: { agent_id: 'agent-123' }, msg: 'success' })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await startAgent({
      ...config,
      appId: 'app-id',
      token: 'user-token',
      agentUserId: '87654321',
    });

    expect(result).toEqual({ agentId: 'agent-123' });
    expect(fetchMock).toHaveBeenCalledWith('/startAgent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelName: 'channel_web_123456',
        agentUid: 87654321,
        userUid: 123456,
        startOfSpeechMode: 'manual',
        endOfSpeechMode: 'semantic',
      }),
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).not.toHaveProperty('Authorization');
    expect(request.body).not.toContain('api_key');
  });

  it('uses the safe backend error message and forwards only the agent ID on stop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ code: 502, data: null, msg: 'Failed to start agent' }, 502)
      )
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: null, msg: 'success' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(startAgent({ ...config, agentUserId: '87654321' })).rejects.toThrow(
      'Failed to start agent'
    );
    await stopAgent('agent-123');

    expect(fetchMock).toHaveBeenLastCalledWith('/stopAgent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-123' }),
      signal: expect.any(AbortSignal),
    });
  });

  it.each(['headers', 'body'])(
    'times out a stop request stalled while reading %s',
    async (phase) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init: RequestInit) => {
          signal = init.signal as AbortSignal;
          const pending = new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal?.reason), { once: true });
          });
          return phase === 'headers'
            ? pending
            : Promise.resolve({ ok: true, status: 200, text: () => pending });
        })
      );

      const result = stopAgent('agent-123');
      expect(signal).toBeInstanceOf(AbortSignal);
      const failure = expect(result).rejects.toThrow('Stop agent timed out');
      await vi.advanceTimersByTimeAsync(10_000);
      await failure;
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('clears the stop deadline when the backend succeeds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 0, data: null })));
    await stopAgent('agent-123');
    expect(vi.getTimerCount()).toBe(0);
  });
});
