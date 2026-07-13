import { describe, expect, it } from 'vitest';
import { signBody, verifySignature } from '../src/webhooks/receiver.js';

describe('webhook signature verification', () => {
  const secret = 'shh-very-secret';
  const body = JSON.stringify({ id: 'evt_1', event: 'comment.received' });

  it('accepts a correctly signed body', () => {
    expect(verifySignature(body, secret, signBody(body, secret))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = signBody(body, secret);
    expect(verifySignature(body + 'x', secret, signature)).toBe(false);
  });

  it('rejects a missing or wrong signature', () => {
    expect(verifySignature(body, secret, undefined)).toBe(false);
    expect(verifySignature(body, secret, 'deadbeef')).toBe(false);
    expect(verifySignature(body, 'wrong-secret', signBody(body, secret))).toBe(false);
  });
});
