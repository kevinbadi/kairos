import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyState,
  isInterviewComplete,
  loadState,
  markStepDone,
  nextStep,
  saveState,
  INTERVIEW_STEPS,
  type InterviewState,
} from '../src/onboarding/state.js';
import { parseProducts, renderBrandMd, renderProfilesMd, renderSetupPrompt } from '../src/onboarding/render.js';

async function tmpStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kairos-test-'));
  return join(dir, 'kairos', '.setup-state.json');
}

describe('interview persistence & resume', () => {
  it('starts empty with the agency-or-creator question first, then the key', () => {
    const state = emptyState();
    expect(nextStep(state)).toBe('mode');
    expect(isInterviewComplete(state)).toBe(false);
    markStepDone(state, 'mode');
    expect(nextStep(state)).toBe('key');
  });

  it('records agency mode with client labels but never the keys themselves', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    state.answers.mode = 'agency';
    state.answers.clientLabels = ['Acme Fitness', 'Bolt Coffee'];
    markStepDone(state, 'mode');
    await saveState(path, state);
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('Acme Fitness');
    expect(raw).not.toMatch(/sk_[0-9a-f]/i);
    const resumed = await loadState(path);
    expect(resumed.answers.mode).toBe('agency');
    expect(nextStep(resumed)).toBe('key');
  });

  it('persists every step and resumes from the next one', async () => {
    const path = await tmpStatePath();
    const state = emptyState();
    markStepDone(state, 'mode');
    markStepDone(state, 'key');
    markStepDone(state, 'brand');
    state.answers.brand = {
      about: 'Fitness coaching',
      products: [{ link: 'https://coach.example/buy', description: '1:1 programs' }],
      voiceAdjectives: ['direct', 'warm', 'practical'],
      voiceNever: 'corporate',
      emojiPolicy: 'none',
      hashtagPolicy: 'none',
      exampleCaption: 'Show up. Again.',
      audience: 'busy parents',
      competitors: ['@bigcoach'],
    };
    await saveState(path, state);

    // Simulate the process being killed and re-run.
    const resumed = await loadState(path);
    expect(resumed.completed).toEqual(['mode', 'key', 'brand']);
    expect(nextStep(resumed)).toBe('profiles');
    expect(resumed.answers.brand?.products[0]?.link).toBe('https://coach.example/buy');
  });

  it('is complete only after every step, in the spec order', () => {
    const state = emptyState();
    for (const step of INTERVIEW_STEPS) {
      expect(isInterviewComplete(state)).toBe(false);
      markStepDone(state, step);
    }
    expect(isInterviewComplete(state)).toBe(true);
    expect(nextStep(state)).toBeNull();
  });

  it('survives a corrupt state file by starting over', async () => {
    const path = await tmpStatePath();
    const state: InterviewState = emptyState();
    await saveState(path, state);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    const recovered = await loadState(path);
    expect(recovered.completed).toEqual([]);
  });
});

describe('brand pack rendering', () => {
  const brand = {
    about: 'Streetwear drops',
    products: [
      { link: 'https://shop.example/drop', description: 'Limited hoodies' },
      { description: 'Styling service (no link yet)' },
    ],
    voiceAdjectives: ['bold', 'scarce', 'playful'],
    voiceNever: 'thirsty',
    emojiPolicy: 'sparingly (max one per caption)',
    hashtagPolicy: 'a few relevant ones (2-4)',
    exampleCaption: '48 hours. Then gone.',
    audience: 'sneakerheads 18-30',
    competitors: ['@rivalbrand', '@otherbrand'],
  };

  it('everything Kairos writes later flows from BRAND.md', () => {
    const md = renderBrandMd(brand);
    expect(md).toContain('bold, scarce, playful');
    expect(md).toContain('Never: thirsty');
    expect(md).toContain('Limited hoodies — https://shop.example/drop');
    expect(md).toContain('Styling service (no link yet)');
    expect(md).toContain('@rivalbrand');
    expect(md).toContain('sneakerheads 18-30');
    expect(md).toContain('48 hours. Then gone.');
  });

  it('parses "link, explainer" rows — with and without links', () => {
    const products = parseProducts(
      [
        'https://shop.example/guide, my $29 training guide',
        'coach.example/call, free strategy call',
        'merch drop coming in Q4, no link yet',
      ].join('\n'),
    );
    expect(products[0]).toEqual({ link: 'https://shop.example/guide', description: 'my $29 training guide' });
    expect(products[1]).toEqual({ link: 'https://coach.example/call', description: 'free strategy call' });
    expect(products[2]?.link).toBeUndefined();
    expect(products[2]?.description).toContain('merch drop');
  });

  it('the setup prompt makes the agent act on every questionnaire answer', () => {
    const state: InterviewState = {
      completed: [],
      answers: {
        brand: { ...brand },
        funnel: {
          enabled: true,
          keywords: ['GUIDE'],
          dmMessage: 'here you go!',
          link: 'https://shop.example/drop',
          accountIds: ['acc1'],
          scope: 'account-wide',
        },
        engagement: { persona: 'Maya — warm, punchy', objective: 'book-calls', objectiveDetail: 'https://cal.com/x' },
        pathway: { automationTarget: 'railway', timezone: 'America/Toronto' },
      },
    };
    const prompt = renderSetupPrompt(state);
    expect(prompt).toContain('kairos/kairos.json');
    expect(prompt).toContain('"GUIDE"');
    expect(prompt).toContain('railway');
    expect(prompt).toContain('@rivalbrand');
    expect(prompt).toMatch(/confirmation before it goes live/i);
    expect(prompt).toMatch(/follower stats/i);
    // funnel/engagement tasks disappear when not configured
    const bare = renderSetupPrompt({ completed: [], answers: {} });
    expect(bare).not.toContain('comment-to-DM funnel');
    expect(bare).not.toContain('persona');
  });

  it('renders the profile map with account IDs', () => {
    const md = renderProfilesMd([
      { _id: 'acc1', platform: 'tiktok', username: 'brand.tt' },
      { _id: 'acc2', platform: 'instagram', username: 'brand.ig' },
    ]);
    expect(md).toContain('| TikTok | @brand.tt | `acc1` |');
    expect(md).toContain('| Instagram | @brand.ig | `acc2` |');
  });
});
