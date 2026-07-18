/**
 * The onboarding interview — Kairos holding the user's hand on day one.
 * Conversational, one question at a time; every answer lands in a file
 * Kairos reads forever after. Resumable: state saves after every step.
 */
import { confirm, input, password, select } from '@inquirer/prompts';
import { detectBrain, type BrainConfig } from '../util/brain.js';
import { promptBrainChoice, toSettings, verifyBrainInteractive } from '../config/brainSetup.js';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreatorOSClient, isValidKeyShape } from '../client/client.js';
import { platformLabel } from '../client/platformMatrix.js';
import type { SocialAccount } from '../client/types.js';
import { maskKey } from '../util/mask.js';
import { kairosPaths, type KairosPaths } from '../paths.js';
import { resolveApiKey, saveApiKey, saveCredentials } from '../config/credentials.js';
import { saveConfig, type KairosConfig } from '../config/kairosConfig.js';
import {
  isStepDone,
  loadState,
  markStepDone,
  saveState,
  type BrandAnswers,
  type InterviewState,
} from './state.js';
import {
  parseProducts,
  renderBrandMd,
  renderProfilesMd,
  renderSetupPrompt,
  renderSetupSummary,
  renderTutorialsMd,
} from './render.js';
import { askBlock, askList } from '../ui/prompts.js';
import { RAILWAY_SPEND_LIMIT_WARNING } from '../automations/crons.js';

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

function say(text: string): void {
  console.log(`\n${text}`);
}

export interface InterviewResult {
  client: CreatorOSClient;
  config: KairosConfig;
}

export async function runInterview(root: string = process.cwd()): Promise<InterviewResult> {
  const paths = kairosPaths(root);
  await mkdir(paths.kairosDir, { recursive: true });
  const state = await loadState(paths.setupStateJson);
  const resuming = state.completed.length > 0;

  say(
    resuming
      ? `Kai here — picking up where we left off. ${state.completed.length} step(s) already done.`
      : "Hey — I'm Kai. I run your social presence on CreatorOS: posting at scale, automations, replies, analytics. Before I touch anything, brief me. This takes about five minutes and I'll remember all of it.",
  );

  // ---- The brain — if the Claude connection fails, the FIRST question
  // is which AI model to use (Claude SDK, or any OpenAI-compatible API).
  if (!isStepDone(state, 'brain')) {
    await stepBrain(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Creator or agency ----
  if (!isStepDone(state, 'mode')) {
    await stepMode(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Key(s) + accounts ----
  const client = await stepKey(paths, state);

  // ---- Step 2: brand pack ----
  if (!isStepDone(state, 'brand')) {
    state.answers.brand = await stepBrand();
    await writeFile(paths.brandMd, renderBrandMd(state.answers.brand), 'utf8');
    markStepDone(state, 'brand');
    await saveState(paths.setupStateJson, state);
    say(`Brand pack saved to kairos/BRAND.md — everything I write flows from it.`);
  }

  // ---- Step 3: profile map ----
  let accounts: SocialAccount[] = [];
  if (!isStepDone(state, 'profiles')) {
    accounts = await stepProfiles(client, paths, state);
  } else {
    accounts = (await client.listAccounts()).accounts;
  }

  // ---- Step 4: automation pathway ----
  if (!isStepDone(state, 'pathway')) {
    await stepPathway(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Step 5: finish in character ----
  const config = await stepFinish(client, paths, state, accounts);
  return { client, config };
}

async function stepMode(state: InterviewState): Promise<void> {
  const mode = await select({
    message: 'Creator or agency?',
    choices: [
      { name: 'Creator', value: 'creator' as const },
      { name: 'Agency', value: 'agency' as const },
    ],
  });
  state.answers.mode = mode;
  markStepDone(state, 'mode');
}

/** Collect and validate one key on a loop until it passes shape + live check. */
async function collectValidKey(promptMessage: string): Promise<{ key: string; client: CreatorOSClient }> {
  while (true) {
    const key = (await password({ message: promptMessage, mask: '*' })).trim();
    if (!isValidKeyShape(key)) {
      console.log(
        "That doesn't look like a CreatorOS API key (expected sk_ + 64 hex characters). Check the CreatorOS app under Settings → API Key.",
      );
      continue;
    }
    const client = new CreatorOSClient({ apiKey: key });
    process.stdout.write(`Checking ${maskKey(key)} against CreatorOS servers... `);
    const valid = await client.validateKey();
    if (!valid) {
      console.log('rejected. Double-check it in the CreatorOS app and paste it again.');
      continue;
    }
    console.log('valid.');
    return { key, client };
  }
}

const MAX_AGENCY_KEYS = 10;
const GET_KEY_URL = 'https://creatoros.ca';

/** Creator: one key. Agency: up to 10 keys, pick who we set up now. */
async function collectKeysInteractively(state: InterviewState): Promise<CreatorOSClient> {
  const plural = state.answers.mode === 'agency' ? '(s)' : '';
  const hasKeys = await confirm({
    message: `Do you have your CreatorOS API key${plural}?`,
    default: true,
  });
  if (!hasKeys) {
    say(`Get it at ${GET_KEY_URL} — then run me again and we pick up right here.`);
    process.exit(0);
  }

  if (state.answers.mode !== 'agency') {
    const { key, client } = await collectValidKey('Paste your CreatorOS API key:');
    await saveApiKey(key);
    return client;
  }

  const collected: Array<{ label: string; apiKey: string; client: CreatorOSClient }> = [];
  while (collected.length < MAX_AGENCY_KEYS) {
    const label = (
      await input({
        message: `Client ${collected.length + 1} name:`,
        validate: (v) => v.trim().length > 0 || 'A name so we can tell the keys apart.',
      })
    ).trim();
    const { key, client } = await collectValidKey(`CreatorOS API key for ${label}:`);
    collected.push({ label, apiKey: key, client });
    if (collected.length === MAX_AGENCY_KEYS) {
      say(`That's ${MAX_AGENCY_KEYS} — the max per setup.`);
      break;
    }
    const more = await confirm({
      message: `Add another client key? (${collected.length}/${MAX_AGENCY_KEYS})`,
      default: false,
    });
    if (!more) break;
  }

  const activeIndex =
    collected.length === 1
      ? 0
      : await select({
          message: 'Which client are we setting up right now? (the rest stay saved for their own workspaces)',
          choices: collected.map((entry, index) => ({ name: entry.label, value: index })),
        });
  const active = collected[activeIndex]!;
  await saveCredentials({
    apiKey: active.apiKey,
    keys: collected.map(({ label, apiKey }) => ({ label, apiKey })),
  });
  state.answers.clientLabels = collected.map((entry) => entry.label);
  say(`Working on ${active.label} now. ${collected.length > 1 ? `The other ${collected.length - 1} key(s) are saved and validated.` : ''}`);
  return active.client;
}

/**
 * The brain check. Claude detected (plan login or ANTHROPIC_API_KEY) →
 * verify and move on. Claude connection failed → the first question of
 * the whole interview: which AI model — Claude, or any model behind an
 * Anthropic-compatible API. Every choice gets a live round-trip check.
 */
async function stepBrain(state: InterviewState): Promise<void> {
  let brain: BrainConfig;
  const status = detectBrain();
  if (status === 'missing') {
    say("The Claude connection isn't there yet, so first things first:");
    brain = await promptBrainChoice();
  } else {
    say(
      status === 'plan'
        ? 'AI brain: Claude Code detected — I run on your Claude plan, no API key needed.'
        : 'AI brain: ANTHROPIC_API_KEY found — I think with Claude via that key.',
    );
    brain = { provider: 'claude' };
  }
  brain = await verifyBrainInteractive(brain);
  state.answers.brain = toSettings(brain);
  markStepDone(state, 'brain');
}

async function stepKey(paths: KairosPaths, state: InterviewState): Promise<CreatorOSClient> {
  let client: CreatorOSClient;

  const envKey = await resolveApiKey();
  if (envKey && isValidKeyShape(envKey)) {
    client = new CreatorOSClient({ apiKey: envKey });
    process.stdout.write(`Found a saved key — checking ${maskKey(envKey)}... `);
    if (await client.validateKey()) {
      console.log('valid.');
    } else {
      console.log('rejected — let\'s get a fresh one.');
      client = await collectKeysInteractively(state);
    }
  } else {
    client = await collectKeysInteractively(state);
  }

  const { accounts } = await client!.listAccounts();
  if (!isStepDone(state, 'key')) {
    say(`You have ${accounts.length} connected account(s):`);
    let health: { accounts?: Array<{ accountId: string; status: string }> } = {};
    try {
      health = (await client!.accountsHealth()) as typeof health;
    } catch {
      // health endpoint can be add-on gated; the account list is enough
    }
    for (const account of accounts) {
      const accountHealth = health.accounts?.find((h) => h.accountId === account._id)?.status;
      const healthNote = accountHealth ? ` — ${accountHealth}` : account.isActive ? ' — active' : ' — inactive';
      console.log(`  • ${platformLabel(account.platform)}  @${account.username ?? '?'}${healthNote}`);
    }
    if (accounts.length === 0) {
      say('No accounts connected yet — connect them in the CreatorOS app, then re-run me. Continuing setup anyway.');
    }
    markStepDone(state, 'key');
    await saveState(paths.setupStateJson, state);
  }
  return client!;
}

async function stepBrand(): Promise<BrandAnswers> {
  say("Now the part that matters most — the brand pack. Everything I ever write for you flows from this, so give it to me straight.");

  const about = await askBlock('What is this brand actually about? What are you marketing?', {
    required: true,
  });
  const productsRaw = await askBlock(
    'What do you sell? One offer per line as "link, what it is" — e.g. "https://shop.example/guide, my $29 training guide". No link yet? Just describe it.',
    { required: true },
  );
  const products = parseProducts(productsRaw);
  const adjectivesRaw = await input({
    message: 'Your voice in three adjectives (comma-separated):',
    validate: (v) => v.split(',').filter((s) => s.trim()).length >= 3 || 'Give me three.',
  });
  const voiceNever = await input({
    message: 'And one "never" — what should my copy never sound like?',
    validate: (v) => v.trim().length > 0 || 'One thing, e.g. "corporate" or "thirsty".',
  });
  const emojiPolicy = await select({
    message: 'Emoji policy:',
    choices: [
      { name: 'None — clean text only', value: 'none' },
      { name: 'Sparingly — max one per caption', value: 'sparingly (max one per caption)' },
      { name: 'Free — emojis are part of the voice', value: 'free — part of the voice' },
    ],
  });
  const hashtagPolicy = await select({
    message: 'Hashtag policy:',
    choices: [
      { name: 'None', value: 'none' },
      { name: 'A few relevant ones (2-4)', value: 'a few relevant ones (2-4)' },
      { name: 'Aggressive — as many as the platform tolerates', value: 'aggressive' },
    ],
  });
  const audience = await askBlock('Target audience in one sentence:', { required: true });
  const competitors = await askList(
    'Competitor accounts to watch — handles or URLs, up to 5 (empty line to skip):',
    { max: 5 },
  );

  return {
    about,
    products,
    voiceAdjectives: adjectivesRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    voiceNever: voiceNever.trim(),
    emojiPolicy,
    hashtagPolicy,
    audience,
    competitors,
  };
}

async function stepProfiles(
  client: CreatorOSClient,
  paths: KairosPaths,
  state: InterviewState,
): Promise<SocialAccount[]> {
  say('Profile map — I post to account IDs, so let me confirm each handle.');
  const { accounts } = await client.listAccounts();
  const confirmed: Array<{ accountId: string; platform: string; username: string }> = [];
  for (const account of accounts) {
    const username = await input({
      message: `${platformLabel(account.platform)} username:`,
      default: account.username ?? '',
    });
    confirmed.push({ accountId: account._id, platform: account.platform, username: username.trim() });
  }
  state.answers.profiles = confirmed;
  await writeFile(
    paths.profilesMd,
    renderProfilesMd(confirmed.map((c) => ({ _id: c.accountId, platform: c.platform as SocialAccount['platform'], username: c.username }))),
    'utf8',
  );
  markStepDone(state, 'profiles');
  await saveState(paths.setupStateJson, state);
  say('Profile map saved to kairos/PROFILES.md.');
  return accounts;
}

async function stepPathway(state: InterviewState): Promise<void> {
  say('Last setup call: where do your automations live?');
  const automationTarget = await select({
    message: 'Automation pathway:',
    choices: [
      {
        name: 'Local (this Mac) — runs on your existing Claude plan; the machine must be awake at scheduled times',
        value: 'local' as const,
      },
      {
        name: 'VPS (Railway) — always-on cloud; needs an AI API key (Claude etc.) on the service',
        value: 'railway' as const,
      },
    ],
  });
  if (automationTarget === 'railway') {
    say(
      `For the comment & messaging agents to run autonomously in the cloud, the service needs an AI credential: ANTHROPIC_API_KEY, or — to stay on your Claude plan (Pro/Max) — a long-lived token from \`claude setup-token\` set as CLAUDE_CODE_OAUTH_TOKEN.\n⚠ ${RAILWAY_SPEND_LIMIT_WARNING}`,
    );
  } else {
    say('Local runs use your Claude plan through the claude CLI — no separate AI API key needed.');
  }
  const timezone = await input({
    message: 'Your timezone (IANA name):',
    default: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  });
  state.answers.pathway = { automationTarget, timezone: timezone.trim() };
  markStepDone(state, 'pathway');
}

async function stepFinish(
  client: CreatorOSClient,
  paths: KairosPaths,
  state: InterviewState,
  accounts: SocialAccount[],
): Promise<KairosConfig> {
  // Persist config + knowledge scaffolding first — the durable artifacts.
  const pathway = state.answers.pathway ?? { automationTarget: 'local' as const, timezone: 'UTC' };
  const profileId = typeof accounts[0]?.profileId === 'string' ? accounts[0]?.profileId : accounts[0]?.profileId?._id;
  const config: KairosConfig = {
    version: 1,
    mode: state.answers.mode ?? 'creator',
    brain: state.answers.brain ?? { provider: 'claude' },
    automationTarget: pathway.automationTarget,
    timezone: pathway.timezone,
    profileId,
    // No automations are configured at onboarding — the user picks their
    // set in the first chat, and the agent fills these in with sign-off.
    funnel: { enabled: false, keywords: [], matchMode: 'contains', dmMessage: '', scope: 'account-wide', accountIds: [] },
    onboardedAt: new Date().toISOString(),
  };
  await saveConfig(paths.configJson, config);

  // Install Kairos's skills and knowledge base.
  await mkdir(paths.knowledgeDir, { recursive: true });
  const skillsTemplate = join(TEMPLATES_DIR, 'skills');
  if (existsSync(skillsTemplate)) {
    await cp(skillsTemplate, paths.skillsDir, { recursive: true });
  }
  if (!existsSync(paths.tutorialsMd)) {
    await writeFile(paths.tutorialsMd, renderTutorialsMd(), 'utf8');
  }
  await mkdir(paths.contentLibraryDir, { recursive: true });

  // Deliberately no automations here: everyone runs a different playbook,
  // so nothing gets created on the user's behalf. The chat is where they
  // pick, and the agent sets up only what they approve.
  say(
    `Setup's done — and on purpose, NOTHING is automated yet. Everyone runs a different playbook, so you pick what turns on. Once we're chatting, say the word and I'll set up any of these, one at a time, with your sign-off:
  • Auto-replies to comments and DMs (I chat in a persona you define)
  • Comments-to-DM funnels (keyword comment → automatic DM with your link)
  • Scheduled content posting from your library
  • Recurring analytics reports
Want none of them? Also fine — everything works manually through chat too.`,
  );

  // State of the socials: follower stats + recent posts, with an honest read.
  say('Here\'s where your socials actually stand:');
  try {
    const stats = (await client.followerStats()) as {
      accounts?: Array<{ platform: string; username: string; currentFollowers: number; growth: number; growthPercentage: number }>;
    };
    for (const s of stats.accounts ?? []) {
      console.log(
        `  • ${platformLabel(s.platform)} @${s.username}: ${s.currentFollowers} followers (${s.growth >= 0 ? '+' : ''}${s.growth} / ${s.growthPercentage}% last 30 days)`,
      );
    }
  } catch {
    console.log('  (Follower stats need the analytics add-on — data will appear once it\'s active.)');
  }
  try {
    const recent = await client.listPosts({ limit: 5, sortBy: 'created-desc' });
    console.log(`  • ${recent.posts.length} recent post(s) on record via CreatorOS.`);
  } catch {
    // non-fatal
  }

  say(`Setup summary:\n${renderSetupSummary(state)}`);
  say(
    "Honest read: the fastest lever from here is consistency — a full content-library/ and a daily posting automation beats any single viral swing. Drop 10+ clips into content-library/, then tell me \"schedule the week\" or pick your automations. That's my suggested first move.",
  );

  // The handoff: everything answered is now materialized in kairos/ — this
  // prompt makes an agent act on all of it. Saved AND printed.
  const setupPrompt = renderSetupPrompt(state);
  await writeFile(
    join(paths.kairosDir, 'SETUP_PROMPT.md'),
    `# Setup Prompt\n\nPaste this to Kai (or any agent in this repo) to wire everything up:\n\n\`\`\`\n${setupPrompt}\n\`\`\`\n`,
    'utf8',
  );
  say(
    `One last thing — your setup prompt (also saved to kairos/SETUP_PROMPT.md). Paste it as your first message and I'll wire everything up:\n\n${'─'.repeat(60)}\n${setupPrompt}\n${'─'.repeat(60)}`,
  );

  markStepDone(state, 'finish');
  await saveState(paths.setupStateJson, state);
  return config;
}
