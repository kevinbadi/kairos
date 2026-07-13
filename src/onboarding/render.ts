/**
 * Pure renderers for the files Kairos reads forever after. Everything
 * Kairos writes later — captions, descriptions, CTAs — flows from BRAND.md.
 */
import type { BrandAnswers, InterviewState } from './state.js';
import type { SocialAccount } from '../client/types.js';
import { platformLabel } from '../client/platformMatrix.js';

export function renderBrandMd(brand: BrandAnswers): string {
  const competitors =
    brand.competitors.length > 0
      ? brand.competitors.map((c) => `- ${c}`).join('\n')
      : '_None given yet — add handles here and ask Kairos to research them._';
  const links =
    brand.productLinks.length > 0
      ? brand.productLinks.map((l) => `- ${l}`).join('\n')
      : '_No product links yet — every CTA needs a destination; add them here._';

  return `# Brand Pack

Kairos reads this before writing anything. Every caption, description, and
CTA flows from here. Edit freely — Kairos always uses the latest version.

## What this brand is about

${brand.about}

## What we sell / market

${brand.selling}

## Voice

- Sounds like: ${brand.voiceAdjectives.join(', ')}
- Never: ${brand.voiceNever}
- Emoji policy: ${brand.emojiPolicy}
- Hashtag policy: ${brand.hashtagPolicy}

### Example caption we love

> ${brand.exampleCaption.split('\n').join('\n> ')}

## Product & service links (CTA destinations)

${links}

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
