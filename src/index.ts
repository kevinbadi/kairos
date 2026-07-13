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

export type Route = 'kairos' | 'usage';

/** Route on positional args: `creatoros kairos` or `creatoros kai`. */
export function routeArgs(argv: string[]): Route {
  const args = argv.filter((a) => a !== '--');
  const index = args.indexOf('creatoros');
  if (index === -1) return 'usage';
  const command = (args[index + 1] ?? '').toLowerCase();
  return command === 'kairos' || command === 'kai' ? 'kairos' : 'usage';
}

export function usage(): string {
  return [
    'Kairos — the CreatorOS agent.',
    '',
    'Usage:',
    '  npm start creatoros kairos    start Kairos (first run = onboarding interview)',
    '  npm start creatoros kai       same thing, shorter',
  ].join('\n');
}

async function main(): Promise<void> {
  const route = routeArgs(process.argv.slice(2));
  if (route !== 'kairos') {
    console.log(usage());
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
