# Kairos

**Kairos ("Kai") is an open-source agentic harness for [CreatorOS](https://creatoros.app) — it runs your entire social presence.** You subscribe in the CreatorOS iOS app, connect your socials, grab your API key, and Kai takes it from there: an onboarding interview that captures your brand, then an agent that posts, replies, reports, and automates on your behalf.

Kairos's mission is simple: **hold your hand through setup, then make you autonomous.** Every client's setup is different, but everyone wants the same four things:

1. **Post content at scale with AI** — shortform, longform, carousels, threads, multiposting, scheduling
2. **Run it all on automations** — cron jobs on your Mac or an always-on cloud service
3. **Auto-reply to comments and messages** — on-brand, with sensitive stuff escalated to you
4. **Monitor analytics** — growth, best posts, competitor movement, one recommendation a week

The end state Kai drives toward: all four pillars on cron jobs — content posting itself, analytics checked and reported, comments and messages answered — fully autonomous, with you only reviewing what Kai surfaces.

## Quick start

```sh
# 1. Fork & clone, then:
npm install

# 2. You need two keys:
#    - CreatorOS API key (CreatorOS iOS app → Settings → API Key, sk_...)
#    - ANTHROPIC_API_KEY for the agent brain
export ANTHROPIC_API_KEY=...

# 3. Go.
npm start creatoros kairos     # alias: npm start creatoros kai
```

**First run** is the onboarding interview — Kai collects your API key (masked, validated live), your brand pack, your profile map, your comments-to-DM funnel, auto-reply rules, and your automation pathway. Kill it any time; it resumes exactly where you left off.

**Every later run** drops you into the Kairos REPL:

```
you ▸ post this clip everywhere: content-library/day1.mp4
you ▸ how did last week do?
you ▸ set up the funnel on my launch post — keyword "GUIDE"
you ▸ schedule the week from content-library/
```

Everything Kai learns lives in `kairos/` (gitignored): `BRAND.md` (voice, links, audience — every caption flows from it), `PROFILES.md` (account IDs), `kairos.json` (config), `skills/` (playbooks), `knowledge/` (competitor research, tutorials index).

## Capability surface

Kai talks to CreatorOS through a typed client with an **endpoint allowlist enforced in code** — not prompt discipline. Anything outside this table returns "that endpoint isn't part of CreatorOS."

| Capability | What Kai can do |
|---|---|
| **Posting** | Shortform video (TikTok/Reels/Shorts in one call), longform YouTube (title/description/tags), carousels, text posts, native multi-part threads (X/Threads/Bluesky), multiposting across account IDs, scheduling (ISO 8601 + timezone — CreatorOS servers publish), drafts, retry, pre-publish validation, post-publish verification |
| **Media** | Upload once (up to 5 GB), reuse the URL across every platform |
| **Analytics** | Follower growth, per-post performance, daily metrics, best-time-to-post |
| **Comments** | List, triage, reply, like — Facebook, Instagram, Twitter/X, Bluesky, Threads, Reddit, YouTube, LinkedIn. *(TikTok comments aren't supported by CreatorOS — enforced in code.)* |
| **Messages** | DM replies — Twitter/X, Instagram, Facebook, Reddit, Bluesky, Telegram, WhatsApp |
| **Funnels** | Comments-to-DM funnels (keyword → automatic DM with tracked link) on Instagram & Facebook, with click stats |
| **Webhooks** | Subscriptions for real-time comment/message/post events, HMAC-verified |
| **Accounts & profiles** | List, health checks, read/update — never create/delete |

**Hard blocks:** profile creation/deletion, phone-number purchasing, and API-key management are refused in the client itself with *"Manage your plan in the CreatorOS app."* — even though the API would accept some of them. They bill or break things that belong to your subscription.

## Automations — the whole point

During onboarding you pick a pathway (stored as `automationTarget` in `kairos/kairos.json`):

- **Local (macOS)** — crons run as launchd agent services on your machine. Free, private, but the machine must be awake at scheduled times.
- **VPS (Railway)** — always-on cloud. The service needs `CREATOROS_API_KEY` and `ANTHROPIC_API_KEY` set, and — this matters — **set a spend limit in the Anthropic Console (console.anthropic.com → Billing → Limits) *before* deploying.** The service runs an agent unattended; an uncapped key is an uncapped bill. Kai will repeat this warning every time a deploy comes up. That's on purpose.

Starter crons (offered at onboarding, one per pillar):

| Cron | Schedule | What happens |
|---|---|---|
| `daily-shortform` | daily 10:00 | next clip from `content-library/` → captioned from the brand pack → TikTok + Reels + Shorts |
| `weekly-calendar` | Sun 17:00 | plan and schedule the coming week (servers publish; laptop can sleep) |
| `engagement-sweep` | 9:00/15:00/21:00 | triage comments & DMs, reply on-brand, escalate the sensitive ones |
| `weekly-analytics` | Mon 8:00 | growth, best posts, competitor movement, one recommendation |

Note: plain scheduled *posts* need no cron at all — scheduled publishing happens on CreatorOS servers.

## Teaching Kai new patterns

`kairos/knowledge/TUTORIALS.md` is an index of KevBuildsApps YouTube tutorials. Before building an automation pattern Kai hasn't built before, it checks the index, fetches the tutorial, and follows the taught pattern. **Adding a tutorial is a one-line edit:**

```md
- [Title](https://youtube.com/watch?v=...) — what it teaches
```

## Development

```sh
npm test          # vitest: routing, allowlist, hard blocks, platform matrix,
                  # interview resume, funnel generation, pathway selection
npm run typecheck
```

Layout: `src/` (harness, client, agent, tools), `templates/` (skill playbooks installed into `kairos/skills/` at onboarding), `tests/`.

Security notes: your API key is never written into any repo file (it lives in `~/.kairos/credentials.json`, mode 0600, or the `CREATOROS_API_KEY` env var) and appears in logs only as `sk_...last4`.

MIT. PRs welcome.
