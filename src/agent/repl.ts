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
import { saveConfig, type KairosConfig } from '../config/kairosConfig.js';
import type { BrainConfig } from '../util/brain.js';
import { describeBrain, ensureBrainReady, toSettings } from '../config/brainSetup.js';
import { kairosPaths } from '../paths.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildToolServer } from './tools.js';
import { sanitize } from '../util/sanitize.js';
import { mdToAnsi } from '../ui/markdown.js';

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

/**
 * Keep the chat floating a few rows off the terminal floor — content glued
 * to the very bottom edge reads badly. Reserves blank rows below the
 * cursor (scrolls if needed), then puts the cursor back.
 */
const BOTTOM_PAD = 3;
function padBottom(): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\n'.repeat(BOTTOM_PAD) + `\x1b[${BOTTOM_PAD}A`);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');
const visibleLength = (text: string): number => stripAnsi(text).length;

/** ANSI-aware word wrap — codes travel with their words, width counts glyphs. */
function wrapLine(line: string, width: number): string[] {
  if (visibleLength(line) <= width) return [line];
  const words = line.split(' ');
  const wrapped: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && visibleLength(current) + 1 + visibleLength(word) > width) {
      wrapped.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function chatWidth(): number {
  return Math.min((process.stdout.columns || 80) - 4, 96);
}

class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private frame = 0;
  private label = '';
  private readonly enabled = Boolean(process.stdout.isTTY);

  start(label: string): void {
    this.label = label;
    if (!this.enabled || this.timer) return;
    padBottom();
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

/**
 * Type Kai's reply on, Claude-Code style. Markdown is converted to ANSI
 * styling (no raw asterisks), and long replies speed up so the animation
 * never drags.
 */
async function printAssistantText(text: string): Promise<void> {
  const rendered = mdToAnsi(sanitize(text.trim()));
  const lines = rendered.split('\n').flatMap((line) => wrapLine(line, chatWidth()));
  if (!process.stdout.isTTY) {
    console.log(`\n${CYAN}⏺${RESET} ${lines[0] ?? ''}`);
    for (const line of lines.slice(1)) console.log(`  ${line}`);
    return;
  }
  // Stream word-by-word at reading pace, like watching the model write.
  const plainLength = visibleLength(rendered);
  const wordDelay = plainLength > 1200 ? 16 : plainLength > 500 ? 26 : 38;
  process.stdout.write(`\n${CYAN}⏺${RESET} `);
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) process.stdout.write('\n  ');
    const words = (lines[index] ?? '').split(' ');
    for (let w = 0; w < words.length; w++) {
      process.stdout.write((w > 0 ? ' ' : '') + words[w]);
      await sleep(wordDelay);
    }
  }
  process.stdout.write('\n');
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

/** Compact ⎿ summary under a tool call, Claude-Code style. */
function printToolResult(block: { content?: unknown; is_error?: boolean }): void {
  let text = '';
  if (typeof block.content === 'string') {
    text = block.content;
  } else if (Array.isArray(block.content)) {
    text = block.content
      .map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join(' ');
  }
  const flat = sanitize(text).replace(/\s+/g, ' ').trim();
  const summary = flat.length > 76 ? `${flat.slice(0, 73)}…` : flat || 'done';
  const color = block.is_error ? '\x1b[38;2;248;113;113m' : DIM;
  console.log(`  ${DIM}⎿${RESET} ${color}${summary}${RESET}`);
}

function printHelp(): void {
  console.log(
    `\n${DIM}  /new    start a fresh conversation (Kai forgets this session, keeps kairos/ files)\n` +
      `  /setup  print your setup prompt (kairos/SETUP_PROMPT.md)\n` +
      `  /help   this\n` +
      `  exit    leave (scheduled posts publish from CreatorOS servers either way)\n` +
      `  esc     interrupt Kai mid-turn\n` +
      `  kai     in another terminal: a second, independent session on this same workspace${RESET}\n`,
  );
}

/**
 * Double-rule input, the Claude Code look — a full-width line above AND
 * below the prompt:
 *   ────────────────────────────
 *   ❯ type here
 *   ────────────────────────────
 * readline clears everything below the cursor on every keystroke, so the
 * bottom rule is repainted after each key (cursor save/restore, scheduled
 * after readline's own refresh).
 */
async function readUserInput(): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    try {
      return await rl.question('❯ ');
    } catch {
      return null;
    } finally {
      rl.close();
    }
  }

  padBottom();
  const width = process.stdout.columns || 80;
  const rule = `${DIM}${'─'.repeat(width)}${RESET}`;
  process.stdout.write(`\n${rule}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let active = true;
  const repaintBottomRule = () => {
    if (!active) return;
    // save cursor → one row down → repaint the rule → restore cursor
    process.stdout.write(`\x1b7\x1b[1B\r\x1b[2K${rule}\x1b8`);
  };
  const onKeystroke = () => setImmediate(repaintBottomRule);
  process.stdin.on('data', onKeystroke);
  setImmediate(repaintBottomRule);

  try {
    const answer = await rl.question(`${BOLD}${CYAN}❯${RESET} `);
    active = false;
    // Enter moved the cursor onto the bottom-rule row — leave it clean.
    process.stdout.write(`\r\x1b[2K${rule}\n`);
    return answer;
  } catch {
    active = false;
    return null;
  } finally {
    active = false;
    process.stdin.off('data', onKeystroke);
    rl.close();
  }
}

/** ANSI-aware boxed welcome card. */
function printWelcomeCard(lines: string[]): void {
  const width = Math.max(...lines.map(visibleLength)) + 2;
  console.log(`  ${DIM}╭${'─'.repeat(width)}╮${RESET}`);
  for (const line of lines) {
    const pad = ' '.repeat(width - visibleLength(line) - 1);
    console.log(`  ${DIM}│${RESET} ${line}${pad}${DIM}│${RESET}`);
  }
  console.log(`  ${DIM}╰${'─'.repeat(width)}╯${RESET}`);
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

  // A brain reconfigured at startup is remembered — next run skips the question.
  if (config) {
    const settings = toSettings(brain);
    if (JSON.stringify(settings) !== JSON.stringify(config.brain ?? { provider: 'claude' })) {
      config.brain = settings;
      await saveConfig(kairosPaths(workspaceRoot).configJson, config);
    }
  }

  console.log(BANNER);
  printWelcomeCard([
    `${AMBER}✻${RESET} ${SILVER}Kai — the CreatorOS agent${RESET}`,
    '',
    `${DIM}key${RESET}      ${client.maskedKey}`,
    `${DIM}pathway${RESET}  ${config?.automationTarget ?? 'local'} · ${config?.timezone ?? 'UTC'}`,
    `${DIM}brain${RESET}    ${describeBrain(brain)}`,
    '',
    `${DIM}/help for commands · esc interrupts a turn${RESET}`,
  ]);

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
                await printAssistantText(block.text);
              } else if (block.type === 'tool_use') {
                spinner.stop();
                printToolLine(block.name, block.input);
              }
            }
            spinner.start('kai is working…');
          } else if (message.type === 'user') {
            const content = (message as { message?: { content?: unknown } }).message?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block && typeof block === 'object' && (block as { type?: string }).type === 'tool_result') {
                  spinner.stop();
                  printToolResult(block as { content?: unknown; is_error?: boolean });
                }
              }
              spinner.start('kai is working…');
            }
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
