/**
 * The Kairos Dashboard server — `npm run dashboard`.
 *
 * A small zero-config local server: static UI from dashboard/public/ plus
 * JSON endpoints under /api/*. No database, no auth, no build step — it
 * reads the same workspace files the agent reads (kairos/BRAND.md,
 * kairos/kairos.json, kairos/skills/) and the structured activity log the
 * tool layer writes (logs/activity.jsonl).
 *
 * Endpoints (all local, all JSON — build your own UI against them):
 *   GET  /api/health       credentials, config files, brain, last action
 *   GET  /api/activity     log entries + counters + heatmap (?workflow=&platform=&outcome=&limit=)
 *   GET  /api/automations  every automation: state, prompts, per-workflow stats
 *   GET  /api/brand        the brand identity file ({path, mtime, content})
 *   PUT  /api/brand        save edits back to disk ({content})
 *   GET  /api/workflows    training/workflow files the agent runs on
 *   PUT  /api/workflows    save one file ({id, content})
 *   POST /api/chat         talk to the agent; streams NDJSON events
 *
 * Missing credentials never crash anything: endpoints answer with
 * {connected:false} shapes and the UI renders a connect state.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CreatorOSClient } from '../src/client/client.js';
import { loadConfig, type KairosConfig } from '../src/config/kairosConfig.js';
import { resolveApiKey } from '../src/config/credentials.js';
import { hydrateBrain, describeBrain } from '../src/config/brainSetup.js';
import type { BrainConfig } from '../src/util/brain.js';
import { buildSystemPrompt } from '../src/agent/systemPrompt.js';
import { buildToolServer } from '../src/agent/tools.js';
import { verifyAutomations } from '../src/automations/crons.js';
import { workflowCatalog } from '../src/dashboard/workflows.js';
import { readActivity, summarizeActivity } from '../src/util/activityLog.js';
import { kairosPaths } from '../src/paths.js';
import { sanitize } from '../src/util/sanitize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const REPO_ROOT = join(HERE, '..');

export const DEFAULT_PORT = 4180;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(sanitize(JSON.stringify(body)));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > 2_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolvePromise(data));
    req.on('error', reject);
  });
}

export function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // the URL is printed either way
  }
}

/** Session state resolved once at boot; the dashboard reflects it honestly. */
interface Session {
  workspaceRoot: string;
  client: CreatorOSClient | null;
  config: KairosConfig | null;
  brain: BrainConfig | null;
}

async function loadSession(workspaceRoot: string): Promise<Session> {
  const paths = kairosPaths(workspaceRoot);
  const apiKey = await resolveApiKey();
  const client = apiKey ? new CreatorOSClient({ apiKey }) : null;
  const config = existsSync(paths.configJson) ? await loadConfig(paths.configJson) : null;
  const brain = await hydrateBrain(config?.brain ?? undefined);
  return { workspaceRoot, client, config, brain };
}

/* ------------------------------------------------------------------ */
/* /api/health — "is my agent working?" in one payload                 */
/* ------------------------------------------------------------------ */

// Credential checks hit the real API; cache for 60s so the UI can poll.
let credCache: { at: number; result: { present: boolean; valid: boolean; maskedKey?: string; error?: string } } | null = null;

async function healthPayload(session: Session): Promise<unknown> {
  const paths = kairosPaths(session.workspaceRoot);

  if (!credCache || Date.now() - credCache.at > 60_000) {
    if (!session.client) {
      credCache = { at: Date.now(), result: { present: false, valid: false } };
    } else {
      try {
        const valid = await session.client.validateKey();
        credCache = {
          at: Date.now(),
          result: {
            present: true,
            valid,
            maskedKey: session.client.maskedKey,
            ...(valid ? {} : { error: 'CreatorOS rejected the key — check it in the CreatorOS app under Settings → API Key.' }),
          },
        };
      } catch (error) {
        credCache = {
          at: Date.now(),
          result: { present: true, valid: false, maskedKey: session.client.maskedKey, error: (error as Error).message },
        };
      }
    }
  }

  const fileInfo = async (label: string, path: string) => {
    try {
      const s = await stat(path);
      return { label, path: relative(session.workspaceRoot, path), exists: true, mtime: s.mtime.toISOString() };
    } catch {
      return { label, path: relative(session.workspaceRoot, path), exists: false };
    }
  };
  const files = await Promise.all([
    fileInfo('config', paths.configJson),
    fileInfo('brand', paths.brandMd),
    fileInfo('profiles', paths.profilesMd),
  ]);

  const entries = await readActivity(session.workspaceRoot, { limit: 1 });
  const lastAction = entries[0] ?? null;
  const automationsOn = Boolean(
    session.config?.funnel?.enabled ||
      session.config?.autoReplies?.comments.enabled ||
      session.config?.autoReplies?.messages.enabled,
  );
  const silentMs = lastAction ? Date.now() - Date.parse(lastAction.ts) : null;

  return {
    now: new Date().toISOString(),
    credentials: credCache.result,
    configLoaded: session.config !== null,
    files,
    brain: { label: describeBrain(session.config?.brain), ready: session.brain !== null },
    automationsOn,
    lastAction,
    // Silent >24h while automations are on = something is probably stuck.
    stale: automationsOn && (silentMs === null || silentMs > 24 * 3_600_000),
  };
}

/* ------------------------------------------------------------------ */
/* /api/automations — live state + local config + log-derived stats    */
/* ------------------------------------------------------------------ */

async function automationsPayload(session: Session): Promise<unknown> {
  const config = session.config;
  const summary = summarizeActivity(await readActivity(session.workspaceRoot));
  const crons = await verifyAutomations(session.workspaceRoot);
  let liveFunnels: unknown = null;
  if (session.client) {
    try {
      liveFunnels = await session.client.listCommentAutomations(config?.profileId);
    } catch (error) {
      liveFunnels = { error: (error as Error).message };
    }
  }
  const stats = (workflow: string) => summary.perWorkflow.find((w) => w.workflow === workflow) ?? null;
  const tone = config?.autoReplies?.comments.tone ?? config?.autoReplies?.messages.tone ?? null;
  const persona = config?.engagementAgent
    ? `${config.engagementAgent.persona}\n\nObjective: ${config.engagementAgent.objective}${config.engagementAgent.objectiveDetail ? ` — ${config.engagementAgent.objectiveDetail}` : ''}`
    : null;

  return {
    connected: session.client !== null,
    automations: [
      {
        id: 'reply-to-comments',
        name: 'Reply to comments',
        enabled: Boolean(config?.autoReplies?.comments.enabled),
        platforms: config?.autoReplies?.comments.platforms ?? [],
        systemPrompt: persona ?? tone,
        escalate: config?.autoReplies?.comments.escalate ?? [],
        stats: stats('respond-to-comments') ?? stats('engagement-sweep'),
      },
      {
        id: 'reply-to-messages',
        name: 'Reply to messages (DMs)',
        enabled: Boolean(config?.autoReplies?.messages.enabled),
        platforms: config?.autoReplies?.messages.platforms ?? [],
        systemPrompt: persona ?? tone,
        escalate: config?.autoReplies?.messages.escalate ?? [],
        stats: stats('respond-to-comments') ?? stats('engagement-sweep'),
      },
      {
        id: 'comment-dm-funnel',
        name: 'Comments → DM funnel',
        enabled: Boolean(config?.funnel?.enabled),
        keywords: config?.funnel?.keywords ?? [],
        systemPrompt: config?.funnel?.dmMessage || null,
        link: config?.funnel?.link ?? null,
        stats: stats('funnel'),
      },
    ],
    crons: { ok: crons.code === 0, output: crons.stdout.trim() || crons.stderr.trim() },
    catalog: workflowCatalog(crons.code === 0 ? crons.stdout : ''),
    liveFunnels,
    perWorkflow: summary.perWorkflow,
  };
}

/* ------------------------------------------------------------------ */
/* Brand + training files — render + edit-in-place                     */
/* ------------------------------------------------------------------ */

/** Only files the agent actually reads are editable; ids are workspace-relative. */
function isEditablePath(workspaceRoot: string, id: string): string | null {
  if (isAbsolute(id) || id.includes('..')) return null;
  const full = resolve(workspaceRoot, id);
  const rel = relative(workspaceRoot, full);
  const allowed =
    rel === join('kairos', 'BRAND.md') ||
    rel.startsWith(join('kairos', 'skills') + '/') ||
    rel.startsWith(join('templates', 'skills') + '/');
  return allowed && rel.endsWith('.md') ? full : null;
}

async function brandPayload(session: Session): Promise<unknown> {
  const paths = kairosPaths(session.workspaceRoot);
  try {
    const [content, s] = await Promise.all([readFile(paths.brandMd, 'utf8'), stat(paths.brandMd)]);
    return {
      exists: true,
      id: relative(session.workspaceRoot, paths.brandMd),
      path: relative(session.workspaceRoot, paths.brandMd),
      mtime: s.mtime.toISOString(),
      content,
    };
  } catch {
    return { exists: false, path: relative(session.workspaceRoot, paths.brandMd) };
  }
}

/**
 * Training files = the skill playbooks the agent executes. Installed ones
 * (kairos/skills/) take precedence; on a fresh clone the repo templates
 * (templates/skills/) are listed so there is always something to read.
 */
async function workflowFilesPayload(session: Session): Promise<unknown> {
  const paths = kairosPaths(session.workspaceRoot);
  const roots = existsSync(paths.skillsDir)
    ? [{ dir: paths.skillsDir, source: 'installed' }]
    : [{ dir: join(REPO_ROOT, 'templates', 'skills'), source: 'template' }];
  const summary = summarizeActivity(await readActivity(session.workspaceRoot));

  const files: unknown[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = await readdir(root.dir);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      const path = join(root.dir, name, 'SKILL.md');
      try {
        const [content, s] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
        const heading = content.split('\n').find((line) => line.startsWith('#'));
        const usage = summary.perWorkflow.find((w) => w.workflow === name) ?? null;
        files.push({
          id: relative(session.workspaceRoot, path),
          name,
          source: root.source,
          purpose: heading ? heading.replace(/^#+\s*/, '') : name,
          mtime: s.mtime.toISOString(),
          content,
          lastUsed: usage?.lastTs ?? null,
          stats: usage,
        });
      } catch {
        // a skill dir without SKILL.md — skip
      }
    }
  }
  return { files, source: roots[0]?.source };
}

async function saveFile(session: Session, id: string, content: string): Promise<{ ok: boolean; error?: string }> {
  const full = isEditablePath(session.workspaceRoot, id);
  if (!full) return { ok: false, error: 'That file is not editable from the dashboard.' };
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* /api/chat — the agent itself, streaming NDJSON                      */
/* ------------------------------------------------------------------ */

async function handleChat(session: Session, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message = '';
  let sessionId: string | undefined;
  try {
    const body = JSON.parse((await readBody(req)) || '{}') as { message?: string; sessionId?: string };
    message = (body.message ?? '').trim();
    sessionId = body.sessionId || undefined;
  } catch {
    json(res, 400, { error: 'invalid JSON body' });
    return;
  }
  if (!message) {
    json(res, 400, { error: 'message required' });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const send = (event: Record<string, unknown>) => res.write(`${sanitize(JSON.stringify(event))}\n`);

  if (!session.client) {
    send({ type: 'error', text: 'Connect your CreatorOS account first — run `npm start creatoros kairos` in a terminal.' });
    send({ type: 'done' });
    res.end();
    return;
  }
  if (!session.brain) {
    send({ type: 'error', text: 'The AI brain is not connected on this machine. Run `kai` once in a terminal to plug it in, then restart the dashboard.' });
    send({ type: 'done' });
    res.end();
    return;
  }

  const brainEnv: Record<string, string> =
    session.brain.provider === 'custom'
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: session.brain.baseUrl,
          ANTHROPIC_API_KEY: session.brain.apiKey,
          ANTHROPIC_MODEL: session.brain.model,
        }
      : (process.env as Record<string, string>);

  try {
    const turn = query({
      prompt: message,
      options: {
        systemPrompt: buildSystemPrompt(session.config),
        mcpServers: { creatoros: buildToolServer(session.client, session.workspaceRoot, session.config) },
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
        cwd: session.workspaceRoot,
        env: brainEnv,
        ...(session.brain.provider === 'custom' ? { model: session.brain.model } : {}),
        ...(sessionId ? { resume: sessionId } : {}),
      },
    });
    req.on('close', () => {
      void turn.interrupt().catch(() => {});
    });
    for await (const msg of turn) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        send({ type: 'init', sessionId: msg.session_id });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) send({ type: 'text', text: block.text });
          else if (block.type === 'tool_use')
            send({
              type: 'tool',
              name: block.name.replace(/^mcp__creatoros__/, ''),
              args: JSON.stringify(block.input ?? {}).slice(0, 200),
            });
        }
      } else if (msg.type === 'user') {
        const content = (msg as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
              const b = block as { content?: unknown; is_error?: boolean };
              let text = '';
              if (typeof b.content === 'string') text = b.content;
              else if (Array.isArray(b.content))
                text = b.content
                  .map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
                  .join(' ');
              const flat = text.replace(/\s+/g, ' ').trim();
              send({
                type: 'tool_result',
                text: flat.length > 160 ? `${flat.slice(0, 157)}…` : flat || 'done',
                isError: Boolean(b.is_error),
              });
            }
          }
        }
      } else if (msg.type === 'result' && msg.subtype !== 'success') {
        send({ type: 'error', text: `turn ended: ${msg.subtype}` });
      }
    }
    send({ type: 'done' });
  } catch (error) {
    send({ type: 'error', text: (error as Error).message });
    send({ type: 'done' });
  }
  res.end();
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startDashboard(
  workspaceRoot: string = REPO_ROOT,
  port: number = Number(process.env.KAIROS_DASHBOARD_PORT) || DEFAULT_PORT,
): Promise<DashboardHandle> {
  const session = await loadSession(workspaceRoot);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    const handle = async (): Promise<void> => {
      // ---- JSON API ----
      if (route === 'GET /api/health') return json(res, 200, await healthPayload(session));
      if (route === 'GET /api/activity') {
        const filter = {
          workflow: url.searchParams.get('workflow') ?? undefined,
          platform: url.searchParams.get('platform') ?? undefined,
          outcome: url.searchParams.get('outcome') ?? undefined,
          limit: Number(url.searchParams.get('limit')) || 200,
        };
        const all = await readActivity(session.workspaceRoot);
        return json(res, 200, {
          entries: (await readActivity(session.workspaceRoot, filter)).slice(0, filter.limit),
          summary: summarizeActivity(all),
        });
      }
      if (route === 'GET /api/automations') return json(res, 200, await automationsPayload(session));
      if (route === 'GET /api/brand') return json(res, 200, await brandPayload(session));
      if (route === 'GET /api/workflows') return json(res, 200, await workflowFilesPayload(session));
      if (route === 'PUT /api/brand' || route === 'PUT /api/workflows') {
        const body = JSON.parse((await readBody(req)) || '{}') as { id?: string; content?: string };
        const paths = kairosPaths(session.workspaceRoot);
        const id = route === 'PUT /api/brand' ? relative(session.workspaceRoot, paths.brandMd) : (body.id ?? '');
        if (typeof body.content !== 'string') return json(res, 400, { error: 'content required' });
        const result = await saveFile(session, id, body.content);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (route === 'POST /api/chat') return handleChat(session, req, res);

      // ---- static UI ----
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = resolve(PUBLIC_DIR, `.${pathname}`);
      if (file.startsWith(PUBLIC_DIR) && existsSync(file)) {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
        return;
      }
      // Unknown page routes fall back to the SPA shell.
      if (!url.pathname.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': MIME['.html']! });
        res.end(await readFile(join(PUBLIC_DIR, 'index.html')));
        return;
      }
      json(res, 404, { error: 'not found' });
    };

    handle().catch((error) => {
      if (!res.headersSent) json(res, 500, { error: sanitize((error as Error).message) });
      else res.end();
    });
  });

  const boundUrl = await new Promise<string>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(`http://localhost:${port}`));
  });

  return { url: boundUrl, close: () => new Promise<void>((r) => server.close(() => r())) };
}

// `npm run dashboard` executes this file directly.
const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('dashboard/server.ts');
if (invokedDirectly) {
  startDashboard()
    .then(({ url }) => {
      console.log('\n  ┌──────────────────────────────────────────────┐');
      console.log(`  │  Kairos Dashboard →  ${url.padEnd(23)} │`);
      console.log('  └──────────────────────────────────────────────┘');
      console.log('  Reads local files + your CreatorOS account. Ctrl-C stops it;');
      console.log('  automations keep running on their schedules either way.\n');
      openBrowser(url);
    })
    .catch((error) => {
      console.error(`Dashboard failed to start: ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
