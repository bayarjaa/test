import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { verifyAccessToken } from './jwt';

describe('JWT verification', () => {
  const issuer = 'http://localhost:8080/realms/budget-management';
  const audience = 'budget-api';
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = await exportJWK(keys.publicKey);
    publicJwk.kid = 'test-key';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
  });

  function jwks() {
    return createLocalJWKSet({ keys: [publicJwk] });
  }

  async function sign(overrides: Record<string, unknown> = {}) {
    return new SignJWT({ preferred_username: 'moe.specialist', azp: 'budget-web', ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);
  }

  it('accepts a token signed by the realm key with the API audience', async () => {
    const claims = await verifyAccessToken(await sign(), { jwks: jwks(), issuer, audience });
    expect(claims.sub).toBe('user-1');
    expect(claims.preferredUsername).toBe('moe.specialist');
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 30)
      .sign(privateKey);
    await expect(verifyAccessToken(expired, { jwks: jwks(), issuer, audience })).rejects.toThrow(/exp/i);
  });

  it('rejects the wrong audience', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(issuer)
      .setAudience('other-api')
      .setExpirationTime('2m')
      .sign(privateKey);
    await expect(verifyAccessToken(token, { jwks: jwks(), issuer, audience })).rejects.toThrow(/aud/i);
  });

  it('rejects the wrong issuer and a bad signature', async () => {
    const wrongIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer('http://evil.example/realms/budget-management')
      .setAudience(audience)
      .setExpirationTime('2m')
      .sign(privateKey);
    await expect(verifyAccessToken(wrongIssuer, { jwks: jwks(), issuer, audience })).rejects.toThrow(/iss/i);

    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime('2m')
      .sign(other.privateKey);
    await expect(verifyAccessToken(forged, { jwks: jwks(), issuer, audience })).rejects.toThrow();
  });
});
