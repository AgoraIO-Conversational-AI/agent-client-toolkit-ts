import type { DemoConfig } from './demo-api';

export function applyServerAppId(config: DemoConfig, appId: string): DemoConfig {
  const nextAppId = appId.trim();
  if (!nextAppId) return config;
  return { ...config, appId: nextAppId };
}

export function dropPersistedAppId(config: Partial<DemoConfig>): Partial<DemoConfig> {
  const { appId: _appId, ...rest } = config;
  return rest;
}
