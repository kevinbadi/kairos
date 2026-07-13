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
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'Kairos needs ANTHROPIC_API_KEY set to think. Export it and re-run: export ANTHROPIC_API_KEY=...',
    );
    process.exitCode = 1;
    return;
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

      for await (const message of turn) {
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
        } else if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text.trim()) {
              console.log(`\n${sanitize(block.text.trim())}\n`);
            }
          }
        } else if (message.type === 'result' && message.subtype !== 'success') {
          console.error(`\n(kai hit a wall: ${message.subtype})\n`);
        }
      }
    } catch (error) {
      console.error(`\n(kai error: ${sanitize((error as Error).message)})\n`);
    }
  }
  console.log('\nKai out. Your scheduled posts publish from CreatorOS servers either way.');
}
