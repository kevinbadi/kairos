import { describe, expect, it } from 'vitest';
import { messagesUrl, verifyBrain } from '../src/util/brain.js';
import { toSettings } from '../src/config/brainSetup.js';

describe('custom brain (Anthropic-compatible API)', () => {
  it('builds the messages URL with or without /v1 on the base', () => {
    expect(messagesUrl('https://api.moonshot.ai/anthropic')).toBe(
      'https://api.moonshot.ai/anthropic/v1/messages',
    );
    expect(messagesUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/messages');
    expect(messagesUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/messages');
  });

  it('never lets the API key into workspace-bound settings', () => {
    const settings = toSettings({
      provider: 'custom',
      baseUrl: 'https://api.example.com/anthropic',
      apiKey: 'super-secret',
      model: 'some-model',
    });
    expect(JSON.stringify(settings)).not.toContain('super-secret');
    expect(settings).toEqual({
      provider: 'custom',
      baseUrl: 'https://api.example.com/anthropic',
      model: 'some-model',
    });
  });

  it('verifyBrain reports a useful failure for an unreachable custom brain', async () => {
    const check = await verifyBrain({
      provider: 'custom',
      baseUrl: 'https://localhost:1',
      apiKey: 'k',
      model: 'm',
    });
    expect(check.ok).toBe(false);
    expect(check.via).toContain('m at');
    expect(check.detail).toBeTruthy();
  }, 25_000);
});
