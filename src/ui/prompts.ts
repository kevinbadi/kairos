/**
 * Paste-safe free-text prompt. Single-line inquirer inputs treat every
 * newline in pasted text as "submit", which bleeds one pasted answer
 * across multiple questions. This collector buffers every line the moment
 * it arrives (so a fast paste can't slip past a prompt) and reads until an
 * empty line — a multi-line paste lands in ONE answer.
 */
import { createInterface } from 'node:readline';

export interface AskBlockOptions {
  required?: boolean;
  /** Re-prompt with this message when validation fails. */
  validate?: (value: string) => true | string;
}

// Module-level overflow: lines a paste delivered beyond the answer being
// collected survive here for the NEXT askBlock instead of being dropped
// when the current reader closes.
const buffered: string[] = [];

export async function askBlock(message: string, options: AskBlockOptions = {}): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });

  // Buffer lines as they arrive — question()-style APIs drop lines that
  // land between prompts, which is exactly what a paste does.
  let waiter: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(line);
    } else {
      buffered.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(null);
    }
  });

  const nextLine = (): Promise<string | null> => {
    if (buffered.length > 0) return Promise.resolve(buffered.shift()!);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };

  try {
    while (true) {
      process.stdout.write(`? ${message}\n`);
      process.stdout.write('\x1b[2m  (paste freely — empty line to finish)\x1b[0m\n> ');
      const lines: string[] = [];
      while (true) {
        const line = await nextLine();
        if (line === null) break; // stdin closed — take what we have
        if (line.trim() === '') {
          if (lines.length > 0) break; // done
          if (!options.required) break; // optional + empty = skip
          process.stdout.write('  (this one matters — give me at least a line)\n> ');
          continue;
        }
        lines.push(line);
      }
      const value = lines.join('\n').trim();
      const verdict = options.validate?.(value) ?? true;
      if (verdict === true) return value;
      process.stdout.write(`  ${verdict}\n`);
      if (closed) return value; // can't re-ask without stdin
    }
  } finally {
    rl.close();
  }
}

/** Paste-safe list: accepts comma-separated AND one-per-line pastes. */
export async function askList(message: string, options: { max?: number } = {}): Promise<string[]> {
  const raw = await askBlock(message);
  const items = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return options.max ? items.slice(0, options.max) : items;
}
