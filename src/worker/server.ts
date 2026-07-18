/**
 * The worker's status surface — what the dashboard polls. Plain HTTP,
 * two GET routes, bearer-token auth. Deliberately not a gateway/RPC:
 * the dashboard needs "is it alive, what ran, what failed" and nothing
 * else.
 *
 *   GET /health  service, uptime, schedule with next-run times, current run
 *   GET /runs    run journal, newest first (?automation=&status=&limit=)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { KairosStore, RunStatus } from '../storage/store.js';

export interface WorkerHealth {
  service: 'kairos-worker';
  startedAt: string;
  timezone: string;
  automations: Array<{
    name: string;
    schedule: string;
    skill: string;
    enabled: boolean;
    nextRun: string | null;
  }>;
  /** Name of the automation running right now, if any. */
  running: string | null;
}

export interface WorkerServerOptions {
  /** When set, every route requires `Authorization: Bearer <token>`. */
  token?: string;
  getHealth: () => WorkerHealth;
  store: KairosStore;
}

export function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

async function handle(req: IncomingMessage, res: ServerResponse, opts: WorkerServerOptions): Promise<void> {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (!authorized(req, opts.token)) return json(401, { error: 'unauthorized' });
  const url = new URL(req.url ?? '/', 'http://worker');
  if (req.method !== 'GET') return json(405, { error: 'method not allowed' });
  if (url.pathname === '/health') return json(200, opts.getHealth());
  if (url.pathname === '/runs') {
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const runs = await opts.store.listRuns({
      automation: url.searchParams.get('automation') ?? undefined,
      status: (url.searchParams.get('status') as RunStatus | null) ?? undefined,
      limit: Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 50,
    });
    return json(200, { runs });
  }
  return json(404, { error: 'not found' });
}

export function createWorkerServer(opts: WorkerServerOptions): Server {
  return createServer((req, res) => {
    void handle(req, res, opts).catch((error) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String((error as Error).message) }));
    });
  });
}
