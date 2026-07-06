import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_TOKEN_EXPIRE_SECONDS, createTokenGenerator } from './token.mjs';

test('generates ConvoAI tokens with the same builder path as the TS server SDK', () => {
  const calls = [];
  const generator = createTokenGenerator({
    tokenBuilder: {
      RtcRole: { PUBLISHER: 1 },
      RtcTokenBuilder: {
        buildTokenWithRtm(...args) {
          calls.push(args);
          return 'generated-token';
        },
      },
    },
  });

  const token = generator.generateConvoAiToken({
    appId: 'app-id',
    appCertificate: 'app-certificate',
    channelName: 'channel',
    uid: 123456,
  });

  assert.equal(token, 'generated-token');
  assert.deepEqual(calls, [
    [
      'app-id',
      'app-certificate',
      'channel',
      '123456',
      1,
      DEFAULT_TOKEN_EXPIRE_SECONDS,
      DEFAULT_TOKEN_EXPIRE_SECONDS,
    ],
  ]);
});

test('rejects non-integer token UIDs before calling the token builder', () => {
  const generator = createTokenGenerator({
    tokenBuilder: {
      RtcRole: { PUBLISHER: 1 },
      RtcTokenBuilder: {
        buildTokenWithRtm() {
          throw new Error('must not be called');
        },
      },
    },
  });

  assert.throws(
    () =>
      generator.generateConvoAiToken({
        appId: 'app-id',
        appCertificate: 'app-certificate',
        channelName: 'channel',
        uid: 1.5,
      }),
    /uid must be an integer/
  );
});
