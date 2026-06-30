export type TurnDetectionMode = 'vad' | 'semantic' | 'manual';

export type DemoConfig = {
  appId: string;
  channel: string;
  userId: string;
  agentUserId: string;
  sosDetectionMode: TurnDetectionMode;
  eosDetectionMode: TurnDetectionMode;
};

type TokenType = 1 | 2;

type StartAgentParams = {
  config: DemoConfig;
  remoteRtcUid: string;
};

const DEMO_API_BASE_URL = '/demo-api';

export type StartAgentResult = {
  agentId: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function readTokenFromResponse(body: unknown): string {
  if (!body || typeof body !== 'object') {
    throw new Error('Token response is not an object');
  }

  const token = (body as Record<string, unknown>).token;
  if (typeof token === 'string') {
    return token;
  }

  throw new Error(`Token response does not include token: ${JSON.stringify(body)}`);
}

function demoApiUrl(path: string): string {
  return `${trimTrailingSlash(DEMO_API_BASE_URL)}${path}`;
}

export async function generateToken(
  config: DemoConfig,
  uid: string,
  tokenTypes: TokenType[] = [1, 2]
): Promise<string> {
  const response = await fetch(demoApiUrl('/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: config.channel,
      uid,
      tokenTypes,
    }),
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `Generate token failed: httpCode=${response.status}, body=${JSON.stringify(body)}`
    );
  }

  return readTokenFromResponse(body);
}

export async function startAgent({
  config,
  remoteRtcUid,
}: StartAgentParams): Promise<StartAgentResult> {
  const response = await fetch(demoApiUrl('/agents/join'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: config.channel,
      userId: config.userId,
      remoteRtcUid,
      agentUserId: config.agentUserId,
      sosDetectionMode: config.sosDetectionMode,
      eosDetectionMode: config.eosDetectionMode,
    }),
  });
  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `Start agent failed: httpCode=${response.status}, body=${JSON.stringify(body)}`
    );
  }

  if (!body || typeof body !== 'object') {
    throw new Error(`Start agent response is not an object: ${JSON.stringify(body)}`);
  }

  const agentId = (body as Record<string, unknown>).agentId;
  if (typeof agentId !== 'string' || !agentId) {
    throw new Error(`Start agent response does not include agentId: ${JSON.stringify(body)}`);
  }

  return { agentId };
}

export async function stopAgent(config: DemoConfig, agentId: string): Promise<void> {
  const response = await fetch(demoApiUrl(`/agents/${encodeURIComponent(agentId)}/leave`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: config.channel,
      agentUserId: config.agentUserId,
    }),
  });

  if (!response.ok) {
    const body = await readJsonResponse(response);
    throw new Error(`Stop agent failed: httpCode=${response.status}, body=${JSON.stringify(body)}`);
  }
}
