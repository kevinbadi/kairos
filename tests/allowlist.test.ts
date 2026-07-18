import { describe, expect, it } from 'vitest';
import {
  checkEndpoint,
  NOT_CREATOROS_MESSAGE,
  PLAN_MESSAGE,
} from '../src/client/endpoints.js';

describe('endpoint allowlist', () => {
  it('allows the posting surface', () => {
    expect(checkEndpoint('POST', '/v1/posts').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/posts/abc123').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/posts/abc123/retry').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/media/presign').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/posts/bulk-upload').allowed).toBe(true);
  });

  it('allows analytics, inbox, funnels, webhooks, accounts, profiles-read', () => {
    expect(checkEndpoint('GET', '/v1/analytics?postId=x').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/analytics/best-time').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/accounts/follower-stats').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post1').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post1/c1/hide').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/comments/post1/c1/like').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/inbox/comments/post1?accountId=a1&commentId=c1').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/comment-automations/auto1/logs?status=failed').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/comment-automations/auto1').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/inbox/conversations/c1/messages').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/comment-automations').allowed).toBe(true);
    expect(checkEndpoint('DELETE', '/v1/webhooks/settings?id=w1').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/profiles').allowed).toBe(true);
    expect(checkEndpoint('PUT', '/v1/profiles/p1').allowed).toBe(true);
    expect(checkEndpoint('GET', '/v1/users').allowed).toBe(true);
  });

  it('refuses everything outside the capability surface with the CreatorOS message', () => {
    for (const [method, path] of [
      ['POST', '/v1/ads/create'],
      ['GET', '/v1/billing'],
      ['POST', '/v1/broadcasts'],
      ['POST', '/v1/sms/messages'],
      ['DELETE', '/v1/accounts/a1'],
      ['POST', '/v1/invites'],
    ] as const) {
      const decision = checkEndpoint(method, path);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.reason).toBe('not-allowed');
        expect(decision.message).toBe(NOT_CREATOROS_MESSAGE);
      }
    }
  });
});

describe('hard blocks', () => {
  it.each([
    ['POST', '/v1/profiles'],
    ['DELETE', '/v1/profiles/abc'],
    ['POST', '/v1/phone-numbers/purchase'],
    ['POST', '/v1/whatsapp/phone-numbers/purchase'],
    ['GET', '/v1/api-keys'],
    ['POST', '/v1/api-keys'],
    ['DELETE', '/v1/api-keys/key1'],
  ] as const)('%s %s → plan message', (method, path) => {
    const decision = checkEndpoint(method, path);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('hard-block');
      expect(decision.message).toBe(PLAN_MESSAGE);
      expect(decision.message).toContain('CreatorOS app');
    }
  });

  it('hard blocks win even with query strings and trailing slashes', () => {
    expect(checkEndpoint('POST', '/v1/profiles/').allowed).toBe(false);
    expect(checkEndpoint('DELETE', '/v1/profiles/abc?force=true').allowed).toBe(false);
  });

  it('profile READ stays allowed while create/delete are blocked', () => {
    expect(checkEndpoint('GET', '/v1/profiles').allowed).toBe(true);
    expect(checkEndpoint('POST', '/v1/profiles').allowed).toBe(false);
  });
});
