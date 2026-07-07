import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateConvoAiToken } from './token.mjs';

const DEFAULT_CONVOAI_BASE_URL = 'https://api.agora.io/api/conversational-ai-agent/v2/projects';
const DEFAULT_AGENT_GREETING_MESSAGE = 'hello man, I am an AI robot, I can do anything for you';
const DEFAULT_AGENT_FAILURE_MESSAGE = "Sorry, I don't know how to answer your question";
const VALID_TURN_MODES = new Set(['vad', 'semantic', 'manual']);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');

class DemoHttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index < 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

const fileEnv = parseEnvFile(path.join(appDir, '.env'));
const env = { ...fileEnv, ...process.env };

function readEnv(name, fallbackName, defaultValue = '') {
  return env[name] || (fallbackName ? env[fallbackName] : '') || defaultValue;
}

const config = {
  host: readEnv('WEB_DEMO_SERVER_HOST', undefined, '127.0.0.1'),
  port: Number(readEnv('WEB_DEMO_SERVER_PORT', undefined, '8788')),
  appId: readEnv('AGORA_APP_ID'),
  appCertificate: readEnv('AGORA_APP_CERTIFICATE'),
  convoAiBaseUrl: readEnv('CONVOAI_BASE_URL', undefined, DEFAULT_CONVOAI_BASE_URL),
  llmUrl: readEnv('AGORA_LLM_URL', undefined, 'https://api.groq.com/openai/v1/chat/completions'),
  llmApiKey: readEnv('AGORA_LLM_API_KEY'),
  llmModel: readEnv('AGORA_LLM_MODEL', undefined, 'llama-3.3-70b-versatile'),
  ttsVendor: readEnv('AGORA_TTS_VENDOR', undefined, 'elevenlabs'),
  ttsKey: readEnv('AGORA_TTS_KEY'),
  ttsModelId: readEnv('AGORA_TTS_MODEL_ID', undefined, 'eleven_flash_v2_5'),
  ttsVoiceId: readEnv('AGORA_TTS_VOICE_ID'),
  ttsSampleRate: Number(readEnv('AGORA_TTS_SAMPLE_RATE', undefined, '44100')),
};

function assertConfigured() {
  const missing = [
    ['AGORA_APP_ID', config.appId],
    ['AGORA_APP_CERTIFICATE', config.appCertificate],
    ['CONVOAI_BASE_URL', config.convoAiBaseUrl],
  ]
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing web demo server env: ${missing.join(', ')}`);
  }
}

function assertAgentConfigured() {
  const missing = [
    ['AGORA_LLM_URL', config.llmUrl],
    ['AGORA_LLM_API_KEY', config.llmApiKey],
    ['AGORA_LLM_MODEL', config.llmModel],
    ['AGORA_TTS_VENDOR', config.ttsVendor],
    ['AGORA_TTS_KEY', config.ttsKey],
    ['AGORA_TTS_MODEL_ID', config.ttsModelId],
    ['AGORA_TTS_VOICE_ID', config.ttsVoiceId],
  ]
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name);

  if (missing.length) {
    throw new DemoHttpError(400, `Missing web demo agent env: ${missing.join(', ')}`);
  }
}

function sanitize(value) {
  return JSON.stringify(value).replace(/[A-Za-z0-9_.=-]{24,}/g, '[redacted]');
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new DemoHttpError(413, 'Request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new DemoHttpError(400, 'Request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function requireString(body, field) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new DemoHttpError(400, `${field} is required`);
  }
  return value.trim();
}

function requireTurnMode(body, field) {
  const value = requireString(body, field);
  if (!VALID_TURN_MODES.has(value)) {
    throw new DemoHttpError(400, `${field} must be vad, semantic, or manual`);
  }
  return value;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function requestToken(channel, uid) {
  return generateConvoAiToken({
    appId: config.appId,
    appCertificate: config.appCertificate,
    channelName: channel,
    uid,
  });
}

function buildTurnModeConfig(mode) {
  const value = { mode };
  return value;
}

function buildStartAgentPayload({
  channel,
  remoteRtcUid,
  agentUserId,
  agentToken,
  sosMode,
  eosMode,
}) {
  return {
    name: channel,
    properties: {
      channel,
      token: agentToken,
      agent_rtc_uid: agentUserId,
      remote_rtc_uids: [remoteRtcUid],
      enable_string_uid: false,
      idle_timeout: 120,
      advanced_features: {
        enable_sal: false,
        enable_rtm: true,
      },
      tts: {
        vendor: config.ttsVendor,
        params: {
          key: config.ttsKey,
          model_id: config.ttsModelId,
          voice_id: config.ttsVoiceId,
          sample_rate: config.ttsSampleRate,
        },
      },
      llm: {
        url: config.llmUrl,
        api_key: config.llmApiKey,
        params: {
          model: config.llmModel,
        },
        greeting_message: DEFAULT_AGENT_GREETING_MESSAGE,
        failure_message: DEFAULT_AGENT_FAILURE_MESSAGE,
      },
      parameters: {
        enable_metrics: true,
        enable_error_message: true,
        data_channel: 'rtm',
      },
      turn_detection: {
        mode: 'default',
        config: {
          start_of_speech: buildTurnModeConfig(sosMode),
          end_of_speech: buildTurnModeConfig(eosMode),
        },
      },
    },
  };
}

async function joinAgent(body) {
  assertAgentConfigured();

  const channel = requireString(body, 'channel');
  const remoteRtcUid = requireString(body, 'remoteRtcUid');
  const agentUserId = requireString(body, 'agentUserId');
  const sosMode = requireTurnMode(body, 'sosDetectionMode');
  const eosMode = requireTurnMode(body, 'eosDetectionMode');
  const agentToken = await requestToken(channel, agentUserId);
  const authToken = await requestToken(channel, agentUserId);
  const url = `${trimTrailingSlash(config.convoAiBaseUrl)}/${config.appId}/join`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `agora token=${authToken}`,
    },
    body: JSON.stringify(
      buildStartAgentPayload({
        channel,
        remoteRtcUid,
        agentUserId,
        agentToken,
        sosMode,
        eosMode,
      })
    ),
  });
  const responseBody = await readJsonResponse(response);

  if (!response.ok) {
    throw new DemoHttpError(502, 'Start agent failed', {
      httpCode: response.status,
      body: responseBody,
    });
  }

  if (!responseBody || typeof responseBody.agent_id !== 'string') {
    throw new DemoHttpError(502, 'Start agent response does not include agent_id');
  }

  return { agentId: responseBody.agent_id };
}

async function leaveAgent(agentId, body) {
  const channel = requireString(body, 'channel');
  const agentUserId = requireString(body, 'agentUserId');
  const authToken = await requestToken(channel, agentUserId);
  const url = `${trimTrailingSlash(config.convoAiBaseUrl)}/${config.appId}/agents/${agentId}/leave`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `agora token=${authToken}`,
    },
  });
  const responseBody = await readJsonResponse(response);

  if (!response.ok) {
    throw new DemoHttpError(502, 'Stop agent failed', {
      httpCode: response.status,
      body: responseBody,
    });
  }

  return {};
}

async function handleRequest(request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1');

  if (request.method === 'GET' && url.pathname === '/demo-api/health') {
    sendJson(response, 200, { ok: true, appId: config.appId });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/demo-api/config') {
    sendJson(response, 200, { appId: config.appId });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/demo-api/token') {
    const body = await readJsonRequest(request);
    const channel = requireString(body, 'channel');
    const uid = requireString(body, 'uid');
    const token = requestToken(channel, uid);
    sendJson(response, 200, { token });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/demo-api/agents/join') {
    const body = await readJsonRequest(request);
    sendJson(response, 200, await joinAgent(body));
    return;
  }

  const leaveMatch = url.pathname.match(/^\/demo-api\/agents\/([^/]+)\/leave$/);
  if (request.method === 'POST' && leaveMatch) {
    const body = await readJsonRequest(request);
    sendJson(response, 200, await leaveAgent(decodeURIComponent(leaveMatch[1]), body));
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

assertConfigured();

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    const status = error instanceof DemoHttpError ? error.status : 500;
    const body = {
      error: error instanceof Error ? error.message : 'Internal server error',
    };
    if (error instanceof DemoHttpError && error.details !== undefined) {
      body.details = JSON.parse(sanitize(error.details));
    }
    sendJson(response, status, body);
  });
});

server.listen(config.port, config.host, () => {
  console.log(
    `Web demo server listening on http://${config.host}:${config.port} -> ${trimTrailingSlash(
      config.convoAiBaseUrl
    )}`
  );
});
