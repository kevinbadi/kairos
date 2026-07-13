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
import { renderBrandMd, renderProfilesMd } from '../src/onboarding/render.js';

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
      selling: '1:1 programs',
      voiceAdjectives: ['direct', 'warm', 'practical'],
      voiceNever: 'corporate',
      emojiPolicy: 'none',
      hashtagPolicy: 'none',
      exampleCaption: 'Show up. Again.',
      productLinks: ['https://coach.example/buy'],
      audience: 'busy parents',
      competitors: ['@bigcoach'],
    };
    await saveState(path, state);

    // Simulate the process being killed and re-run.
    const resumed = await loadState(path);
    expect(resumed.completed).toEqual(['mode', 'key', 'brand']);
    expect(nextStep(resumed)).toBe('profiles');
    expect(resumed.answers.brand?.productLinks).toEqual(['https://coach.example/buy']);
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
    selling: 'Limited hoodies',
    voiceAdjectives: ['bold', 'scarce', 'playful'],
    voiceNever: 'thirsty',
    emojiPolicy: 'sparingly (max one per caption)',
    hashtagPolicy: 'a few relevant ones (2-4)',
    exampleCaption: '48 hours. Then gone.',
    productLinks: ['https://shop.example/drop'],
    audience: 'sneakerheads 18-30',
    competitors: ['@rivalbrand', '@otherbrand'],
  };

  it('everything Kairos writes later flows from BRAND.md', () => {
    const md = renderBrandMd(brand);
    expect(md).toContain('bold, scarce, playful');
    expect(md).toContain('Never: thirsty');
    expect(md).toContain('https://shop.example/drop');
    expect(md).toContain('@rivalbrand');
    expect(md).toContain('sneakerheads 18-30');
    expect(md).toContain('48 hours. Then gone.');
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
