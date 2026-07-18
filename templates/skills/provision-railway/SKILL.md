# provision-railway

Build the user's Railway worker environment end to end: project, workspace upload, variables, public domain, health check. The user's only jobs were creating the Railway account and pasting an API token — everything else is yours. Uses the Railway CLI (`railway`), which uploads the LOCAL workspace directly (`railway up`) — no GitHub connection needed, and gitignored files like `kairos/` ship correctly.

## Before anything

1. **Token**: the CLI reads `RAILWAY_API_TOKEN`. It's saved in `~/.kairos/credentials.json` under `railwayApiToken` (onboarding put it there). Export it for your commands without ever printing it:
   `export RAILWAY_API_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.kairos/credentials.json','utf8')).railwayApiToken??'')")`
   If empty, ask the human for a token from railway.app/account/tokens — an ACCOUNT token; a project-scoped token locks the CLI to that one existing project and provisioning will refuse to run there. NEVER echo, log, or write any token anywhere.
2. **CLI**: `railway --version` — if missing, `npm install -g @railway/cli` (ask first if global installs need sign-off).
3. **AI credential for the cloud worker**: ask the human for ONE of: `ANTHROPIC_API_KEY`, or a `claude setup-token` token (`CLAUDE_CODE_OAUTH_TOKEN`) to stay on their Claude plan. Their local Claude login does not travel to the cloud.
4. **Spend limit gate — hard stop**: before deploying, the human must confirm they set a spend limit at console.anthropic.com → Billing → Limits. Do not proceed on "I'll do it later."
5. Read `kairos/kairos.json` for `timezone` and `worker.token` (the generated `KAIROS_WORKER_TOKEN`); `~/.kairos/credentials.json` has the CreatorOS `apiKey`.

## Procedure

Run from the workspace root:

1. `railway unlink` (a 'not linked' error is fine), then `railway init --name kairos-worker` — ALWAYS a fresh project; never reuse an existing one.
2. Set every variable in one shot (values from the sources above — compose the command yourself, never show values in your report):
   `railway variables --set "CREATOROS_API_KEY=…" --set "ANTHROPIC_API_KEY=…" (or CLAUDE_CODE_OAUTH_TOKEN) --set "KAIROS_WORKER_TOKEN=…" --set "TZ=<timezone>" --set "RAILWAY_DOCKERFILE_PATH=Dockerfile.worker"`
   `RAILWAY_DOCKERFILE_PATH` is what makes Railway build from `Dockerfile.worker` instead of autodetecting.
3. `railway up --detach` — uploads this workspace and builds. Watch with `railway logs --build` until the build succeeds; on failure, read the error, fix, re-up.
4. `railway domain` — generates the public URL. Capture it.
5. `railway status --json` — capture the service id.
6. Save to `kairos/kairos.json`: `worker.url` (the domain, with https://), and `railway.serviceId`. `worker.token` should already be there — if not, set it to the KAIROS_WORKER_TOKEN you deployed.
7. Verify: `curl -s -H "Authorization: Bearer <worker token>" https://<domain>/health` — expect `"service":"kairos-worker"`. Give the container a minute to boot before declaring failure; retry twice.

## Judgment rules

- **Secrets never appear in output.** Mask everything as `…last4`. Never write a secret into any repo file — variables live on Railway, tokens in ~/.kairos.
- ALWAYS a brand-new project: `railway unlink` first (ignore 'not linked' errors), then `railway init --name kairos-worker`. NEVER link to or deploy onto any existing project — not a stale kairos-worker from an earlier attempt, not an unrelated app, nothing. If init keeps failing, STOP and report the exact error to the human instead of retrying in a loop or hunting for an existing project to reuse.
- If the build fails on the Dockerfile, check `RAILWAY_DOCKERFILE_PATH` was actually set before re-running.
- Cost honesty: remind the human this runs ~$5/mo on Hobby plus AI usage; the spend limit is the backstop.
- Any step you cannot complete non-interactively (e.g., account not on a paid plan): stop, tell the human exactly what to click, and resume after.

## Verification

`/health` responding with the schedule is the finish line — then open the loop: automations picked in chat land in `kairos/automations.json`, and the deployed worker picks up file changes only at the NEXT deploy (`railway up`) unless a volume is mounted — so after changing automations, run `railway up --detach` again, or tell the human "redeploy to sync" in your report. Confirm the dashboard's Automations page shows the worker strip as up. Report: project name, domain, variables set (names only), and the verified health line.
