import { describe, expect, it, vi } from 'vitest';
import { CreatorOSClient, isValidKeyShape } from '../src/client/client.js';
import { maskKey } from '../src/util/mask.js';
import { sanitize } from '../src/util/sanitize.js';

const KEY = 'sk_' + 'ab'.repeat(32);

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('key validation', () => {
  it('accepts sk_ + 64 hex', () => {
    expect(isValidKeyShape(KEY)).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isValidKeyShape('sk_short')).toBe(false);
    expect(isValidKeyShape('pk_' + 'a'.repeat(64))).toBe(false);
    expect(isValidKeyShape('sk_' + 'z'.repeat(64))).toBe(false); // not hex
    expect(isValidKeyShape('')).toBe(false);
  });

  it('validateKey returns false on 401 and true on 200', async () => {
    const bad = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(401, { error: 'nope' }) });
    expect(await bad.validateKey()).toBe(false);
    const good = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(200, { users: [] }) });
    expect(await good.validateKey()).toBe(true);
  });
});

describe('hard blocks never touch the network', () => {
  it('profile create is refused with the plan message and zero fetches', async () => {
    const spy = vi.fn();
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: spy as unknown as typeof fetch });
    await expect(client.request('POST', '/v1/profiles', { body: { name: 'x' } })).rejects.toThrow(
      'Manage your plan in the CreatorOS app.',
    );
    await expect(client.request('DELETE', '/v1/profiles/p1')).rejects.toThrow(
      'Manage your plan in the CreatorOS app.',
    );
    await expect(client.request('POST', '/v1/whatsapp/phone-numbers/purchase')).rejects.toThrow(
      'Manage your plan in the CreatorOS app.',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('non-CreatorOS endpoints are refused with the capability message', async () => {
    const spy = vi.fn();
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: spy as unknown as typeof fetch });
    await expect(client.request('POST', '/v1/ads/create')).rejects.toThrow(
      "That endpoint isn't part of CreatorOS.",
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('requests', () => {
  it('sends bearer auth and JSON body', async () => {
    const impl = vi.fn(async () => new Response('{"post":{"_id":"1","status":"scheduled"}}', { status: 201 }));
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch });
    await client.createPost({ content: 'hi', platforms: [{ platform: 'twitter', accountId: 'a' }] });
    const [url, init] = impl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain('/v1/posts');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body)).content).toBe('hi');
  });

  it('sanitizes vendor names out of API error text', async () => {
    const client = new CreatorOSClient({
      apiKey: KEY,
      fetchImpl: fakeFetch(400, { error: 'Zernio rejected this post; see https://docs.zernio.com/posts' }),
    });
    const error = await client.createPost({ platforms: [{ platform: 'twitter', accountId: 'a' }] }).catch((e) => e);
    expect(String(error.message)).not.toMatch(/zernio/i);
    expect(error.message).toContain('CreatorOS');
  });
});

describe('key masking', () => {
  it('masks to sk_...last4 everywhere', () => {
    expect(maskKey(KEY)).toBe(`sk_...${KEY.slice(-4)}`);
    expect(maskKey(KEY)).not.toContain(KEY.slice(3, 10));
    expect(maskKey('')).toBe('sk_...');
  });

  it('client exposes only the masked key', () => {
    const client = new CreatorOSClient({ apiKey: KEY, fetchImpl: fakeFetch(200, {}) });
    expect(client.maskedKey).toBe(`sk_...${KEY.slice(-4)}`);
  });
});

describe('sanitize', () => {
  it('replaces the vendor name case-insensitively', () => {
    expect(sanitize('ZERNIO says zernio')).toBe('CreatorOS says CreatorOS');
  });
  it('rewrites docs links', () => {
    expect(sanitize('see https://docs.zernio.com/webhooks for details')).toBe(
      'see the CreatorOS docs for details',
    );
  });
});
