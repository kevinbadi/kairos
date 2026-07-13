/**
 * The Kairos REPL — every run after onboarding lands here. The user types
 * requests ("post this clip everywhere", "how did last week do?", "set up
 * the funnel on my launch post") and Kairos acts through its tool belt.
 */
import { input } from '@inquirer/prompts';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { KairosConfig } from '../config/kairosConfig.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildToolServer } from './tools.js';
import { sanitize } from '../util/sanitize.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/**
 * Live feedback while Kai works — the first turn warms the engine for
 * 10-25s and a silent prompt reads as a hang.
 */
class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private frame = 0;
  private label = '';
  private readonly enabled = Boolean(process.stdout.isTTY);

  start(label: string): void {
    this.label = label;
    if (!this.enabled) return;
    if (this.timer) return;
    this.startedAt = Date.now();
    process.stdout.write('\x1b[?25l');
    this.timer = setInterval(() => this.render(), 90);
    this.render();
  }

  setLabel(label: string): void {
    this.label = label;
    if (this.enabled && this.timer) this.render();
  }

  private render(): void {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const frame = FRAMES[this.frame++ % FRAMES.length];
    process.stdout.write(`\r\x1b[2K  ${frame} ${this.label} ${DIM}${seconds}s${RESET}`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stdout.write('\r\x1b[2K\x1b[?25h');
    }
  }
}

function prettyToolName(name: string): string {
  return name.replace(/^mcp__creatoros__/, '').replace(/_/g, ' ');
}

const BANNER = `
  ██╗  ██╗ █████╗ ██╗██████╗  ██████╗ ███████╗
  ██║ ██╔╝██╔══██╗██║██╔══██╗██╔═══██╗██╔════╝
  █████╔╝ ███████║██║██████╔╝██║   ██║███████╗
  ██╔═██╗ ██╔══██║██║██╔══██╗██║   ██║╚════██║
  ██║  ██╗██║  ██║██║██║  ██║╚██████╔╝███████║
  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
  the CreatorOS agent · type "exit" to leave
`;

export async function runRepl(
  client: CreatorOSClient,
  config: KairosConfig | null,
  workspaceRoot: string,
): Promise<void> {
  // Model auth, two ways: ANTHROPIC_API_KEY, or the user's Claude plan via
  // the logged-in claude CLI (the Agent SDK drives it under the hood).
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      '\x1b[2mNo ANTHROPIC_API_KEY set — running on your Claude plan via the claude CLI. ' +
        'If I fail to think, log in once with `claude` or export an API key.\x1b[0m',
    );
  }

  console.log(BANNER);
  console.log(
    `Key ${client.maskedKey} · pathway ${config?.automationTarget ?? 'local'} · tz ${config?.timezone ?? 'UTC'}\n`,
  );

  const server = buildToolServer(client, workspaceRoot, config);
  const systemPrompt = buildSystemPrompt(config);
  let sessionId: string | undefined;

  while (true) {
    let userInput: string;
    try {
      userInput = await input({ message: 'you ▸' });
    } catch {
      break; // ctrl-c / closed stdin
    }
    const trimmed = userInput.trim();
    if (!trimmed) continue;
    if (['exit', 'quit', 'q'].includes(trimmed.toLowerCase())) break;

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
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });

      spinner.start(sessionId ? 'kai is thinking…' : 'waking the engine — first reply takes ~15s…');

      for await (const message of turn) {
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          spinner.setLabel('kai is thinking…');
        } else if (message.type === 'assistant') {
          let printed = false;
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              spinner.stop();
              console.log(`\n${sanitize(block.text.trim())}\n`);
              printed = true;
            } else if (block.type === 'tool_use') {
              spinner.stop();
              console.log(`  ${DIM}· ${prettyToolName(block.name)}${RESET}`);
            }
          }
          spinner.start(printed ? 'kai is working…' : 'kai is thinking…');
        } else if (message.type === 'result') {
          spinner.stop();
          if (message.subtype !== 'success') {
            const detail = 'result' in message && message.result ? ` — ${sanitize(String(message.result))}` : '';
            console.error(`\n(kai hit a wall: ${message.subtype}${detail})\n`);
          }
        }
      }
    } catch (error) {
      console.error(`\n(kai error: ${sanitize((error as Error).message)})\n`);
    } finally {
      spinner.stop();
    }
  }
  console.log('\nKai out. Your scheduled posts publish from CreatorOS servers either way.');
}
