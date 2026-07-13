import { describe, expect, it } from 'vitest';
import { routeArgs, usage } from '../src/index.js';

describe('arg routing', () => {
  it('routes `creatoros kairos`', () => {
    expect(routeArgs(['creatoros', 'kairos'])).toBe('kairos');
  });

  it('routes the `kai` alias', () => {
    expect(routeArgs(['creatoros', 'kai'])).toBe('kairos');
  });

  it('is case-insensitive on the command', () => {
    expect(routeArgs(['creatoros', 'Kairos'])).toBe('kairos');
    expect(routeArgs(['creatoros', 'KAI'])).toBe('kairos');
  });

  it('tolerates the npm `--` separator', () => {
    expect(routeArgs(['--', 'creatoros', 'kairos'])).toBe('kairos');
  });

  it('falls back to usage for anything else', () => {
    expect(routeArgs([])).toBe('usage');
    expect(routeArgs(['creatoros'])).toBe('usage');
    expect(routeArgs(['creatoros', 'init'])).toBe('usage');
    expect(routeArgs(['kairos'])).toBe('usage');
  });

  it('usage mentions both invocations', () => {
    expect(usage()).toContain('creatoros kairos');
    expect(usage()).toContain('creatoros kai');
  });
});
