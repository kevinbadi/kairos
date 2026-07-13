import { describe, expect, it } from 'vitest';
import {
  assertCommentReplySupported,
  assertFunnelSupported,
  assertMessageReplySupported,
  normalizePlatform,
  PlatformNotSupportedError,
  supportsCommentReplies,
  supportsMessageReplies,
} from '../src/client/platformMatrix.js';
import { CreatorOSClient } from '../src/client/client.js';

describe('platform matrix — comments', () => {
  it('refuses TikTok comment replies with a friendly message, never a raw API error', () => {
    expect(() => assertCommentReplySupported('tiktok')).toThrowError(PlatformNotSupportedError);
    expect(() => assertCommentReplySupported('tiktok')).toThrowError(
      /not supported on this platform/,
    );
  });

  it('refuses the other no-comment platforms too', () => {
    for (const platform of ['pinterest', 'snapchat', 'telegram', 'whatsapp', 'googlebusiness']) {
      expect(supportsCommentReplies(platform)).toBe(false);
    }
  });

  it('allows the supported comment platforms', () => {
    for (const platform of ['facebook', 'instagram', 'twitter', 'bluesky', 'threads', 'reddit', 'youtube', 'linkedin']) {
      expect(() => assertCommentReplySupported(platform)).not.toThrow();
    }
  });
});

describe('platform matrix — messages', () => {
  it('allows DM platforms', () => {
    for (const platform of ['twitter', 'instagram', 'facebook', 'reddit', 'bluesky', 'telegram', 'whatsapp']) {
      expect(() => assertMessageReplySupported(platform)).not.toThrow();
    }
  });

  it('refuses DM-less platforms', () => {
    for (const platform of ['tiktok', 'youtube', 'threads', 'linkedin', 'pinterest']) {
      expect(supportsMessageReplies(platform)).toBe(false);
    }
  });
});

describe('platform matrix — funnels', () => {
  it('funnels are Instagram/Facebook only', () => {
    expect(() => assertFunnelSupported('instagram')).not.toThrow();
    expect(() => assertFunnelSupported('facebook')).not.toThrow();
    expect(() => assertFunnelSupported('twitter')).toThrowError(/Instagram and Facebook only/);
    expect(() => assertFunnelSupported('tiktok')).toThrowError(PlatformNotSupportedError);
  });
});

describe('platform aliases', () => {
  it('normalizes common aliases', () => {
    expect(normalizePlatform('X')).toBe('twitter');
    expect(normalizePlatform('IG')).toBe('instagram');
    expect(normalizePlatform('YouTube')).toBe('youtube');
  });
});

describe('matrix enforced inside the client (executor, not prompt discipline)', () => {
  const neverFetch: typeof fetch = () => {
    throw new Error('network should never be reached');
  };
  const client = new CreatorOSClient({ apiKey: 'sk_' + 'a'.repeat(64), fetchImpl: neverFetch });

  it('TikTok comment reply is refused before any network call', async () => {
    await expect(
      client.replyToComment({ platform: 'tiktok', postId: 'p', accountId: 'a', message: 'hi' }),
    ).rejects.toThrow(/not supported on this platform/);
  });

  it('Threads DM is refused before any network call', async () => {
    await expect(
      client.sendMessage({ platform: 'threads', conversationId: 'c', accountId: 'a', message: 'hi' }),
    ).rejects.toThrow(/not supported on this platform/);
  });
});
