import { describe, expect, it } from 'vitest';
import { buildPreviewScript } from '../src/ui/preview.js';

const base = {
  keyword: 'GUIDE',
  dmMessage: 'Here it is — thanks for the comment!',
  link: 'https://shop.example/guide',
  persona: 'Maya — warm, punchy, gym-friend energy',
  objective: 'book-calls' as const,
  objectiveDetail: 'https://cal.com/maya/15min',
};

describe('engagement preview script', () => {
  it('plays the funnel beat by beat: comment → keyword match → DM → conversation', () => {
    const script = buildPreviewScript(base);
    const text = script.map((l) => `${l.who}:${l.text}`).join('\n');
    expect(script[0]?.who).toBe('system');
    expect(text).toContain('commenter:"GUIDE"');
    expect(text).toContain('keyword matched');
    expect(text).toContain(base.dmMessage);
    expect(text).toContain(base.link);
    // escalation reminder is part of the preview
    expect(text).toContain('escalate');
  });

  it('the objective decides the closer', () => {
    const calls = buildPreviewScript(base);
    expect(calls.map((l) => l.text).join(' ')).toContain('https://cal.com/maya/15min');
    expect(calls.map((l) => l.text).join(' ')).toMatch(/call/i);

    const funnel = buildPreviewScript({ ...base, objective: 'funnel', objectiveDetail: 'https://app.example' });
    expect(funnel.map((l) => l.text).join(' ')).toContain('https://app.example');

    const freeValue = buildPreviewScript({ ...base, objective: 'free-value' });
    expect(freeValue.map((l) => l.text).join(' ')).toMatch(/free/i);

    const rapport = buildPreviewScript({ ...base, objective: 'rapport', objectiveDetail: undefined });
    expect(rapport.map((l) => l.text).join(' ')).toMatch(/working on/i);

    const other = buildPreviewScript({ ...base, objective: 'other', objectiveDetail: 'Get them onto the waitlist' });
    expect(other.map((l) => l.text).join(' ')).toContain('Get them onto the waitlist');
  });
});
