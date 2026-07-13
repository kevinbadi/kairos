# respond-to-comments

Fetch recent comments across accounts, triage them, draft on-brand replies, post them, report. Not for DMs (use conversations tools) or reviews.

## Before anything

Read `kairos/BRAND.md` (voice), `kairos/PROFILES.md` (account IDs), and `kairos/kairos.json` (which platforms have auto-replies enabled, and the escalation topics). Never contradict them.

## Procedure

1. `list_accounts` — note each account's ID and platform; you need both to reply.
2. Fetch: `list_comments` with `since` = time since the last run (default: last 24h). Drill into a post with `get_post_comments`.
3. Triage every comment into four buckets:
   - **REPLY** — normal engagement; draft a reply.
   - **SKIP** — spam, bots, trolls, bare emoji with nothing to say back.
   - **ESCALATE** — sensitive; do not reply, collect for the human.
   - **LIKE-ONLY** — positive but content-free ("🔥🔥"); `like_comment` instead.
4. Draft in brand voice: short (1–2 sentences), specific to what the commenter said, no corporate filler, at most one emoji if the brand uses them. Never promise anything (dates, refunds, features) the human hasn't stated publicly.
5. Post with `reply_to_comment` (platform, postId, accountId, message, commentId). Omit commentId only when replying to the post thread itself.
6. Report: counts per bucket, every ESCALATE item quoted in full with its link/ID, and the replies posted.

## Judgment rules

- **Escalate, never answer, when a comment involves:** refunds, billing, or order problems; complaints about the product or a bad experience; legal, medical, or financial claims; press/partnership inquiries; anything mentioning a minor or safety issue; harassment directed at a specific person — plus any extra topics in `kairos/kairos.json`.
- **Skip silently:** obvious spam links, crypto/promo bots, "check my page" comments, and trolls looking for a rise. Never feed trolls — a witty clapback is the human's call, not yours.
- **Tone:** match the commenter's energy but stay kind. Enthusiastic gets enthusiastic; a thoughtful question gets a substantive answer.
- **Don't argue.** If someone disagrees with the post's take, engage genuinely with their point once, or leave it. No back-and-forth threads.
- **Rate sanity:** if more than ~30 REPLY-bucket comments, reply to the 30 with the most substance and tell the human how many were left.
- **When unsure which bucket, escalate.** A missed reply costs nothing; a bad reply is public.
- **Platform matrix is enforced in code:** TikTok comments aren't supported — don't try to work around the refusal.
- **Funnel synergy:** if a comment contains a funnel keyword, the funnel already DM'd them — don't double-DM; a public reply is still fine.

## Verification

Every `reply_to_comment` returns the created reply — on failure retry once, then include it in the report as failed; never silently drop. Spot-check one replied post with `get_post_comments`. The final report to the human is part of success — no report, not done.
