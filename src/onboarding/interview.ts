/**
 * The onboarding interview — Kairos holding the user's hand on day one.
 * Conversational, one question at a time; every answer lands in a file
 * Kairos reads forever after. Resumable: state saves after every step.
 */
import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreatorOSClient, isValidKeyShape } from '../client/client.js';
import {
  COMMENT_REPLY_PLATFORMS,
  MESSAGE_REPLY_PLATFORMS,
  platformLabel,
  supportsFunnels,
} from '../client/platformMatrix.js';
import type { SocialAccount } from '../client/types.js';
import { maskKey } from '../util/mask.js';
import { kairosPaths, type KairosPaths } from '../paths.js';
import { resolveApiKey, saveApiKey } from '../config/credentials.js';
import {
  DEFAULT_ESCALATION_TOPICS,
  saveConfig,
  type KairosConfig,
} from '../config/kairosConfig.js';
import {
  isStepDone,
  loadState,
  markStepDone,
  saveState,
  type BrandAnswers,
  type InterviewState,
} from './state.js';
import { renderBrandMd, renderProfilesMd, renderSetupSummary, renderTutorialsMd } from './render.js';
import { buildFunnelAutomation, describeFunnel } from '../automations/funnels.js';
import {
  createAutomation,
  RAILWAY_SPEND_LIMIT_WARNING,
  STARTER_CRONS,
  verifyAutomations,
} from '../automations/crons.js';

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

  // ---- Step 1: key + accounts ----
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

  // ---- Step 4: the comments-to-DM funnel question ----
  if (!isStepDone(state, 'funnel')) {
    await stepFunnel(state, accounts);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Step 5: auto-replies ----
  if (!isStepDone(state, 'autoReplies')) {
    await stepAutoReplies(state, accounts);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Step 6: automation pathway ----
  if (!isStepDone(state, 'pathway')) {
    await stepPathway(state);
    await saveState(paths.setupStateJson, state);
  }

  // ---- Step 7: finish in character ----
  const config = await stepFinish(client, paths, state, accounts);
  return { client, config };
}

async function stepKey(paths: KairosPaths, state: InterviewState): Promise<CreatorOSClient> {
  let key = await resolveApiKey();
  let client: CreatorOSClient | null = key ? new CreatorOSClient({ apiKey: key }) : null;

  while (true) {
    if (!key) {
      say(
        'First: your CreatorOS API key. Grab it from the CreatorOS iOS app → Settings → API Key (it starts with sk_).',
      );
      key = (await password({ message: 'Paste your CreatorOS API key:', mask: '*' })).trim();
    }
    if (!isValidKeyShape(key)) {
      console.log(
        "That doesn't look like a CreatorOS API key (expected sk_ + 64 hex characters). Check the CreatorOS app under Settings → API Key.",
      );
      key = null;
      continue;
    }
    client = new CreatorOSClient({ apiKey: key });
    process.stdout.write(`Checking ${maskKey(key)} against CreatorOS servers... `);
    const valid = await client.validateKey();
    if (!valid) {
      console.log('rejected. Double-check it in the CreatorOS app and paste it again.');
      key = null;
      continue;
    }
    console.log('valid.');
    await saveApiKey(key);
    break;
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

  const about = await input({
    message: 'What is this brand actually about? What are you marketing?',
    validate: (v) => v.trim().length > 0 || 'Give me at least a sentence.',
  });
  const selling = await input({
    message: 'What do you sell? (product, service, offer — the thing the content drives toward)',
    validate: (v) => v.trim().length > 0 || "If it's nothing yet, say what you're building toward.",
  });
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
  const exampleCaption = await input({
    message: 'Paste one example caption you love (yours or anyone\'s):',
    validate: (v) => v.trim().length > 0 || 'One example calibrates me better than ten rules.',
  });
  const linksRaw = await input({
    message: 'Links to your products/services (comma-separated — every CTA I write points at one of these):',
  });
  const audience = await input({
    message: 'Target audience in one sentence:',
    validate: (v) => v.trim().length > 0 || 'One sentence.',
  });
  const competitorsRaw = await input({
    message: 'Competitor accounts to watch — handles or URLs, up to 5, comma-separated (blank to skip):',
  });

  return {
    about: about.trim(),
    selling: selling.trim(),
    voiceAdjectives: adjectivesRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    voiceNever: voiceNever.trim(),
    emojiPolicy,
    hashtagPolicy,
    exampleCaption: exampleCaption.trim(),
    productLinks: linksRaw.split(',').map((s) => s.trim()).filter(Boolean),
    audience: audience.trim(),
    competitors: competitorsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5),
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

async function stepFunnel(state: InterviewState, accounts: SocialAccount[]): Promise<void> {
  say(
    'Now one of the most powerful features in CreatorOS: the comments-to-DM funnel. Someone comments a keyword on your post → they automatically get a DM with a link or offer.',
  );
  const wantsFunnel = await confirm({
    message: 'When people comment on your posts, do you want to run a comments-to-DM funnel?',
    default: true,
  });
  if (!wantsFunnel) {
    state.answers.funnel = { enabled: false };
    markStepDone(state, 'funnel');
    say("No problem — I'll re-offer it whenever you upload new content. It's a one-minute setup.");
    return;
  }

  const funnelAccounts = accounts.filter((a) => supportsFunnels(a.platform));
  if (funnelAccounts.length === 0) {
    say(
      'Funnels run on Instagram and Facebook, and none of those are connected yet. Connect one in the CreatorOS app and ask me to set the funnel up any time.',
    );
    state.answers.funnel = { enabled: false };
    markStepDone(state, 'funnel');
    return;
  }

  const keywordsRaw = await input({
    message: 'Trigger keyword(s), comma-separated (e.g. "LINK, GUIDE"):',
    validate: (v) => v.split(',').some((s) => s.trim()) || 'At least one keyword.',
  });
  const productLinks = state.answers.brand?.productLinks ?? [];
  const link =
    productLinks.length > 0
      ? await select({
          message: 'Which link should the DM send?',
          choices: [
            ...productLinks.map((l) => ({ name: l, value: l })),
            { name: 'Another link (type it next)', value: '__other__' },
          ],
        })
      : '__other__';
  const finalLink =
    link === '__other__' ? (await input({ message: 'Link to send in the DM:' })).trim() : link;
  const dmMessage = await input({
    message: 'The DM message (the link is attached as a button — keep it under 640 chars):',
    validate: (v) =>
      v.trim().length > 0 && v.length <= 640 ? true : 'Between 1 and 640 characters.',
  });
  const accountIds = await checkbox({
    message: 'Run it on which accounts? (funnels are Instagram/Facebook)',
    choices: funnelAccounts.map((a) => ({
      name: `${platformLabel(a.platform)} @${a.username ?? '?'}`,
      value: a._id,
      checked: true,
    })),
  });

  state.answers.funnel = {
    enabled: true,
    keywords: keywordsRaw.split(',').map((s) => s.trim()).filter(Boolean),
    dmMessage: dmMessage.trim(),
    link: finalLink || undefined,
    accountIds,
    scope: 'account-wide',
  };
  markStepDone(state, 'funnel');
  say("Got it. I'll confirm the exact copy with you before it goes live — the DM goes out automatically to strangers, so you sign off first.");
}

async function stepAutoReplies(state: InterviewState, accounts: SocialAccount[]): Promise<void> {
  say(
    'Comment and message auto-replies are live for all CreatorOS users. Let\'s set what I handle vs what I escalate to you.',
  );
  const connected = new Set(accounts.map((a) => a.platform));
  const commentChoices = COMMENT_REPLY_PLATFORMS.filter((p) => connected.has(p));
  const messageChoices = MESSAGE_REPLY_PLATFORMS.filter((p) => connected.has(p));

  const commentsEnabled =
    commentChoices.length > 0 &&
    (await confirm({ message: 'Should I auto-reply to comments?', default: true }));
  const commentPlatforms = commentsEnabled
    ? await checkbox({
        message: 'Comment replies on which platforms? (TikTok comments aren\'t supported by CreatorOS)',
        choices: commentChoices.map((p) => ({ name: platformLabel(p), value: p as string, checked: true })),
      })
    : [];

  const messagesEnabled =
    messageChoices.length > 0 &&
    (await confirm({ message: 'Should I auto-reply to DMs?', default: true }));
  const messagePlatforms = messagesEnabled
    ? await checkbox({
        message: 'Message replies on which platforms?',
        choices: messageChoices.map((p) => ({ name: platformLabel(p), value: p as string, checked: true })),
      })
    : [];

  const tone = state.answers.brand
    ? `${state.answers.brand.voiceAdjectives.join(', ')} — never ${state.answers.brand.voiceNever}`
    : 'match the brand pack';
  const extraEscalate = await input({
    message: `I always escalate ${DEFAULT_ESCALATION_TOPICS.join(', ')}. Any other topics that should always come to you? (comma-separated, blank for none)`,
  });

  const escalate = [
    ...DEFAULT_ESCALATION_TOPICS,
    ...extraEscalate.split(',').map((s) => s.trim()).filter(Boolean),
  ];
  state.answers.autoReplies = {
    comments: { enabled: commentsEnabled, platforms: commentPlatforms, tone, escalate },
    messages: { enabled: messagesEnabled, platforms: messagePlatforms, tone, escalate },
  };
  markStepDone(state, 'autoReplies');
}

async function stepPathway(state: InterviewState): Promise<void> {
  say('Last setup call: where do your automations live?');
  const automationTarget = await select({
    message: 'Automation pathway:',
    choices: [
      {
        name: 'Local (this Mac) — cron jobs run as launchd services here; the machine must be awake at scheduled times',
        value: 'local' as const,
      },
      {
        name: 'VPS (Railway) — always-on cloud; needs your keys on the service',
        value: 'railway' as const,
      },
    ],
  });
  if (automationTarget === 'railway') {
    say(
      `⚠ ${RAILWAY_SPEND_LIMIT_WARNING}`,
    );
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
    automationTarget: pathway.automationTarget,
    timezone: pathway.timezone,
    profileId,
    funnel: state.answers.funnel?.enabled
      ? {
          enabled: true,
          keywords: state.answers.funnel.keywords ?? [],
          matchMode: 'contains',
          dmMessage: state.answers.funnel.dmMessage ?? '',
          link: state.answers.funnel.link,
          scope: state.answers.funnel.scope ?? 'account-wide',
          accountIds: state.answers.funnel.accountIds ?? [],
        }
      : { enabled: false, keywords: [], matchMode: 'contains', dmMessage: '', scope: 'account-wide', accountIds: [] },
    autoReplies: state.answers.autoReplies,
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

  // Create the funnel now, with explicit sign-off on the exact copy.
  if (state.answers.funnel?.enabled && state.answers.funnel.accountIds?.length) {
    for (const accountId of state.answers.funnel.accountIds) {
      const account = accounts.find((a) => a._id === accountId);
      if (!account) continue;
      const spec = {
        platform: account.platform,
        profileId: typeof account.profileId === 'string' ? account.profileId : account.profileId._id,
        accountId,
        name: `kairos-funnel-${account.platform}`,
        keywords: state.answers.funnel.keywords ?? [],
        dmMessage: state.answers.funnel.dmMessage ?? '',
        link: state.answers.funnel.link,
      };
      say(describeFunnel(spec));
      const approved = await confirm({
        message: `Ship this funnel on ${platformLabel(account.platform)} @${account.username ?? '?'}? It DMs strangers automatically.`,
        default: true,
      });
      if (!approved) {
        say('Skipped — the config is saved in kairos/kairos.json; say the word and I\'ll turn it on.');
        continue;
      }
      try {
        await client.createCommentAutomation(account.platform, buildFunnelAutomation(spec));
        say(`Funnel is live on ${platformLabel(account.platform)}.`);
      } catch (error) {
        say(`Couldn't create the funnel on ${platformLabel(account.platform)}: ${(error as Error).message}. Saved the config — we can retry from the chat.`);
      }
    }
  }

  // Offer the starter crons — the four pillars on schedules.
  say('Starter automations — this is the end-state: all four pillars on autopilot. Pick what to turn on now (you can add the rest later):');
  const chosen = await checkbox({
    message: `Create on the ${pathway.automationTarget} pathway:`,
    choices: STARTER_CRONS.map((cron) => ({
      name: `${cron.name} — ${cron.description}`,
      value: cron.name,
      checked: cron.pillar === 'engagement',
    })),
  });
  if (chosen.length > 0 && pathway.automationTarget === 'railway') {
    say(`⚠ ${RAILWAY_SPEND_LIMIT_WARNING}`);
  }
  for (const name of chosen) {
    const cron = STARTER_CRONS.find((c) => c.name === name)!;
    const result = await createAutomation(paths.root, cron, pathway.automationTarget);
    if (result.code === 0) {
      say(`✓ ${cron.name} created. ${cron.description}`);
    } else {
      say(`✗ ${cron.name} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
  if (chosen.length > 0) {
    const listed = await verifyAutomations(paths.root);
    if (listed.code === 0 && listed.stdout.trim()) {
      say(`Verified — automations on record:\n${listed.stdout.trim()}`);
    }
  }

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
    "Honest read: the fastest lever from here is consistency — a full content-library/ and the daily-shortform cron beats any single viral swing. Drop 10+ clips into content-library/, and tell me \"schedule the week\". That's my suggested first move.",
  );

  markStepDone(state, 'finish');
  await saveState(paths.setupStateJson, state);
  return config;
}
