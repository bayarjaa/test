import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface AccessClaims {
  sub: string;
  preferredUsername?: string;
  email?: string;
  azp?: string;
}

export class TokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRejectedError';
  }
}

export async function verifyAccessToken(
  token: string,
  options: { jwks: JWTVerifyGetKey; issuer: string; audience: string },
): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: 5,
    });
    return toClaims(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'token rejected';
    throw new TokenRejectedError(message);
  }
}

function toClaims(payload: JWTPayload): AccessClaims {
  if (!payload.sub) throw new TokenRejectedError('missing sub');
  return {
    sub: payload.sub,
    preferredUsername: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    azp: typeof payload.azp === 'string' ? payload.azp : undefined,
  };
}

export function remoteJwks(internalUrl: string, realm: string): JWTVerifyGetKey {
  const url = new URL(`${internalUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/certs`);
  return createRemoteJWKSet(url);
}
