/**
 * The API key never lands in any repo file. Interactive keys are persisted
 * to ~/.kairos/credentials.json (mode 0600); CREATOROS_API_KEY always wins.
 */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_DIR = join(homedir(), '.kairos');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function resolveApiKey(): Promise<string | null> {
  const fromEnv = process.env.CREATOROS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    const parsed = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8')) as { apiKey?: string };
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}

export interface StoredCredentials {
  /** The key for the workspace being run right now. */
  apiKey: string;
  /** Agency mode: one CreatorOS key per client brand. */
  keys?: Array<{ label: string; apiKey: string }>;
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await saveCredentials({ apiKey });
}

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  let existing: Partial<StoredCredentials> = {};
  if (existsSync(CREDENTIALS_PATH)) {
    try {
      existing = JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8')) as StoredCredentials;
    } catch {
      existing = {};
    }
  }
  const merged = { ...existing, ...credentials };
  await writeFile(CREDENTIALS_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await chmod(CREDENTIALS_PATH, 0o600);
}
