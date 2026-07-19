import { describe, expect, it } from 'vitest';
import {
  filterActivity,
  isSetupAction,
  mergeActivity,
  summarizeActivity,
  type ActivityEntry,
} from '../src/util/activityLog.js';

const e = (overrides: Partial<ActivityEntry>): ActivityEntry => ({
  ts: '2026-07-18T12:00:00Z',
  workflow: 'engagement-sweep',
  action: 'reply_to_comment',
  outcome: 'sent',
  ...overrides,
});

describe('setup actions are not agent activity', () => {
  it('classifies workspace admin vs audience-facing work', () => {
    for (const action of ['create_cron_automation', 'delete_cron_automation', 'create_webhook', 'create_funnel', 'update_funnel']) {
      expect(isSetupAction(action)).toBe(true);
    }
    for (const action of ['reply_to_comment', 'send_message', 'create_post', 'like_comment', 'hide_comment']) {
      expect(isSetupAction(action)).toBe(false);
    }
  });

  it('summarize excludes setup actions from counters and the heatmap', () => {
    const now = new Date('2026-07-18T20:00:00Z');
    const summary = summarizeActivity(
      [
        e({ action: 'reply_to_comment' }),
        e({ action: 'send_message' }),
        e({ action: 'create_cron_automation', workflow: 'chat' }),
        e({ action: 'create_webhook', workflow: 'chat' }),
      ],
      now,
    );
    expect(summary.today.actions).toBe(2);
    expect(summary.today.replies).toBe(1);
    expect(summary.today.dms).toBe(1);
    expect(summary.heatmap.at(-1)).toEqual({ date: '2026-07-18', count: 2 });
    expect(summary.workflows).not.toContain('chat'); // only setup ran under 'chat'
  });
});

describe('merged activity (local + Railway worker)', () => {
  it('merges newest-first and dedupes identical entries from a shared workspace', () => {
    const local = [
      e({ ts: '2026-07-18T10:00:00Z', target: 'c1' }),
      e({ ts: '2026-07-18T08:00:00Z', target: 'c2' }),
    ];
    const worker = [
      e({ ts: '2026-07-18T12:00:00Z', target: 'c3' }),
      e({ ts: '2026-07-18T10:00:00Z', target: 'c1' }), // duplicate of local[0]
    ];
    const merged = mergeActivity(local, worker);
    expect(merged.map((entry) => entry.target)).toEqual(['c3', 'c1', 'c2']);
  });

  it('worker replies land in the same summary the heatmap reads', () => {
    const now = new Date('2026-07-18T20:00:00Z');
    const merged = mergeActivity(
      [e({ action: 'create_cron_automation', workflow: 'chat' })], // local: setup only
      [e({ ts: '2026-07-18T09:00:00Z', target: 'c9' })], // worker: the real reply
    );
    const summary = summarizeActivity(merged, now);
    expect(summary.today.replies).toBe(1);
    expect(summary.heatmap.at(-1)!.count).toBe(1);
  });

  it('filterActivity applies workflow/platform/outcome/limit on merged lists', () => {
    const merged = mergeActivity(
      [e({ platform: 'instagram' }), e({ ts: '2026-07-18T11:00:00Z', outcome: 'failed', platform: 'facebook', target: 'x' })],
      [],
    );
    expect(filterActivity(merged, { platform: 'instagram' })).toHaveLength(1);
    expect(filterActivity(merged, { outcome: 'failed' })[0]!.platform).toBe('facebook');
    expect(filterActivity(merged, { limit: 1 })).toHaveLength(1);
  });
});
