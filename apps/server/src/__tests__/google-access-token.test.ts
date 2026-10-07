import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

import { config } from '../config';
import { verifyGoogleAccessToken } from '../services/googleAuth.service';

const CLIENT_ID = 'frigat-test-client.apps.googleusercontent.com';
const future = () => String(Math.floor(Date.now() / 1000) + 600);

function tokeninfoReturns(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  );
}

const good = () => ({
  aud: CLIENT_ID,
  azp: CLIENT_ID,
  sub: '1234567890',
  email: 'Player@Gmail.com',
  email_verified: 'true',
  exp: future(),
});

beforeAll(() => {
  (config.google as { clientId: string }).clientId = CLIENT_ID;
});

afterEach(() => vi.unstubAllGlobals());

describe('verifyGoogleAccessToken', () => {
  it('accepts a live token issued to our client with a verified email', async () => {
    tokeninfoReturns(good());
    await expect(verifyGoogleAccessToken('ya29.ok')).resolves.toEqual({
      googleId: '1234567890',
      email: 'player@gmail.com',
    });
  });

  it('rejects a token issued to a different client', async () => {
    tokeninfoReturns({ ...good(), aud: 'someone-else', azp: 'someone-else' });
    await expect(verifyGoogleAccessToken('ya29.foreign')).resolves.toBeNull();
  });

  it('rejects an unverified email', async () => {
    tokeninfoReturns({ ...good(), email_verified: 'false' });
    await expect(verifyGoogleAccessToken('ya29.unverified')).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    tokeninfoReturns({ ...good(), exp: String(Math.floor(Date.now() / 1000) - 5) });
    await expect(verifyGoogleAccessToken('ya29.expired')).resolves.toBeNull();
  });

  it('rejects a token without the email scope', async () => {
    const { email: _email, email_verified: _verified, ...noEmail } = good();
    tokeninfoReturns(noEmail);
    await expect(verifyGoogleAccessToken('ya29.noemail')).resolves.toBeNull();
  });

  it('rejects when Google says the token is invalid or is unreachable', async () => {
    tokeninfoReturns({ error: 'invalid_token' }, 400);
    await expect(verifyGoogleAccessToken('ya29.bad')).resolves.toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(verifyGoogleAccessToken('ya29.offline')).resolves.toBeNull();
  });
});
