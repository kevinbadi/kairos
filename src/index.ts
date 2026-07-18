/**
 * Entry point. npm forwards positional args to the start script:
 *   npm start creatoros kairos   (alias: npm start creatoros kai)
 * First run (no kairos/ setup): the onboarding interview.
 * Every later run: load the saved setup and enter the Kairos REPL.
 * Setup is resumable — killing the process mid-interview and re-running
 * resumes where it left off.
 */
import { existsSync } from 'node:fs';
import { kairosPaths } from './paths.js';
import { loadConfig } from './config/kairosConfig.js';
import { loadState, isInterviewComplete } from './onboarding/state.js';
import { resolveApiKey } from './config/credentials.js';
import { CreatorOSClient } from './client/client.js';

export type Route = 'kairos' | 'dashboard' | 'usage';

/** Route on positional args: `creatoros kairos`, `creatoros kai`, `creatoros dashboard`. */
export function routeArgs(argv: string[]): Route {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index === -1) return 'usage';
  const command = (args[index + 1] ?? '').toLowerCase();
  if (command === 'kairos' || command === 'kai') return 'kairos';
  if (command === 'dashboard') return 'dashboard';
  return 'usage';
}

export function usage(): string {
  return [
    'Kairos — the CreatorOS agent.',
    '',
    'Usage:',
    '  npm start creatoros kairos    start Kairos (first run = onboarding interview)',
    '  npm start creatoros kai       same thing, shorter',
    '  npm start creatoros dashboard the Kairos dashboard — automations, workflows, analytics, chat in the browser',
    '  kai                           open a session from any terminal (run `npm link` once to enable)',
    '  kai dashboard                 same dashboard, from anywhere',
    '',
    'Sessions are independent conversations — open as many terminals as you like;',
    'they all share the same kairos/ workspace, brand pack, and credentials.',
  ].join('\n');
}

async function main(): Promise<void> {
  const route = routeArgs(process.argv.slice(2));
  if (route === 'usage') {
    console.log(usage());
    return;
  }

  if (route === 'dashboard') {
    await runDashboard();
    return;
  }

  const paths = kairosPaths();
  const state = await loadState(paths.setupStateJson);
  const setupDone =
    existsSync(paths.kairosDir) && existsSync(paths.configJson) && isInterviewComplete(state);

  if (!setupDone) {
    // First run: CreatorOS animation → Kairos animation → capability
    // checkmarks → the interview. Resumed interviews skip the show.
    if (state.completed.length === 0) {
      const { showIntro } = await import('./ui/banner.js');
      await showIntro();
    }
    const { runInterview } = await import('./onboarding/interview.js');
    const { client, config } = await runInterview(paths.root);
    const { runRepl } = await import('./agent/repl.js');
    console.log("\nSetup complete. You're talking to Kai now — try \"how do my socials look?\"");
    console.log(
      '\x1b[2mTip: run `npm link` once in this repo and `kai` opens a session from any terminal. ' +
        'Each terminal is its own conversation; they all share this workspace.\x1b[0m',
    );
    await runRepl(client, config, paths.root);
    return;
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    console.error(
      'No CreatorOS API key found. Set CREATOROS_API_KEY or re-run setup (delete kairos/.setup-state.json).',
    );
    process.exitCode = 1;
    return;
  }
  const client = new CreatorOSClient({ apiKey });
  const config = await loadConfig(paths.configJson);
  const { runRepl } = await import('./agent/repl.js');
  await runRepl(client, config, paths.root);
}

/** `kai dashboard` — mission control in the browser, over the same workspace. */
async function runDashboard(): Promise<void> {
  const paths = kairosPaths();
  const apiKey = await resolveApiKey();
  if (!apiKey || !existsSync(paths.configJson)) {
    console.error(
      'The dashboard needs a finished setup. Run `npm start creatoros kairos` first — the dashboard reads everything the onboarding writes.',
    );
    process.exitCode = 1;
    return;
  }
  const client = new CreatorOSClient({ apiKey });
  const config = await loadConfig(paths.configJson);
  const { startDashboard, openBrowser } = await import('./dashboard/server.js');
  const { url } = await startDashboard(client, config, paths.root);
  console.log(`\nKairos dashboard is live: ${url}`);
  console.log('\x1b[2mAutomations, workflows, analytics, and Kai chat — all in the browser. Ctrl-C stops it.\x1b[0m');
  openBrowser(url);
  // Keep the process alive until the user stops it.
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\nDashboard stopped. Your automations keep running on their schedules.');
      resolve();
    });
  });
}

// Only run when executed directly (not when imported by tests).
const invokedDirectly = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (invokedDirectly) {
  main().catch((error) => {
    if ((error as Error).name === 'ExitPromptError') {
      // Ctrl-C mid-interview — state is saved; next run resumes.
      console.log('\nPaused. Run `npm start creatoros kairos` to pick up where you left off.');
      return;
    }
    console.error(`Kairos crashed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
