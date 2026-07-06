import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const SERVER_URL = 'http://127.0.0.1:18789';

function waitForServer(url, timeoutMs = 5000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    async function poll() {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve(response);
          return;
        }
      } catch {
        // Keep polling until the timeout expires.
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      setTimeout(poll, 100);
    }

    poll();
  });
}

function startServer() {
  const env = {
    ...process.env,
    WEB_DEMO_SERVER_PORT: '18789',
    AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
    AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210',
    AGORA_ASR_API_KEY: '',
    AGORA_LLM_API_KEY: '',
    AGORA_TTS_KEY: '',
    AGORA_TTS_VOICE_ID: '',
  };

  return spawn(process.execPath, ['apps/web-demo/server/server.mjs'], {
    cwd: new URL('../../../', import.meta.url),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  child.kill('SIGTERM');
  return new Promise((resolve) => child.once('exit', resolve));
}

test('server starts with only Agora credentials so dev can load the UI', async () => {
  const child = startServer();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const response = await waitForServer(`${SERVER_URL}/demo-api/health`);
    const body = await response.json();

    assert.deepEqual(body, {
      ok: true,
      appId: '0123456789abcdef0123456789abcdef',
    });

    const joinResponse = await fetch(`${SERVER_URL}/demo-api/agents/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'channel_web_123456',
        remoteRtcUid: '123456',
        agentUserId: '654321',
        sosDetectionMode: 'vad',
        eosDetectionMode: 'semantic',
      }),
    });
    const joinBody = await joinResponse.json();

    assert.equal(joinResponse.status, 400);
    assert.match(joinBody.error, /Missing web demo agent env/);
    assert.match(joinBody.error, /AGORA_ASR_API_KEY/);
  } catch (error) {
    assert.fail(`${error.message}\n${stderr}`);
  } finally {
    await stopServer(child);
  }
});
