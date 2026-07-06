import agoraToken from 'agora-token';

export const DEFAULT_TOKEN_EXPIRE_SECONDS = 60 * 60 * 24;

function toNumericUid(uid) {
  const value = typeof uid === 'number' ? uid : Number(uid);
  if (!Number.isInteger(value)) {
    throw new Error('uid must be an integer');
  }
  return value;
}

export function createTokenGenerator({ tokenBuilder = agoraToken } = {}) {
  return {
    generateConvoAiToken({
      appId,
      appCertificate,
      channelName,
      uid,
      tokenExpire = DEFAULT_TOKEN_EXPIRE_SECONDS,
      privilegeExpire = tokenExpire,
    }) {
      const numericUid = toNumericUid(uid);
      return tokenBuilder.RtcTokenBuilder.buildTokenWithRtm(
        appId,
        appCertificate,
        channelName,
        String(numericUid),
        tokenBuilder.RtcRole.PUBLISHER,
        tokenExpire,
        privilegeExpire || tokenExpire
      );
    },
  };
}

export const tokenGenerator = createTokenGenerator();

export function generateConvoAiToken(options) {
  return tokenGenerator.generateConvoAiToken(options);
}
