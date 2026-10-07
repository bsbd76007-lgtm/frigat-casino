import { describe, it, expect, beforeEach, vi } from 'vitest';

const google = vi.hoisted(() => ({
  constructed: [] as unknown[][],
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    constructor(...args: unknown[]) {
      google.constructed.push(args);
    }
    getToken = google.getToken;
    verifyIdToken = google.verifyIdToken;
  },
}));

import { config } from '../config';
import {
  allowedRedirectUri,
  exchangeGoogleCode,
  POPUP_REDIRECT_URI,
} from '../services/googleAuth.service';

const CLIENT_ID = 'frigat-test-client.apps.googleusercontent.com';
const SECRET = 'test-secret';

function idTokenPayload(payload: Record<string, unknown>) {
  google.verifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

beforeEach(() => {
  google.constructed.length = 0;
  google.getToken.mockReset();
  google.verifyIdToken.mockReset();
  Object.assign(config.google, { clientId: CLIENT_ID, clientSecret: SECRET });
});

describe('exchangeGoogleCode', () => {
  it('exchanges the popup code with our secret and returns the verified identity', async () => {
    google.getToken.mockResolvedValue({ tokens: { id_token: 'id.jwt' } });
    idTokenPayload({ sub: 'g-1', email: 'Player@Gmail.com', email_verified: true });

    await expect(exchangeGoogleCode('4/code')).resolves.toEqual({
      googleId: 'g-1',
      email: 'player@gmail.com',
    });
    expect(google.constructed).toContainEqual([CLIENT_ID, SECRET, POPUP_REDIRECT_URI]);
    expect(google.getToken).toHaveBeenCalledWith({ code: '4/code', redirect_uri: 'postmessage' });
    expect(google.verifyIdToken).toHaveBeenCalledWith({ idToken: 'id.jwt', audience: CLIENT_ID });
  });

  it('exchanges a redirect-flow code against the callback address it was issued for', async () => {
    const callback = 'http://localhost:3000/api/auth/google/callback';
    google.getToken.mockResolvedValue({ tokens: { id_token: 'id.jwt' } });
    idTokenPayload({ sub: 'g-3', email: 'r@gmail.com', email_verified: true });

    await expect(exchangeGoogleCode('4/redirect', callback)).resolves.toEqual({
      googleId: 'g-3',
      email: 'r@gmail.com',
    });
    expect(google.constructed).toContainEqual([CLIENT_ID, SECRET, callback]);
    expect(google.getToken).toHaveBeenCalledWith({ code: '4/redirect', redirect_uri: callback });
  });

  it('rejects when Google refuses the code and logs Google\'s reason', async () => {
    google.getToken.mockRejectedValue(
      Object.assign(new Error('invalid_client'), {
        response: { data: { error: 'invalid_client', error_description: 'The provided client secret is invalid.' } },
      })
    );
    const warn = vi.fn();
    await expect(exchangeGoogleCode('4/used', POPUP_REDIRECT_URI, { warn })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ googleError: 'invalid_client' }),
      expect.any(String)
    );
  });

  it('rejects a token response without an ID token', async () => {
    google.getToken.mockResolvedValue({ tokens: { access_token: 'ya29' } });
    await expect(exchangeGoogleCode('4/noid')).resolves.toBeNull();
  });

  it('rejects an unverified email in the ID token', async () => {
    google.getToken.mockResolvedValue({ tokens: { id_token: 'id.jwt' } });
    idTokenPayload({ sub: 'g-2', email: 'x@gmail.com', email_verified: false });
    await expect(exchangeGoogleCode('4/unverified')).resolves.toBeNull();
  });

  it('only accepts our own callback addresses as redirect_uri', () => {
    expect(allowedRedirectUri('http://localhost:3000/api/auth/google/callback')).toBe(true);
    expect(allowedRedirectUri('http://localhost:3000/api/auth/google/callback?x=1')).toBe(false);
    expect(allowedRedirectUri('https://evil.example/api/auth/google/callback')).toBe(false);
  });

  it('does not call Google at all without a client secret', async () => {
    Object.assign(config.google, { clientSecret: '' });
    await expect(exchangeGoogleCode('4/code')).resolves.toBeNull();
    expect(google.getToken).not.toHaveBeenCalled();
  });
});
