import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

const SERVER_URL = 'http://127.0.0.1:18789';
const CONVOAI_UPSTREAM_PORT = 18790;
const CONVOAI_UPSTREAM_URL = `http://127.0.0.1:${CONVOAI_UPSTREAM_PORT}`;

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
    PATH: process.env.PATH,
    WEB_DEMO_SERVER_PORT: '18789',
    CONVOAI_BASE_URL: `${CONVOAI_UPSTREAM_URL}/api/conversational-ai-agent/v2/projects`,
    AGORA_APP_ID: '0123456789abcdef0123456789abcdef',
    AGORA_APP_CERTIFICATE: 'fedcba9876543210fedcba9876543210',
    AGORA_LLM_API_KEY: 'llm-key',
    AGORA_TTS_KEY: 'tts-key',
    AGORA_TTS_VOICE_ID: 'voice-id',
  };

  return spawn(process.execPath, ['apps/web-demo/server/server.mjs'], {
    cwd: new URL('../../../', import.meta.url),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function startConvoAiUpstream() {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: body ? JSON.parse(body) : {},
      });

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ agent_id: 'agent-web-1' }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(CONVOAI_UPSTREAM_PORT, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({ server, requests });
    });
  });
}

function stopHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  child.kill('SIGTERM');
  return new Promise((resolve) => child.once('exit', resolve));
}

test('server starts and posts join payload without client ASR override', async () => {
  const upstream = await startConvoAiUpstream();
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

    assert.equal(joinResponse.status, 200);
    assert.deepEqual(joinBody, { agentId: 'agent-web-1' });

    assert.equal(upstream.requests.length, 1);
    const upstreamRequest = upstream.requests[0];
    assert.equal(upstreamRequest.method, 'POST');
    assert.equal(
      upstreamRequest.url,
      '/api/conversational-ai-agent/v2/projects/0123456789abcdef0123456789abcdef/join'
    );
    assert.match(upstreamRequest.headers.authorization, /^agora token=.+/);

    const payload = upstreamRequest.body;
    assert.equal(payload.preset, undefined);
    assert.equal(payload.properties.asr, undefined);
    assert.equal(payload.properties.llm.api_key, 'llm-key');
    assert.equal(payload.properties.tts.params.key, 'tts-key');
    assert.deepEqual(payload.properties.advanced_features, {
      enable_sal: false,
      enable_rtm: true,
    });
    assert.deepEqual(payload.properties.parameters, {
      enable_metrics: true,
      enable_error_message: true,
      data_channel: 'rtm',
    });
    assert.deepEqual(payload.properties.turn_detection, {
      mode: 'default',
      config: {
        start_of_speech: { mode: 'vad' },
        end_of_speech: { mode: 'semantic' },
      },
    });
  } catch (error) {
    assert.fail(`${error.message}\n${stderr}`);
  } finally {
    await stopServer(child);
    await stopHttpServer(upstream.server);
  }
});
