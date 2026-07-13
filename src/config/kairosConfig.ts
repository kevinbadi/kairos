import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** Which of the two automation pathways this client runs on. */
export type AutomationTarget = 'local' | 'railway';

export interface FunnelConfig {
  enabled: boolean;
  keywords: string[];
  matchMode: 'exact' | 'contains';
  dmMessage: string;
  link?: string;
  /** 'account-wide' or a specific platformPostId per funnel. */
  scope: 'account-wide' | 'per-post';
  /** Which connected IG/FB account ids the funnel applies to. */
  accountIds: string[];
}

export interface AutoReplyConfig {
  enabled: boolean;
  platforms: string[];
  tone?: string;
  /** Topics that always escalate to the human instead of auto-replying. */
  escalate: string[];
}

export interface KairosConfig {
  version: 1;
  automationTarget: AutomationTarget;
  timezone: string;
  profileId?: string;
  funnel?: FunnelConfig;
  autoReplies?: {
    comments: AutoReplyConfig;
    messages: AutoReplyConfig;
  };
  onboardedAt?: string;
}

export const DEFAULT_ESCALATION_TOPICS = ['refunds', 'complaints', 'legal'];

export function defaultConfig(): KairosConfig {
  return {
    version: 1,
    automationTarget: 'local',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  };
}

export async function loadConfig(path: string): Promise<KairosConfig | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as KairosConfig;
}

export async function saveConfig(path: string, config: KairosConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Resolve the automation pathway. Defaults to local when unset. */
export function resolveAutomationTarget(config: KairosConfig | null): AutomationTarget {
  return config?.automationTarget === 'railway' ? 'railway' : 'local';
}
