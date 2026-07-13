/**
 * The Kairos chat — every run after onboarding lands here. Styled after
 * the Claude Code chat surface: ❯ input, ⏺ output bullets, live tool
 * activity lines, a spinner with elapsed time, and esc to interrupt.
 * Two engines behind the same surface: the Claude Agent SDK, or any
 * OpenAI-compatible API driving the same tool registry.
 */
import { createInterface } from 'node:readline/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { KairosConfig } from '../config/kairosConfig.js';
import type { BrainConfig } from '../util/brain.js';
import { describeBrain, ensureBrainReady } from '../config/brainSetup.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildToolServer } from './tools.js';
import { sanitize } from '../util/sanitize.js';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[38;2;0;229;255m';
const AMBER = '\x1b[38;2;255;176;0m';
const SILVER = '\x1b[38;2;203;213;225m';
const FRAMES = ['✳', '✶', '✻', '✽', '✻', '✶'];

const BANNER = `
  ██╗  ██╗ █████╗ ██╗██████╗  ██████╗ ███████╗
  ██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗██╔════╝
  █████╔╝ ███████║██║██████╔╝██║   ██║███████╗
  ██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║╚════██║
  ██║  ██╗██║  ██║██║██║  ██║╚██████╔╝███████║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
`;

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private frame = 0;
  private label = '';
  private readonly enabled = Boolean(process.stdout.isTTY);

  start(label: string): void {
    this.label = label;
    if (!this.enabled || this.timer) return;
    this.startedAt = Date.now();
    process.stdout.write('\x1b[?25l');
    this.timer = setInterval(() => this.render(), 110);
    this.render();
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.enabled && this.timer) this.render();
  }

  private render(): void {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const frame = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(
      `\r\x1b[2K${AMBER}${frame}${RESET} ${this.label} ${DIM}(${seconds}s · esc to interrupt)${RESET}`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    }
  }
}

/** Listen for a bare ESC while a turn runs; returns a disarm function. */
function armEscInterrupt(onEsc: () => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode(true);
  stdin.resume();
  const listener = (chunk: Buffer) => {
    if (chunk.length === 1 && chunk[0] === 0x1b) onEsc();
    if (chunk.length === 1 && chunk[0] === 0x03) {
      process.stdout.write('\n');
      process.exit(130);
    }
  };
  stdin.on('data', listener);
  return () => {
    stdin.off('data', listener);
    stdin.setRawMode(wasRaw);
    stdin.pause();
  };
}

function printAssistantText(text: string): void {
  const lines = sanitize(text.trim()).split('\n');
  console.log(`\n${CYAN}⏺${RESET} ${lines[0] ?? ''}`);
  for (const line of lines.slice(1)) console.log(`  ${line}`);
}

function printToolLine(name: string, args?: unknown): void {
  const pretty = name.replace(/^mcp__creatoros__/, '');
  let preview = '';
  if (args && typeof args === 'object' && Object.keys(args as object).length > 0) {
    preview = JSON.stringify(args);
    if (preview.length > 72) preview = `${preview.slice(0, 69)}…)`;
    preview = `(${preview.slice(1, -1)})`;
  } else {
    preview = '()';
  }
  console.log(`${SILVER}⏺${RESET} ${DIM}${pretty}${preview}${RESET}`);
}

function printHelp(): void {
  console.log(
    `\n${DIM}  /new    start a fresh conversation (Kai forgets this session, keeps kairos/ files)\n` +
      `  /setup  print your setup prompt (kairos/SETUP_PROMPT.md)\n` +
      `  /help   this\n` +
      `  exit    leave (scheduled posts publish from CreatorOS servers either way)\n` +
      `  esc     interrupt Kai mid-turn${RESET}\n`,
  );
}

async function readUserInput(): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  try {
    const rule = '─'.repeat(Math.min(60, process.stdout.columns || 60));
    process.stdout.write(`${DIM}${rule}${RESET}\n`);
    const answer = await rl.question(`${BOLD}${CYAN}❯ ${RESET}`);
    return answer;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

export async function runRepl(
  client: CreatorOSClient,
  config: KairosConfig | null,
  workspaceRoot: string,
): Promise<void> {
  // Brain readiness — if the Claude connection fails, the first question
  // is which AI model to use instead.
  let brain: BrainConfig;
  try {
    brain = await ensureBrainReady(config?.brain);
  } catch {
    return; // ctrl-c during the chooser
  }

  console.log(BANNER);
  console.log(
    `${DIM}  the CreatorOS agent · key ${client.maskedKey} · pathway ${config?.automationTarget ?? 'local'} · tz ${config?.timezone ?? 'UTC'} · brain ${describeBrain(brain)}\n  /help for commands${RESET}\n`,
  );

  const systemPrompt = buildSystemPrompt(config);
  const server = buildToolServer(client, workspaceRoot, config);

  // A custom brain rides the same engine, pointed at its API.
  const brainEnv: Record<string, string> =
    brain.provider === 'custom'
      ? {
          ...(process.env as Record<string, string>),
          ANTHROPIC_BASE_URL: brain.baseUrl,
          ANTHROPIC_API_KEY: brain.apiKey,
          ANTHROPIC_MODEL: brain.model,
        }
      : (process.env as Record<string, string>);

  let sessionId: string | undefined;

  while (true) {
    const userInput = await readUserInput();
    if (userInput === null) break;
    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', 'q', '/exit', '/quit'].includes(trimmed.toLowerCase())) break;
    if (trimmed === '/help') {
      printHelp();
      continue;
    }
    if (trimmed === '/new') {
      sessionId = undefined;
      console.log(`${DIM}  fresh conversation — kairos/ files still loaded${RESET}`);
      continue;
    }
    if (trimmed === '/setup') {
      try {
        const { readFile } = await import('node:fs/promises');
        console.log(await readFile(`${workspaceRoot}/kairos/SETUP_PROMPT.md`, 'utf8'));
      } catch {
        console.log(`${DIM}  no setup prompt found — finish onboarding first${RESET}`);
      }
      continue;
    }

    const spinner = new Spinner();
    try {
      const turn = query({
        prompt: trimmed,
        options: {
          systemPrompt,
          mcpServers: { creatoros: server },
          permissionMode: 'bypassPermissions',
          allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'TodoWrite'],
          cwd: workspaceRoot,
          env: brainEnv,
          ...(brain.provider === 'custom' ? { model: brain.model } : {}),
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });
      const disarm = armEscInterrupt(() => {
        void turn.interrupt().catch(() => {});
      });
      spinner.start(sessionId ? 'kai is thinking…' : 'waking the engine — first reply takes ~15s…');
      try {
        for await (const message of turn) {
          if (message.type === 'system' && message.subtype === 'init') {
            sessionId = message.session_id;
            spinner.setLabel('kai is thinking…');
          } else if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text' && block.text.trim()) {
                spinner.stop();
                printAssistantText(block.text);
              } else if (block.type === 'tool_use') {
                spinner.stop();
                printToolLine(block.name, block.input);
              }
            }
            spinner.start('kai is working…');
          } else if (message.type === 'result') {
            spinner.stop();
            if (message.subtype !== 'success') {
              const detail = 'result' in message && message.result ? ` — ${sanitize(String(message.result))}` : '';
              console.error(`\n(kai hit a wall: ${message.subtype}${detail})\n`);
            }
          }
        }
      } finally {
        spinner.stop();
        disarm();
      }
    } catch (error) {
      spinner.stop();
      console.error(`\n(kai error: ${sanitize((error as Error).message)})\n`);
    }
    console.log('');
  }
  console.log(`\n${DIM}Kai out. Your scheduled posts publish from CreatorOS servers either way.${RESET}`);
}
