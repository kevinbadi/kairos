/**
 * Inbound events (new comment / new message) arrive via CreatorOS webhooks.
 * Railway receives them natively; on the local pathway this lightweight
 * receiver can run during a session, with inbox polling as the fallback
 * (the engagement-sweep cron polls, so nothing is lost when it's offline).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

// Internal wire constant — never surfaces in user-facing output.
const SIGNATURE_HEADER = 'x-zernio-signature';

/** Hex HMAC-SHA256 of the raw body, keyed by the webhook secret. */
export function signBody(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(
  rawBody: string | Buffer,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const expected = Buffer.from(signBody(rawBody, secret), 'utf8');
  const received = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export interface WebhookEvent {
  id?: string;
  event: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface ReceiverOptions {
  port: number;
  secret?: string;
  onEvent: (event: WebhookEvent) => void | Promise<void>;
}

/** Start a minimal HTTP receiver. Returns the server (close() to stop). */
export function startReceiver(options: ReceiverOptions): Server {
  const seen = new Set<string>();
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (options.secret) {
        const header = req.headers[SIGNATURE_HEADER];
        const value = Array.isArray(header) ? header[0] : header;
        if (!verifySignature(raw, options.secret, value)) {
          res.writeHead(401).end();
          return;
        }
      }
      // Respond fast (CreatorOS requires 2xx within 5s), process after.
      res.writeHead(200).end();
      try {
        const event = JSON.parse(raw.toString('utf8')) as WebhookEvent;
        // At-least-once delivery — dedupe on event id.
        if (event.id) {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          if (seen.size > 5000) seen.clear();
        }
        void options.onEvent(event);
      } catch {
        // Unparseable body — already acked, nothing to process.
      }
    });
  });
  server.listen(options.port);
  return server;
}
