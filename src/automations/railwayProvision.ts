/**
 * Programmatic Railway provisioning — the finish step of onboarding runs
 * this so the user never touches railway.app beyond creating the account
 * and pasting a token. Drives the Railway CLI through `npx -y
 * @railway/cli` (no global install), uploads the LOCAL workspace with
 * `railway up` (gitignored kairos/ ships — a GitHub deploy would miss it),
 * and points the build at Dockerfile.worker via RAILWAY_DOCKERFILE_PATH.
 *
 * Every step degrades to an honest error string — provisioning failure
 * never fails onboarding; the chat path (provision-railway skill) is the
 * retry vehicle.
 */
import { spawn } from 'node:child_process';
import { fetchWorkerState } from '../dashboard/worker.js';

export interface ProvisionInputs {
  workspaceRoot: string;
  railwayToken: string;
  timezone: string;
  workerToken: string;
  creatorosKey: string;
  ai: { kind: 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'; value: string };
  projectName?: string;
  /** Health-poll tuning — defaults suit a real Railway build; tests shrink them. */
  healthAttempts?: number;
  healthDelayMs?: number;
}

export interface ProvisionResult {
  ok: boolean;
  url?: string;
  serviceId?: string;
  /** Health check verified — false can still mean "build in progress". */
  healthy: boolean;
  error?: string;
}

/** Variable assignments for the service — pure, for tests (values masked there). */
export function provisionVariableArgs(inputs: ProvisionInputs): string[] {
  return [
    'variables',
    '--set', `CREATOROS_API_KEY=${inputs.creatorosKey}`,
    '--set', `${inputs.ai.kind}=${inputs.ai.value}`,
    '--set', `KAIROS_WORKER_TOKEN=${inputs.workerToken}`,
    '--set', `TZ=${inputs.timezone}`,
    '--set', 'RAILWAY_DOCKERFILE_PATH=Dockerfile.worker',
    '--skip-deploys',
  ];
}

/** Pull the generated domain out of `railway domain` output. */
export function parseDomain(output: string): string | null {
  const match = output.match(/(?:https?:\/\/)?([a-z0-9-]+\.up\.railway\.app)/i);
  return match ? `https://${match[1]}` : null;
}

/** Pull the linked project name out of `railway status --json` output. */
export function parseProjectName(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { name?: string; project?: { name?: string } };
    const name = parsed.project?.name ?? parsed.name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

/** Pull the service id out of `railway status --json` output. */
export function parseServiceId(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as {
      services?: { edges?: Array<{ node?: { id?: string } }> };
    };
    const id = parsed.services?.edges?.[0]?.node?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    const match = output.match(/"serviceId"\s*:\s*"([^"]+)"/);
    return match ? match[1]! : null;
  }
}

function runRailway(args: string[], cwd: string, token: string, timeoutMs = 600_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['-y', '@railway/cli@latest', ...args], {
      cwd,
      env: { ...process.env, RAILWAY_API_TOKEN: token, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(error) });
    });
  });
}

/**
 * The whole dance: init → variables → up → domain → status → health poll.
 * onProgress narrates each step for the interview's output.
 */
export async function provisionRailwayWorker(
  inputs: ProvisionInputs,
  onProgress: (line: string) => void,
  runner: typeof runRailway = runRailway,
): Promise<ProvisionResult> {
  const { workspaceRoot: root, railwayToken: token } = inputs;
  const fail = (step: string, detail: string): ProvisionResult => ({
    ok: false,
    healthy: false,
    error: `${step}: ${detail.trim().slice(0, 300) || 'no output'}`,
  });

  const wanted = inputs.projectName ?? 'kairos-worker';

  // A stale link — an earlier attempt, or some unrelated app this folder
  // once deployed — is the classic way keys and a workspace land on the
  // WRONG project. Check what this folder is linked to before creating.
  const pre = await runner(['status', '--json'], root, token, 60_000);
  const linked = parseProjectName(pre.stdout);
  if (linked && linked !== wanted) {
    onProgress(`This folder was linked to "${linked}" — unlinking; the worker gets its own project.`);
    await runner(['unlink'], root, token, 60_000); // best-effort; verified below
  }

  onProgress('Creating the Railway project…');
  const init = await runner(['init', '--name', wanted], root, token, 120_000);
  // "already exists"-style failures are fine ONLY when the link check
  // below confirms we ended up on OUR project.
  if (init.code !== 0 && !/already|exists|linked/i.test(init.stdout + init.stderr)) {
    return fail('railway init', init.stderr || init.stdout);
  }

  // Never deploy onto a project that isn't ours — verify the link by name.
  const post = await runner(['status', '--json'], root, token, 60_000);
  const nowLinked = parseProjectName(post.stdout);
  if (nowLinked && nowLinked !== wanted) {
    return fail(
      'railway link',
      `this folder ended up linked to "${nowLinked}" instead of "${wanted}". If the token is project-scoped, replace it with an ACCOUNT token from railway.app/account/tokens; otherwise run \`railway unlink\` in the workspace and retry.`,
    );
  }

  onProgress('Setting the service variables (keys, worker token, timezone)…');
  const vars = await runner(provisionVariableArgs(inputs), root, token, 120_000);
  if (vars.code !== 0) return fail('railway variables', vars.stderr || vars.stdout);

  onProgress('Uploading this workspace and starting the build (a few minutes)…');
  const up = await runner(['up', '--detach'], root, token);
  if (up.code !== 0) return fail('railway up', up.stderr || up.stdout);

  onProgress('Generating the public domain…');
  const domain = await runner(['domain'], root, token, 120_000);
  const url = parseDomain(domain.stdout + domain.stderr);
  if (!url) return fail('railway domain', domain.stderr || domain.stdout);

  const status = await runner(['status', '--json'], root, token, 120_000);
  const serviceId = parseServiceId(status.stdout) ?? undefined;

  onProgress(`Worker will live at ${url} — waiting for the build to come up…`);
  const attempts = inputs.healthAttempts ?? 12;
  const delayMs = inputs.healthDelayMs ?? 15_000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = await fetchWorkerState(url, inputs.workerToken);
    if (state.reachable) {
      return { ok: true, url, serviceId, healthy: true };
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    onProgress(`  still building… (${Math.round(((attempt + 1) * delayMs) / 1000)}s)`);
  }
  // Domain exists, build still going — success with a caveat, not a failure.
  return { ok: true, url, serviceId, healthy: false };
}
