export type TurnDetectionMode = 'vad' | 'semantic' | 'manual';

export type DemoConfig = {
  appId: string;
  token: string;
  channel: string;
  userId: string;
  agentUserId: string;
  sosDetectionMode: TurnDetectionMode;
  eosDetectionMode: TurnDetectionMode;
};

export type StartAgentResult = {
  agentId: string;
};

type BackendEnvelope = {
  code?: unknown;
  data?: unknown;
  msg?: unknown;
};

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function readBackendData(response: Response, action: string): Promise<unknown> {
  const body = await readJsonResponse(response);
  const envelope = body && typeof body === 'object' ? (body as BackendEnvelope) : null;
  const code = typeof envelope?.code === 'number' ? envelope.code : null;
  const message =
    typeof envelope?.msg === 'string' && envelope.msg.trim()
      ? envelope.msg.trim()
      : 'Backend request failed';

  if (!response.ok || code !== 0) {
    throw new Error(
      `${action} failed: httpCode=${response.status}, code=${code}, message=${message}`
    );
  }

  return envelope?.data;
}

function requireRecord(value: unknown, action: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${action} response has no data`);
  }
  return value as Record<string, unknown>;
}

function requireString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Backend response is missing ${key}`);
  }
  return value.trim();
}

function requirePositiveUid(data: Record<string, unknown>, key: string): string {
  const value = requireString(data, key);
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0 || numericValue > 2_147_483_647) {
    throw new Error(`Backend response has invalid ${key}`);
  }
  return value;
}

function numericUid(value: string, field: string): number {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0 || numericValue > 2_147_483_647) {
    throw new Error(`${field} must be a positive integer`);
  }
  return numericValue;
}

export async function getSessionConfig(config: DemoConfig): Promise<DemoConfig> {
  const query = new URLSearchParams({
    channel: config.channel,
    uid: String(numericUid(config.userId, 'userId')),
  });
  const response = await fetch(`/get_config?${query.toString()}`);
  const data = requireRecord(
    await readBackendData(response, 'Read backend config'),
    'Backend config'
  );

  return {
    ...config,
    appId: requireString(data, 'app_id'),
    token: requireString(data, 'token'),
    channel: requireString(data, 'channel_name'),
    userId: requirePositiveUid(data, 'uid'),
    agentUserId: requirePositiveUid(data, 'agent_uid'),
  };
}

export async function startAgent(config: DemoConfig): Promise<StartAgentResult> {
  const response = await fetch('/startAgent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channelName: config.channel,
      agentUid: numericUid(config.agentUserId, 'agentUserId'),
      userUid: numericUid(config.userId, 'userId'),
      startOfSpeechMode: config.sosDetectionMode,
      endOfSpeechMode: config.eosDetectionMode,
    }),
  });
  const data = requireRecord(await readBackendData(response, 'Start agent'), 'Start agent');

  return { agentId: requireString(data, 'agent_id') };
}

export async function stopAgent(agentId: string): Promise<void> {
  const response = await fetch('/stopAgent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });

  await readBackendData(response, 'Stop agent');
}
