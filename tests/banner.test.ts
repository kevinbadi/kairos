import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIROS_CAPABILITY_SECTIONS, showIntro } from '../src/ui/banner.js';

describe('first-run intro', () => {
  let lines: string[];
  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ''));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('plays CreatorOS, then Kairos, then the capability checkmarks (plain fallback in non-TTY)', async () => {
    await showIntro();
    const output = lines.join('\n');
    const creatorosAt = output.indexOf('CREATOR OS');
    const kairosAt = output.indexOf('KAIROS');
    const checksAt = output.indexOf('✔');
    expect(creatorosAt).toBeGreaterThanOrEqual(0);
    expect(kairosAt).toBeGreaterThan(creatorosAt);
    expect(checksAt).toBeGreaterThan(kairosAt);
    // every capability in every section gets its checkmark line
    for (const section of KAIROS_CAPABILITY_SECTIONS) {
      expect(output).toContain(section.heading);
      for (const item of section.items) {
        expect(output).toContain(`✔ ${item.name} — ${item.detail}`);
      }
    }
  });

  it('covers the capability surface: posting types, analytics, messaging matrix, agent skills', () => {
    const text = KAIROS_CAPABILITY_SECTIONS.map(
      (s) => `${s.heading} ${s.items.map((i) => `${i.name} ${i.detail}`).join(' ')}`,
    )
      .join(' ')
      .toLowerCase();
    // posting types
    for (const needle of ['shortform', 'longform', 'carousels', 'blog-style', 'threads', 'multiposting', 'scheduling']) {
      expect(text).toContain(needle);
    }
    // analytics
    expect(text).toContain('follower growth');
    expect(text).toContain('post analytics');
    // messaging & comments matrix
    expect(text).toContain('webhooks');
    expect(text).toContain('every platform but tiktok');
    expect(text).toContain('comment-to-dm');
    expect(text).toContain('facebook & instagram');
    // agent skills
    expect(text).toContain('kevbuildsapps');
    expect(text).toContain('tutorials');
    // branding
    expect(text).not.toMatch(/zernio/i);
  });
});
