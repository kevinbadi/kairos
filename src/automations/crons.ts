/**
 * The whole point: all four pillars running on cron jobs. Kairos delegates
 * the mechanics (launchd plists on macOS, Docker scaffolds for Railway) to
 * `creatoros automations:create` — it already handles both pathways.
 * Kairos's layer: pick the crons, prepare the pipeline so scheduled runs
 * succeed with zero judgment gaps, create, verify, explain.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AutomationTarget } from '../config/kairosConfig.js';

export interface StarterCron {
  name: string;
  /** Strict 5-field cron (no MON/JAN names). */
  schedule: string;
  skill: string;
  pillar: 'content' | 'calendar' | 'engagement' | 'analytics';
  description: string;
}

/** The four starter crons offered during onboarding — one per pillar. */
export const STARTER_CRONS: StarterCron[] = [
  {
    name: 'daily-shortform',
    schedule: '0 10 * * *',
    skill: 'post-shortform',
    pillar: 'content',
    description:
      'Daily at 10:00 — pull the next clip from content-library/, caption it from the brand pack, post it to TikTok, Reels, and Shorts.',
  },
  {
    name: 'weekly-calendar',
    schedule: '0 17 * * 0',
    skill: 'schedule-posts',
    pillar: 'calendar',
    description:
      'Sundays at 17:00 — plan the coming week and schedule it. CreatorOS servers publish; nothing local needs to stay awake after scheduling.',
  },
  {
    name: 'engagement-sweep',
    schedule: '0 9,15,21 * * *',
    skill: 'respond-to-comments',
    pillar: 'engagement',
    description:
      'Three times a day — triage new comments and messages, reply on-brand, escalate the sensitive ones, keep the funnel fed.',
  },
  {
    name: 'weekly-analytics',
    schedule: '0 8 * * 1',
    skill: 'analytics-report',
    pillar: 'analytics',
    description:
      'Mondays at 08:00 — follower growth, best posts, competitor movement, and one concrete recommendation.',
  },
];

export const RAILWAY_SPEND_LIMIT_WARNING =
  'Before deploying to Railway: set a spend limit in the Anthropic Console ' +
  '(console.anthropic.com → Billing → Limits). The service runs an agent ' +
  'unattended — an uncapped key is an uncapped bill. The service also needs ' +
  'CREATOROS_API_KEY and ANTHROPIC_API_KEY set as environment variables.';

/** Build the argv for `creatoros automations:create` on either pathway. */
export function automationCreateArgs(cron: StarterCron, target: AutomationTarget): string[] {
  const args = [
    'automations:create',
    cron.name,
    '--schedule',
    cron.schedule,
    '--skill',
    cron.skill,
  ];
  if (target === 'railway') args.push('--target', 'railway');
  return args;
}

/**
 * The creatoros CLI looks for skills at `<cwd>/creatoros/skills/<skill>/SKILL.md`.
 * Kairos's skills live in `kairos/skills/` — write a shim that points the
 * scheduled agent run at the real playbook.
 */
export async function ensureCliSkillShim(workspaceRoot: string, skill: string): Promise<string> {
  const shimDir = join(workspaceRoot, 'creatoros', 'skills', skill);
  const shimPath = join(shimDir, 'SKILL.md');
  if (!existsSync(shimPath)) {
    await mkdir(shimDir, { recursive: true });
    await writeFile(
      shimPath,
      `# ${skill}\n\nRead \`kairos/skills/${skill}/SKILL.md\` in this workspace and execute today's run by its playbook. Read \`kairos/BRAND.md\`, \`kairos/PROFILES.md\`, and \`kairos/kairos.json\` first — never contradict them.\n`,
      'utf8',
    );
  }
  return shimPath;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCreatorosCli(args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['--no-install', 'creatoros', ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: String(error) }));
  });
}

/** Create one automation on the chosen pathway, shim included. */
export async function createAutomation(
  workspaceRoot: string,
  cron: StarterCron,
  target: AutomationTarget,
): Promise<CommandResult> {
  await ensureCliSkillShim(workspaceRoot, cron.skill);
  return runCreatorosCli(automationCreateArgs(cron, target), workspaceRoot);
}

/** Verify automations are actually loaded, not just recorded. */
export async function verifyAutomations(workspaceRoot: string): Promise<CommandResult> {
  return runCreatorosCli(['automations:list'], workspaceRoot);
}
