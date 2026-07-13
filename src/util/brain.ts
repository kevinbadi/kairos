import { spawnSync } from 'node:child_process';

/**
 * How Kairos thinks: the user's Claude plan via the logged-in claude CLI
 * (preferred — zero API keys), or ANTHROPIC_API_KEY.
 */
export type BrainStatus = 'plan' | 'api-key' | 'missing';

export function claudeCliAvailable(): boolean {
  try {
    return spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

export function detectBrain(): BrainStatus {
  if (process.env.ANTHROPIC_API_KEY) return 'api-key';
  if (claudeCliAvailable()) return 'plan';
  return 'missing';
}
