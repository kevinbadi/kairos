import { describe, expect, it } from 'vitest';
import { mdToAnsi } from '../src/ui/markdown.js';

describe('terminal rendering of replies', () => {
  it('turns **bold** into ANSI bold — no raw asterisks survive', () => {
    const out = mdToAnsi('Your **best post** did 12k views');
    expect(out).not.toContain('**');
    expect(out).toContain('\x1b[1mbest post\x1b[0m');
  });

  it('converts headers, bullets, code and links', () => {
    const out = mdToAnsi(['# Weekly report', '- **TikTok**: up 4%', 'Run `npm start` then see [docs](https://x.co)'].join('\n'));
    expect(out).not.toContain('# ');
    expect(out).not.toContain('**');
    expect(out).not.toMatch(/\[docs\]\(/);
    expect(out).toContain('• ');
    expect(out).toContain('\x1b[1mWeekly report\x1b[0m');
    expect(out).toContain('\x1b[38;2;0;229;255mnpm start\x1b[0m');
    expect(out).toContain('docs \x1b[2m(https://x.co)\x1b[0m');
  });

  it('leaves plain text and bare URLs untouched', () => {
    const text = 'Followers up 210 this week. Details: https://example.com/report';
    expect(mdToAnsi(text)).toBe(text);
  });

  it('italics via single asterisks render as ANSI italic', () => {
    const out = mdToAnsi('this is *really* good');
    expect(out).toContain('\x1b[3mreally\x1b[0m');
    expect(out).not.toContain('*really*');
  });
});
