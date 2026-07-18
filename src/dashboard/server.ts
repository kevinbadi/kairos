/**
 * The Kairos dashboard — `kai dashboard`. A local web surface over the
 * same workspace the chat runs on: every automation and workflow the
 * agent is running (and whether it's performing), analytics, and the
 * agent chat itself streaming in the browser.
 *
 * Local-only by design: binds 127.0.0.1, zero new dependencies
 * (node:http), and every string that could carry an internal vendor name
 * passes through sanitize() before it reaches the browser. API keys never
 * leave the machine — the browser only ever sees the masked form.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { KairosConfig } from '../config/kairosConfig.js';
import { hydrateBrain, describeBrain } from '../config/brainSetup.js';
import type { BrainConfig } from '../util/brain.js';
import { buildSystemPrompt } from '../agent/systemPrompt.js';
import { buildToolServer } from '../agent/tools.js';
import { platformLabel } from '../client/platformMatrix.js';
import { verifyAutomations } from '../automations/crons.js';
import { workflowCatalog } from './workflows.js';
import { sanitize } from '../util/sanitize.js';

const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'templates',
  'dashboard.html',
);

export const DEFAULT_DASHBOARD_PORT = 5717;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = sanitize(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Open the default browser without caring whether it worked. */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // the URL is printed either way
  }
}

interface ChatEvent {
  type: 'init' | 'text' | 'tool' | 'tool_result' | 'done' | 'error';
  sessionId?: string;
  text?: string;
  name?: string;
  args?: string;
  isError?: boolean;
}

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startDashboard(
  client: CreatorOSClient,
  config: KairosConfig | null,
  workspaceRoot: string,
  port: number = DEFAULT_DASHBOARD_PORT,
): Promise<DashboardHandle> {
  const systemPrompt = buildSystemPrompt(config);
  const toolServer = buildToolServer(client, workspaceRoot, config);

  // The chat brain: hydrated once, non-interactively. A missing brain
  // doesn't block the dashboard — the chat pane explains what to run.
  const brain: BrainConfig | null = await hydrateBrain(config?.brain);
  const brainEnv: Record<string, string> =
    brain?.provider === 'custom'
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: brain.baseUrl,
          ANTHROPIC_API_KEY: brain.apiKey,
          ANTHROPIC_MODEL: brain.model,
        }
      : (process.env as Record<string, string>);

  const handleOverview = async (res: ServerResponse): Promise<void> => {
    const { accounts } = await client.listAccounts();
    let health: { accounts?: Array<{ accountId: string; status: string }> } = {};
    try {
      health = (await client.accountsHealth()) as typeof health;
    } catch {
      // health can be add-on gated; active flags still tell the story
    }
    json(res, 200, {
      maskedKey: client.maskedKey,
      mode: config?.mode ?? 'creator',
      pathway: config?.automationTarget ?? 'local',
      timezone: config?.timezone ?? 'UTC',
      brain: describeBrain(config?.brain),
      brainReady: brain !== null,
      onboardedAt: config?.onboardedAt,
      accounts: accounts.map((account) => ({
        id: account._id,
        platform: platformLabel(account.platform),
        username: account.username ?? 'unknown',
        active: account.isActive !== false,
        health: health.accounts?.find((h) => h.accountId === account._id)?.status,
      })),
    });
  };

  const handleAutomations = async (res: ServerResponse): Promise<void> => {
    const crons = await verifyAutomations(workspaceRoot);
    let liveFunnels: unknown = null;
    try {
      liveFunnels = await client.listCommentAutomations(config?.profileId);
    } catch {
      liveFunnels = null;
    }
    json(res, 200, {
      crons: { ok: crons.code === 0, output: crons.stdout.trim() || crons.stderr.trim() },
      funnel: config?.funnel ?? { enabled: false },
      liveFunnels,
      autoReplies: config?.autoReplies ?? null,
      engagementAgent: config?.engagementAgent ?? null,
    });
  };

  const handleAnalytics = async (res: ServerResponse): Promise<void> => {
    let followers: unknown = null;
    let posts: unknown = null;
    try {
      followers = await client.followerStats();
    } catch (error) {
      followers = { error: (error as Error).message };
    }
    try {
      posts = await client.listPosts({ limit: 12, sortBy: 'created-desc' });
    } catch (error) {
      posts = { error: (error as Error).message };
    }
    json(res, 200, { followers, posts });
  };

  const handleWorkflows = async (res: ServerResponse): Promise<void> => {
    const crons = await verifyAutomations(workspaceRoot);
    json(res, 200, { workflows: workflowCatalog(crons.code === 0 ? crons.stdout : '') });
  };

  const handleChat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let message = '';
    let sessionId: string | undefined;
    try {
      const body = JSON.parse((await readBody(req)) || '{}') as {
        message?: string;
        sessionId?: string;
      };
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

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: ChatEvent) => res.write(`${sanitize(JSON.stringify(event))}\n`);

    if (!brain) {
      send({
        type: 'error',
        text: 'The AI brain is not connected on this machine. Run `kai` once in a terminal to plug it in, then restart the dashboard.',
      });
      send({ type: 'done' });
      res.end();
      return;
    }

    try {
      const turn = query({
        prompt: message,
        options: {
          systemPrompt,
          mcpServers: { creatoros: toolServer },
          permissionMode: 'bypassPermissions',
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
          cwd: workspaceRoot,
          env: brainEnv,
          ...(brain.provider === 'custom' ? { model: brain.model } : {}),
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
            if (block.type === 'text' && block.text.trim()) {
              send({ type: 'text', text: block.text });
            } else if (block.type === 'tool_use') {
              send({
                type: 'tool',
                name: block.name.replace(/^mcp__creatoros__/, ''),
                args: JSON.stringify(block.input ?? {}).slice(0, 200),
              });
            }
          }
        } else if (msg.type === 'user') {
          const content = (msg as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
                const b = block as { content?: unknown; is_error?: boolean };
                let text = '';
                if (typeof b.content === 'string') text = b.content;
                else if (Array.isArray(b.content)) {
                  text = b.content
                    .map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
                    .join(' ');
                }
                const flat = text.replace(/\s+/g, ' ').trim();
                send({
                  type: 'tool_result',
                  text: flat.length > 160 ? `${flat.slice(0, 157)}…` : flat || 'done',
                  isError: Boolean(b.is_error),
                });
              }
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype !== 'success') {
            send({ type: 'error', text: `turn ended: ${msg.subtype}` });
          }
        }
      }
      send({ type: 'done' });
    } catch (error) {
      send({ type: 'error', text: (error as Error).message });
      send({ type: 'done' });
    }
    res.end();
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = `${req.method} ${url.pathname}`;
    const handle = async (): Promise<void> => {
      if (route === 'GET /') {
        const html = await readFile(TEMPLATE_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(sanitize(html));
      } else if (route === 'GET /api/overview') {
        await handleOverview(res);
      } else if (route === 'GET /api/automations') {
        await handleAutomations(res);
      } else if (route === 'GET /api/analytics') {
        await handleAnalytics(res);
      } else if (route === 'GET /api/workflows') {
        await handleWorkflows(res);
      } else if (route === 'POST /api/chat') {
        await handleChat(req, res);
      } else {
        json(res, 404, { error: 'not found' });
      }
    };
    handle().catch((error) => {
      if (!res.headersSent) json(res, 500, { error: sanitize((error as Error).message) });
      else res.end();
    });
  });

  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`));
  });

  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
