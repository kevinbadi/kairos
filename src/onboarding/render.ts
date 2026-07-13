/**
 * Pure renderers for the files Kairos reads forever after. Everything
 * Kairos writes later — captions, descriptions, CTAs — flows from BRAND.md.
 */
import type { BrandAnswers, InterviewState, ProductOffer } from './state.js';
import type { SocialAccount } from '../client/types.js';
import { platformLabel } from '../client/platformMatrix.js';

/**
 * Parse the combined "what do you sell" answer: one offer per line,
 * `link, explainer` — or just an explainer when there's no link yet.
 */
export function parseProducts(raw: string): ProductOffer[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const commaAt = line.indexOf(',');
      const first = (commaAt === -1 ? line : line.slice(0, commaAt)).trim();
      const rest = commaAt === -1 ? '' : line.slice(commaAt + 1).trim();
      const looksLikeLink = /^(https?:\/\/|www\.)\S+$/i.test(first) || (/^\S+\.\S{2,}/.test(first) && !first.includes(' '));
      if (looksLikeLink) {
        const link = first.startsWith('http') ? first : `https://${first}`;
        return { link, description: rest || first };
      }
      return { description: line };
    });
}

export function renderBrandMd(brand: BrandAnswers): string {
  const competitors =
    brand.competitors.length > 0
      ? brand.competitors.map((c) => `- ${c}`).join('\n')
      : '_None given yet — add handles here and ask Kairos to research them._';
  const links =
    brand.products.length > 0
      ? brand.products
          .map((p) => (p.link ? `- ${p.description} — ${p.link}` : `- ${p.description} _(no link yet)_`))
          .join('\n')
      : '_Nothing listed yet — every CTA needs a destination; add offers here as `description — link`._';

  return `# Brand Pack

Kairos reads this before writing anything. Every caption, description, and
CTA flows from here. Edit freely — Kairos always uses the latest version.

## What this brand is about

${brand.about}

## What we sell — products, services & CTA destinations

${links}

## Voice

- Sounds like: ${brand.voiceAdjectives.join(', ')}
- Never: ${brand.voiceNever}
- Emoji policy: ${brand.emojiPolicy}
- Hashtag policy: ${brand.hashtagPolicy}

### Example caption we love

> ${brand.exampleCaption.split('\n').join('\n> ')}

## Target audience

${brand.audience}

## Competitors to watch

${competitors}

Research findings live in \`knowledge/COMPETITORS.md\` — ask Kairos to refresh them any time.
`;
}

export function renderProfilesMd(
  accounts: Array<Pick<SocialAccount, '_id' | 'platform' | 'username'> & { username?: string }>,
): string {
  const rows = accounts
    .map((a) => `| ${platformLabel(a.platform)} | @${a.username ?? 'unknown'} | \`${a._id}\` |`)
    .join('\n');
  return `# Profile Map

Every post targets account IDs — these are the source of truth. If an
account is reconnected and gets a new ID, update this file (or re-run setup).

| Platform | Username | Account ID |
|---|---|---|
${rows}
`;
}

export function renderTutorialsMd(): string {
  return `# Tutorials Index — KevBuildsApps

Before building an automation pattern it hasn't built before, Kairos checks
this index, fetches the tutorial transcript, and follows the taught pattern.

Adding a tutorial is a one-line edit: \`- [Title](URL) — what it teaches\`.

## Index

- _(none yet — add KevBuildsApps YouTube tutorials here as they ship)_
`;
}

/**
 * The prompt the user hands their AI agent to actually get everything set
 * up — every task traces back to a questionnaire answer already
 * materialized in kairos/. Printed at the finish and saved to
 * kairos/SETUP_PROMPT.md.
 */
export function renderSetupPrompt(state: InterviewState): string {
  const funnel = state.answers.funnel;
  const engagement = state.answers.engagement;
  const autoReplies = state.answers.autoReplies;
  const pathway = state.answers.pathway;
  const competitors = state.answers.brand?.competitors ?? [];

  const tasks: string[] = [
    'Verify every connected account is healthy (account_health) and flag anything that needs a reconnect.',
  ];
  if (funnel?.enabled) {
    tasks.push(
      `Create the comment-to-DM funnel exactly as configured in kairos.json (keyword(s) ${funnel.keywords?.map((k) => `"${k}"`).join(', ')} → the saved DM copy${funnel.link ? ` with ${funnel.link}` : ''}). Show me the exact copy and get my confirmation before it goes live, then verify with list_funnels.`,
    );
  }
  if (engagement) {
    tasks.push(
      'Set up the comment & message auto-reply automation on the enabled platforms using the engagementAgent persona and objective in kairos.json — engagement-sweep cron on my pathway (webhook-driven if on Railway). Escalation topics apply.',
    );
  }
  tasks.push(
    `Create the starter crons I still need on the ${pathway?.automationTarget ?? 'local'} pathway (daily-shortform once content-library/ has clips, weekly-calendar, weekly-analytics) and verify they are loaded with list_cron_automations.`,
  );
  if (competitors.length > 0) {
    tasks.push(
      `Research my competitors (${competitors.join(', ')}) — content mix, cadence, hooks, gaps — and write kairos/knowledge/COMPETITORS.md.`,
    );
  }
  tasks.push(
    'Pull follower stats and recent post analytics, then give me an honest state-of-the-socials read with ONE recommended first move.',
  );

  return `Read kairos/kairos.json, kairos/BRAND.md, and kairos/PROFILES.md first — they hold everything I answered during setup. Then, in order:

${tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}

Confirm anything that publishes or DMs strangers with me before it goes live. Report what you did, what you verified, and what's left.`;
}

/** The onboarding summary Kairos delivers in character at the finish. */
export function renderSetupSummary(state: InterviewState): string {
  const brand = state.answers.brand;
  const funnel = state.answers.funnel;
  const autoReplies = state.answers.autoReplies;
  const pathway = state.answers.pathway;
  const lines: string[] = [];
  if (brand) {
    lines.push(
      `Brand: ${brand.about.slice(0, 120)}${brand.about.length > 120 ? '…' : ''}`,
      `Voice: ${brand.voiceAdjectives.join(', ')} — never ${brand.voiceNever}.`,
      `Audience: ${brand.audience}`,
    );
  }
  if (state.answers.profiles) {
    lines.push(`Accounts mapped: ${state.answers.profiles.map((p) => `${p.platform}:@${p.username}`).join(', ')}`);
  }
  if (funnel?.enabled) {
    lines.push(
      `Funnel: ON — keyword(s) ${funnel.keywords?.map((k) => `"${k}"`).join(', ')} → DM with ${funnel.link ?? 'your link'}.`,
    );
  } else {
    lines.push('Funnel: off for now — Kairos will re-offer it whenever new content goes up.');
  }
  if (autoReplies) {
    lines.push(
      `Auto-replies: comments ${autoReplies.comments.enabled ? `on (${autoReplies.comments.platforms.join(', ')})` : 'off'}, ` +
        `messages ${autoReplies.messages.enabled ? `on (${autoReplies.messages.platforms.join(', ')})` : 'off'}. ` +
        `Always escalated: ${autoReplies.comments.escalate.join(', ')}.`,
    );
  }
  if (pathway) {
    lines.push(`Automation pathway: ${pathway.automationTarget} (${pathway.timezone}).`);
  }
  return lines.join('\n');
}
