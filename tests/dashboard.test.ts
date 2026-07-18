import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { routeArgs } from '../src/index.js';
import { FUTURE_WORKFLOWS, workflowCatalog, describeSchedule } from '../src/dashboard/workflows.js';
import { STARTER_CRONS } from '../src/automations/crons.js';

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
    const daily = catalog.find((w) => w.id === 'daily-shortform');
    const weekly = catalog.find((w) => w.id === 'weekly-analytics');
    expect(daily?.status).toBe('live');
    expect(weekly?.status).toBe('available');
  });

  it('covers all four pillars plus the content-marketing roadmap', () => {
    const catalog = workflowCatalog('');
    expect(catalog.filter((w) => w.status !== 'coming-soon')).toHaveLength(STARTER_CRONS.length);
    expect(catalog.filter((w) => w.status === 'coming-soon')).toHaveLength(FUTURE_WORKFLOWS.length);
    expect(FUTURE_WORKFLOWS.length).toBeGreaterThanOrEqual(8);
  });

  it('renders schedules as sentences, not cron syntax', () => {
    expect(describeSchedule('0 10 * * *')).toBe('daily at 10:00');
    expect(describeSchedule('5 4 * * 2')).toContain('cron');
  });
});

describe('dashboard page', () => {
  it('never shows the internal vendor name and carries every view', async () => {
    const html = await readFile(join(process.cwd(), 'templates', 'dashboard.html'), 'utf8');
    expect(html.toLowerCase()).not.toContain('zernio');
    for (const view of ['view-overview', 'view-automations', 'view-workflows', 'view-analytics', 'view-chat']) {
      expect(html).toContain(view);
    }
    expect(html).toContain('CreatorOS');
    expect(html).toContain('/api/chat');
  });
});
