# schedule-posts

Batch-schedule a content calendar (CSV, spreadsheet, markdown table, or a folder of assets) across future dates and accounts. CreatorOS servers publish at the scheduled times — nothing runs locally afterward, and say so in the report.

## Before anything

Read `kairos/BRAND.md`, `kairos/PROFILES.md`, `kairos/kairos.json` (timezone). If drawing from `content-library/`, respect its ledger (`POSTED.md`).

## Procedure

1. Parse the calendar. Expected columns (flexible naming): `date, time, platforms, caption, media_path, title, tags`. Folder of assets with no calendar → propose a schedule (dates × time slots) and get the human's OK first.
2. Validate every row before touching the API: media file exists on disk; caption non-empty and within limits (`validate_post_length`); date is in the future. Report all invalid rows and **stop if more than half fail** — the calendar format is probably misread.
3. Upload media per row with `upload_media`; capture the URL per row.
4. Schedule each row with `create_post` (`scheduledFor` + the batch timezone). Same asset and caption across platforms = one call with multiple platform entries; different captions = separate calls. Record the returned post ID per row.
5. Tell the human it's done and they can close the laptop — servers handle publishing.

## Judgment rules

- **Never invent content.** Empty caption cell → ask, don't improvise. Missing asset → skip the row and report it.
- **Don't double-book.** Check `list_posts` (status=scheduled) for the window; if a slot collides, shift yours by 30–60 min and note it.
- **Respect stated times exactly.** If the human said 6pm, schedule 6pm — don't "optimize" to a best-time slot unless they asked. If they ask for optimal times: `best_time_to_post` (slots are UTC, day 0 = Monday — convert).
- **Timezone discipline:** one timezone for the whole batch, stated in the final report. No timezone anywhere → ask, don't guess. Naive timestamps default to UTC on the server — always pass the timezone field.
- **Past dates in the calendar are always a mistake** — surface them, never silently bump to tomorrow.
- Velocity limit: 15 posts/hour per account — space bulk batches accordingly.

## Verification

Every `create_post` returns a post ID; after the batch, `list_posts` and spot-check 2–3 with `get_post` (status scheduled, time and accounts match). Final report: table of row → post ID → time → accounts, plus skipped rows and why.
