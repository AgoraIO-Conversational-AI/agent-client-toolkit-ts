import { describe, expect, it } from 'vitest';

import type { DemoConfig } from './demo-api';
import { applyServerAppId, dropPersistedAppId } from './app-config';

const config: DemoConfig = {
  appId: 'local-old-app-id',
  channel: 'channel_web_123456',
  userId: '123456',
  agentUserId: '654321',
  sosDetectionMode: 'vad',
  eosDetectionMode: 'semantic',
};

describe('web demo app config', () => {
  it('uses the server app id over a persisted local app id', () => {
    expect(applyServerAppId(config, ' server-app-id ')).toEqual({
      ...config,
      appId: 'server-app-id',
    });
  });

  it('drops persisted app id values from local storage config', () => {
    expect(dropPersistedAppId({ appId: 'local-old-app-id', userId: '123456' })).toEqual({
      userId: '123456',
    });
  });
});
