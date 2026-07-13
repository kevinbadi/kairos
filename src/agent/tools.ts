/**
 * Claude Agent SDK adapter: wraps the shared tool registry as an MCP
 * server. The registry itself is engine-agnostic — see registry.ts (and
 * apiLoop.ts for the OpenAI-compatible engine using the same tools).
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CreatorOSClient } from '../client/client.js';
import type { KairosConfig } from '../config/kairosConfig.js';
import { buildToolRegistry } from './registry.js';

export function buildToolServer(client: CreatorOSClient, workspaceRoot: string, config: KairosConfig | null) {
  const registry = buildToolRegistry(client, workspaceRoot, config);
  return createSdkMcpServer({
    name: 'creatoros',
    version: '1.0.0',
    tools: registry.map((kaiTool) =>
      tool(kaiTool.name, kaiTool.description, kaiTool.shape, async (args) => {
        const result = await kaiTool.handler(args as Record<string, unknown>);
        return {
          content: [{ type: 'text' as const, text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        };
      }),
    ),
  });
}
