import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeArgs } from '../src/index.js';
import { FUTURE_WORKFLOWS, workflowCatalog, describeSchedule } from '../src/dashboard/workflows.js';
import { STARTER_CRONS } from '../src/automations/crons.js';
import {
  appendActivity,
  readActivity,
  summarizeActivity,
  isLoggedAction,
  describeToolCall,
  type ActivityEntry,
} from '../src/util/activityLog.js';

describe('dashboard routing', () => {
  it('`creatoros dashboard` routes to the dashboard', () => {
    expect(routeArgs(['creatoros', 'dashboard'])).toBe('dashboard');
    expect(routeArgs(['--', 'creatoros', 'dashboard'])).toBe('dashboard');
  });

  it('chat routes are untouched', () => {
    expect(routeArgs(['creatoros', 'kairos'])).toBe('kairos');
    expect(routeArgs(['creatoros', 'kai'])).toBe('kairos');
    expect(routeArgs(['creatoros', 'nope'])).toBe('usage');
  });
});

describe('workflow catalog', () => {
  it('marks a pillar workflow live only when the automations list shows it', () => {
    const catalog = workflowCatalog('Loaded automations:\n  daily-shortform  0 10 * * *\n');
    expect(catalog.find((w) => w.id === 'daily-shortform')?.status).toBe('live');
    expect(catalog.find((w) => w.id === 'weekly-analytics')?.status).toBe('available');
  });

  it('covers all four pillars plus the content-marketing roadmap', () => {
    const catalog = workflowCatalog('');
    expect(catalog.filter((w) => w.status !== 'coming-soon')).toHaveLength(STARTER_CRONS.length);
    expect(catalog.filter((w) => w.status === 'coming-soon')).toHaveLength(FUTURE_WORKFLOWS.length);
  });

  it('renders schedules as sentences, not cron syntax', () => {
    expect(describeSchedule('0 10 * * *')).toBe('daily at 10:00');
    expect(describeSchedule('5 4 * * 2')).toContain('cron');
  });
});

describe('activity log', () => {
  const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
    ts: new Date().toISOString(),
    workflow: 'chat',
    action: 'reply_to_comment',
    outcome: 'sent',
    ...over,
  });

  it('appends JSONL and reads newest-first with filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-log-'));
    await appendActivity(root, entry({ action: 'reply_to_comment', platform: 'instagram' }));
    await appendActivity(root, entry({ action: 'send_message', platform: 'facebook', outcome: 'failed', error: 'boom' }));
    const raw = await readFile(join(root, 'logs', 'activity.jsonl'), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(2);

    const all = await readActivity(root);
    expect(all[0]?.action).toBe('send_message'); // newest first
    expect(await readActivity(root, { outcome: 'failed' })).toHaveLength(1);
    expect(await readActivity(root, { platform: 'instagram' })).toHaveLength(1);
    expect((await readActivity(root, { outcome: 'failed' }))[0]?.error).toBe('boom');
  });

  it('summarizes counters, per-workflow stats, and a 365-day heatmap', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const summary = summarizeActivity(
      [
        entry({ ts: '2026-07-18T10:00:00Z', action: 'reply_to_comment' }),
        entry({ ts: '2026-07-18T09:00:00Z', action: 'send_message', outcome: 'failed', workflow: 'engagement-sweep' }),
        entry({ ts: '2026-07-14T09:00:00Z', action: 'create_post', workflow: 'daily-shortform' }),
        entry({ ts: '2025-01-01T09:00:00Z', action: 'create_post' }), // outside the year window
      ],
      now,
    );
    expect(summary.today.replies).toBe(1);
    expect(summary.today.failed).toBe(1);
    expect(summary.week.posts).toBe(1);
    expect(summary.heatmap).toHaveLength(365);
    expect(summary.heatmap.at(-1)?.count).toBe(2);
    expect(summary.perWorkflow.find((w) => w.workflow === 'engagement-sweep')?.failed).toBe(1);
    expect(summary.lastAction?.action).toBe('reply_to_comment');
  });

  it('logs actions, not reads', () => {
    expect(isLoggedAction('reply_to_comment')).toBe(true);
    expect(isLoggedAction('create_post')).toBe(true);
    expect(isLoggedAction('list_accounts')).toBe(false);
    expect(isLoggedAction('get_post')).toBe(false);
  });

  it('extracts platform and target from tool args', () => {
    expect(describeToolCall({ platform: 'instagram', commentId: 'c1' })).toEqual({ platform: 'instagram', target: 'c1' });
    expect(describeToolCall({ platforms: [{ platform: 'tiktok' }, { platform: 'youtube' }] }).platform).toBe('tiktok,youtube');
  });

  it('a corrupt log is skipped, never fatal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kairos-log-'));
    await appendActivity(root, entry({}));
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(root, 'logs', 'activity.jsonl'), 'not json\n', 'utf8');
    await appendActivity(root, entry({ action: 'send_message' }));
    expect(await readActivity(root)).toHaveLength(2);
  });
});

describe('agent understanding', () => {
  const BRAND_MD = `# Brand Pack

Kairos reads this before writing anything.

## What this brand is about

Fitness coaching for busy parents.

## What we sell — products, services & CTA destinations

- 1:1 coaching program — https://coach.example/apply
- Free meal-prep guide _(no link yet)_

## Voice

- Sounds like: direct, warm, practical
- Never: corporate
- Emoji policy: none
- Hashtag policy: none

## Target audience

Busy parents 30-45 who want results in 30 minutes a day.

## Competitors to watch

- @bigcoach
- @otherbrand
`;

  it('parses BRAND.md back into the structure the agent understands', async () => {
    const { parseBrandMd } = await import('../src/dashboard/understanding.js');
    const brand = parseBrandMd(BRAND_MD);
    expect(brand.about).toBe('Fitness coaching for busy parents.');
    expect(brand.offers).toEqual([
      { description: '1:1 coaching program', link: 'https://coach.example/apply' },
      { description: 'Free meal-prep guide' },
    ]);
    expect(brand.voice.soundsLike).toEqual(['direct', 'warm', 'practical']);
    expect(brand.voice.never).toBe('corporate');
    expect(brand.audience).toContain('Busy parents');
    expect(brand.competitors).toEqual(['@bigcoach', '@otherbrand']);
  });

  it('an edited/unrecognized brand file degrades to nulls, never throws', async () => {
    const { parseBrandMd } = await import('../src/dashboard/understanding.js');
    const brand = parseBrandMd('just some notes the user wrote\nno headings at all');
    expect(brand.about).toBeNull();
    expect(brand.offers).toEqual([]);
    expect(brand.competitors).toEqual([]);
  });

  it('derives live KPIs from the activity log, objective-aware', async () => {
    const { deriveKpis } = await import('../src/dashboard/understanding.js');
    const now = new Date('2026-07-18T12:00:00Z');
    const summary = summarizeActivity(
      [
        { ts: '2026-07-18T10:00:00Z', workflow: 'chat', action: 'reply_to_comment', outcome: 'sent' },
        { ts: '2026-07-17T10:00:00Z', workflow: 'chat', action: 'send_message', outcome: 'sent' },
        { ts: '2026-07-16T10:00:00Z', workflow: 'chat', action: 'send_message', outcome: 'failed', error: 'x' },
      ],
      now,
    );
    const kpis = deriveKpis(
      {
        version: 1,
        automationTarget: 'local',
        timezone: 'UTC',
        engagementAgent: { persona: 'Maya', objective: 'book-calls' },
      },
      summary,
    );
    expect(kpis.find((k) => k.label === 'Comments answered')?.value).toBe('1');
    expect(kpis.find((k) => k.label === 'Failure rate')?.value).toBe('33%');
    expect(kpis.find((k) => k.label === 'Failure rate')?.state).toBe('bad');
    expect(kpis.find((k) => k.label === 'Link shares (calls)')).toBeTruthy();
  });
});

describe('dashboard UI shell', () => {
  it('ships the tokens, all panels, and never the internal vendor name', async () => {
    const pub = join(process.cwd(), 'dashboard', 'public');
    const html = await readFile(join(pub, 'index.html'), 'utf8');
    const css = await readFile(join(pub, 'theme.css'), 'utf8');
    const registry = await readFile(join(pub, 'panels', 'registry.js'), 'utf8');
    for (const text of [html, css, registry]) expect(text.toLowerCase()).not.toContain('zernio');
    expect(css).toContain('--accent: #22d3ee');
    expect(css).toContain("html[data-theme='light']");
    expect(css).toContain('#0b1220');
    for (const panel of ['overview', 'understanding', 'automations', 'brand', 'training', 'logs', 'chat']) {
      expect(registry).toContain(`./${panel}.js`);
    }
  });
});
