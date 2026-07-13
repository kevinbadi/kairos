import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIROS_CAPABILITIES, showIntro } from '../src/ui/banner.js';

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
    // every capability gets its checkmark line
    for (const item of KAIROS_CAPABILITIES) {
      expect(output).toContain(`✔ ${item.name} — ${item.detail}`);
    }
  });

  it('the checklist covers the four pillars and the guardrails', () => {
    const text = KAIROS_CAPABILITIES.map((c) => `${c.name} ${c.detail}`).join(' ').toLowerCase();
    expect(text).toContain('post');
    expect(text).toContain('automations');
    expect(text).toContain('auto-replies');
    expect(text).toContain('analytics');
    expect(text).toContain('allowlist');
    expect(text).not.toMatch(/zernio/i);
  });
});
