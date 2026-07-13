import { describe, expect, it } from 'vitest';
import { buildFunnelAutomation, describeFunnel } from '../src/automations/funnels.js';

const base = {
  platform: 'instagram',
  profileId: 'prof1',
  accountId: 'acc1',
  name: 'launch-funnel',
  keywords: ['LINK', 'GUIDE'],
  dmMessage: 'Here it is — thanks for the comment!',
  link: 'https://shop.example/guide',
};

describe('funnel config generation', () => {
  it('builds a valid comment-automation body from the interview answers', () => {
    const body = buildFunnelAutomation(base);
    expect(body).toMatchObject({
      profileId: 'prof1',
      accountId: 'acc1',
      name: 'launch-funnel',
      trigger: 'comment',
      keywords: ['LINK', 'GUIDE'],
      matchMode: 'contains',
      dmMessage: base.dmMessage,
      linkTracking: true,
    });
    expect(body.buttons).toEqual([
      { type: 'url', title: 'Get the link', url: 'https://shop.example/guide' },
    ]);
    // Account-wide: no post scoping fields.
    expect(body.platformPostId).toBeUndefined();
  });

  it('scopes to a single post when platformPostId + postId are given', () => {
    const body = buildFunnelAutomation({ ...base, platformPostId: 'ig_123', postId: 'post_abc' });
    expect(body.platformPostId).toBe('ig_123');
    expect(body.postId).toBe('post_abc');
  });

  it('requires postId alongside platformPostId', () => {
    expect(() => buildFunnelAutomation({ ...base, platformPostId: 'ig_123' })).toThrow(/postId/);
  });

  it('rejects non-IG/FB platforms', () => {
    expect(() => buildFunnelAutomation({ ...base, platform: 'twitter' })).toThrow(
      /Instagram and Facebook only/,
    );
  });

  it('enforces the 640-char DM limit when a link button is attached', () => {
    expect(() => buildFunnelAutomation({ ...base, dmMessage: 'x'.repeat(641) })).toThrow(/640/);
    expect(() => buildFunnelAutomation({ ...base, dmMessage: 'x'.repeat(640) })).not.toThrow();
  });

  it('truncates button titles to 20 chars', () => {
    const body = buildFunnelAutomation({ ...base, linkTitle: 'This title is way too long for a button' });
    expect(body.buttons?.[0]?.title.length).toBeLessThanOrEqual(20);
  });

  it('rejects an empty DM message and blank keywords', () => {
    expect(() => buildFunnelAutomation({ ...base, dmMessage: '  ' })).toThrow(/DM message/);
    expect(() => buildFunnelAutomation({ ...base, keywords: ['ok', ' '] })).toThrow(/non-empty/);
  });

  it('describes the funnel for human sign-off (keyword + DM copy visible)', () => {
    const description = describeFunnel(base);
    expect(description).toContain('"LINK"');
    expect(description).toContain(base.dmMessage);
    expect(description).toContain('https://shop.example/guide');
  });
});
