/**
 * Kairos's tool belt — every CreatorOS capability, wrapped as MCP tools for
 * the agent loop. The allowlist and platform matrix are enforced inside
 * CreatorOSClient, so a blocked call comes back as a plain refusal message
 * regardless of what the agent asks for.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { CreatorOSClient } from '../client/client.js';
import type { CreatePostBody } from '../client/types.js';
import {
  createAutomation,
  STARTER_CRONS,
  verifyAutomations,
  RAILWAY_SPEND_LIMIT_WARNING,
  type StarterCron,
} from '../automations/crons.js';
import { buildFunnelAutomation } from '../automations/funnels.js';
import type { KairosConfig } from '../config/kairosConfig.js';

function ok(data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    ],
  };
}

function fail(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
    isError: true,
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

const platformTarget = z.object({
  platform: z.string().describe('Platform, e.g. tiktok, instagram, youtube, twitter, threads'),
  accountId: z.string().describe('Account ID from kairos/PROFILES.md'),
  customContent: z.string().optional(),
  scheduledFor: z.string().optional().describe('Per-platform override, absolute ISO 8601'),
  platformSpecificData: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Per-platform options: threadItems (X/Threads/Bluesky), YouTube title/visibility, TikTok privacyLevel + consent flags, IG contentType, FB carouselCards, Reddit subreddit/title…',
    ),
});

const mediaItem = z.object({
  type: z.enum(['image', 'video', 'gif', 'document']),
  url: z.string().describe('Public HTTPS URL — use upload_media for local files'),
  thumbnail: z.string().optional(),
  title: z.string().optional(),
});

export function buildToolServer(client: CreatorOSClient, workspaceRoot: string, config: KairosConfig | null) {
  return createSdkMcpServer({
    name: 'creatoros',
    version: '1.0.0',
    tools: [
      // ---- Accounts & profiles ----
      tool('list_accounts', 'List connected social accounts (platform, handle, id, followers).', {}, () =>
        run(() => client.listAccounts()),
      ),
      tool(
        'account_health',
        'Health of all connected accounts, or one account when accountId is given.',
        { accountId: z.string().optional() },
        ({ accountId }) => run(() => (accountId ? client.accountHealth(accountId) : client.accountsHealth())),
      ),
      tool('list_profiles', 'List CreatorOS profiles (read-only).', {}, () => run(() => client.listProfiles())),
      tool(
        'tiktok_creator_info',
        'TikTok posting constraints for an account: privacy levels, limits, commercial content options. Required before TikTok posts.',
        { accountId: z.string(), mediaType: z.enum(['video', 'photo']).optional() },
        ({ accountId, mediaType }) => run(() => client.tiktokCreatorInfo(accountId, mediaType ?? 'video')),
      ),

      // ---- Media ----
      tool(
        'upload_media',
        'Upload a local media file to CreatorOS storage. Returns a MediaItem ({type, url}) to pass to create_post. Upload once, reuse across platforms.',
        { filePath: z.string().describe('Absolute or workspace-relative path') },
        ({ filePath }) => run(() => client.uploadMediaFromFile(filePath)),
      ),

      // ---- Posting ----
      tool(
        'create_post',
        'Create a post across one or many accounts (multiposting = several platform entries in one call). Supports shortform/longform video, carousels, text posts, native threads (threadItems), scheduling (scheduledFor + timezone; CreatorOS servers publish), drafts, and publishNow. Verify with get_post afterwards.',
        {
          content: z.string().optional().describe('Caption / body text'),
          title: z.string().optional().describe('YouTube title (≤100 chars)'),
          platforms: z.array(platformTarget).min(1),
          mediaItems: z.array(mediaItem).optional(),
          scheduledFor: z.string().optional().describe('ISO 8601; naive = wall-clock in timezone'),
          timezone: z.string().optional().describe('IANA name; defaults to the configured timezone'),
          publishNow: z.boolean().optional(),
          isDraft: z.boolean().optional(),
          tags: z.array(z.string()).optional().describe('YouTube tags'),
          hashtags: z.array(z.string()).optional(),
        },
        (args) =>
          run(() => {
            const body: CreatePostBody = {
              ...args,
              timezone: args.timezone ?? config?.timezone ?? 'UTC',
            } as CreatePostBody;
            return client.createPost(body);
          }),
      ),
      tool('get_post', 'Fetch a post by ID — per-platform status, URLs, errors. Use to verify every publish.', { postId: z.string() }, ({ postId }) =>
        run(() => client.getPost(postId)),
      ),
      tool(
        'list_posts',
        'List posts with filters.',
        {
          status: z.enum(['draft', 'scheduled', 'published', 'failed']).optional(),
          platform: z.string().optional(),
          limit: z.number().optional(),
          page: z.number().optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        },
        (query) => run(() => client.listPosts(query)),
      ),
      tool('retry_post', 'Retry the failed platforms of a failed/partial post.', { postId: z.string() }, ({ postId }) =>
        run(() => client.retryPost(postId)),
      ),
      tool(
        'delete_post',
        'Delete a draft or scheduled post. DESTRUCTIVE — confirm with the human first.',
        { postId: z.string() },
        ({ postId }) => run(() => client.deletePost(postId)),
      ),
      tool(
        'update_youtube_metadata',
        'Update title/description/tags/visibility of a published YouTube video.',
        {
          postId: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          tags: z.array(z.string()).optional(),
          privacyStatus: z.enum(['public', 'private', 'unlisted']).optional(),
        },
        ({ postId, ...body }) => run(() => client.updateYouTubeMetadata(postId, body)),
      ),

      // ---- Validation ----
      tool(
        'validate_post',
        'Dry-run full pre-publish validation (lengths, media rules, platform requirements) without creating anything.',
        { body: z.record(z.string(), z.unknown()).describe('Same shape as create_post') },
        ({ body }) => run(() => client.validatePost(body as CreatePostBody)),
      ),
      tool('validate_post_length', 'Weighted character counts vs every platform limit.', { text: z.string() }, ({ text }) =>
        run(() => client.validatePostLength(text)),
      ),
      tool('validate_media', 'Check a media URL against per-platform size/format limits.', { url: z.string() }, ({ url }) =>
        run(() => client.validateMedia(url)),
      ),

      // ---- Analytics ----
      tool(
        'get_analytics',
        'Post analytics. With postId: one post (per-platform breakdown). Without: paginated overview.',
        {
          postId: z.string().optional(),
          platform: z.string().optional(),
          accountId: z.string().optional(),
          fromDate: z.string().optional().describe('YYYY-MM-DD'),
          toDate: z.string().optional(),
          sortBy: z.string().optional(),
          limit: z.number().optional(),
        },
        (query) => run(() => client.getAnalytics(query)),
      ),
      tool(
        'follower_stats',
        'Follower growth per account over a date range.',
        {
          accountIds: z.string().optional().describe('Comma-separated'),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
          granularity: z.enum(['daily', 'weekly', 'monthly']).optional(),
        },
        (query) => run(() => client.followerStats(query)),
      ),
      tool(
        'best_time_to_post',
        'Best-performing day/hour slots (hours are UTC; day 0=Monday).',
        { platform: z.string().optional(), accountId: z.string().optional() },
        (query) => run(() => client.bestTimeToPost(query)),
      ),
      tool(
        'daily_metrics',
        'Daily aggregated metrics + per-platform breakdown.',
        { fromDate: z.string().optional(), toDate: z.string().optional(), platform: z.string().optional() },
        (query) => run(() => client.dailyMetrics(query)),
      ),

      // ---- Comments ----
      tool(
        'list_comments',
        'Posts with recent comment activity across accounts.',
        {
          since: z.string().optional().describe('ISO 8601'),
          platform: z.string().optional(),
          accountId: z.string().optional(),
          limit: z.number().optional(),
          cursor: z.string().optional(),
        },
        (query) => run(() => client.listComments(query)),
      ),
      tool(
        'get_post_comments',
        'Comments on one post.',
        { postId: z.string(), accountId: z.string(), limit: z.number().optional(), cursor: z.string().optional() },
        ({ postId, ...query }) => run(() => client.getPostComments(postId, query)),
      ),
      tool(
        'reply_to_comment',
        'Reply to a comment (or the post itself when commentId omitted). Platform matrix enforced — TikTok is not supported.',
        {
          platform: z.string(),
          postId: z.string(),
          accountId: z.string(),
          message: z.string(),
          commentId: z.string().optional(),
        },
        (args) => run(() => client.replyToComment(args)),
      ),
      tool(
        'like_comment',
        'Like a comment (positive but content-free comments get a like, not a reply).',
        { postId: z.string(), commentId: z.string(), accountId: z.string() },
        ({ postId, commentId, accountId }) => run(() => client.likeComment(postId, commentId, accountId)),
      ),
      tool(
        'private_reply_to_comment',
        'Send a DM to a commenter (Instagram/Facebook only, one per comment, 7-day window). Confirm copy with the human first.',
        {
          platform: z.string(),
          postId: z.string(),
          commentId: z.string(),
          accountId: z.string(),
          message: z.string(),
        },
        (args) => run(() => client.privateReplyToComment(args)),
      ),

      // ---- Messages / DMs ----
      tool(
        'list_conversations',
        'List DM conversations across accounts.',
        {
          platform: z.string().optional(),
          accountId: z.string().optional(),
          limit: z.number().optional(),
          cursor: z.string().optional(),
        },
        (query) => run(() => client.listConversations(query)),
      ),
      tool(
        'get_conversation_messages',
        'Messages in one conversation.',
        { conversationId: z.string(), accountId: z.string(), limit: z.number().optional() },
        ({ conversationId, ...query }) => run(() => client.getConversationMessages(conversationId, query)),
      ),
      tool(
        'send_message',
        'Reply in an existing DM conversation. Platform matrix enforced. Escalate refunds/complaints/legal to the human instead.',
        {
          platform: z.string(),
          conversationId: z.string(),
          accountId: z.string(),
          message: z.string(),
        },
        (args) => run(() => client.sendMessage(args)),
      ),

      // ---- Comment-to-DM funnels ----
      tool(
        'create_funnel',
        'Create a comments-to-DM funnel (keyword comment → automatic DM with link). Instagram/Facebook only. ALWAYS confirm the exact keyword(s) and DM copy with the human before calling this.',
        {
          platform: z.string(),
          profileId: z.string(),
          accountId: z.string(),
          name: z.string(),
          keywords: z.array(z.string()),
          dmMessage: z.string(),
          link: z.string().optional().describe('Product link from BRAND.md — attached as tracked button'),
          commentReply: z.string().optional(),
          platformPostId: z.string().optional().describe('Scope to one post; omit for account-wide'),
          postId: z.string().optional(),
          trigger: z.enum(['comment', 'story_reply']).optional(),
        },
        (spec) => run(() => client.createCommentAutomation(spec.platform, buildFunnelAutomation(spec))),
      ),
      tool('list_funnels', 'List comment-to-DM funnels with stats (triggers, DMs sent, clicks).', {}, () =>
        run(() => client.listCommentAutomations()),
      ),
      tool(
        'update_funnel',
        'Update or pause a funnel (isActive=false pauses). Confirm copy changes with the human.',
        {
          automationId: z.string(),
          keywords: z.array(z.string()).optional(),
          dmMessage: z.string().optional(),
          isActive: z.boolean().optional(),
        },
        ({ automationId, ...body }) => run(() => client.updateCommentAutomation(automationId, body)),
      ),
      tool(
        'delete_funnel',
        'Delete a funnel permanently (logs included). DESTRUCTIVE — confirm with the human first.',
        { automationId: z.string() },
        ({ automationId }) => run(() => client.deleteCommentAutomation(automationId)),
      ),
      tool('funnel_logs', 'Trigger logs for a funnel.', { automationId: z.string() }, ({ automationId }) =>
        run(() => client.commentAutomationLogs(automationId)),
      ),

      // ---- Webhooks ----
      tool('list_webhooks', 'List webhook subscriptions.', {}, () => run(() => client.listWebhooks())),
      tool(
        'create_webhook',
        'Subscribe a URL to CreatorOS events (comment.received, message.received, post.published…). Max 10.',
        {
          name: z.string(),
          url: z.string(),
          events: z.array(z.string()),
          secret: z.string().optional().describe('HMAC secret for signature verification'),
        },
        (body) => run(() => client.createWebhook(body)),
      ),
      tool('delete_webhook', 'Remove a webhook subscription. Confirm with the human first.', { webhookId: z.string() }, ({ webhookId }) =>
        run(() => client.deleteWebhook(webhookId)),
      ),
      tool('test_webhook', 'Send a test event to a webhook.', { webhookId: z.string() }, ({ webhookId }) =>
        run(() => client.testWebhook(webhookId)),
      ),

      // ---- Scheduled agent automations (crons) ----
      tool(
        'create_cron_automation',
        `Create a scheduled agent run (cron) on the configured pathway (${config?.automationTarget ?? 'local'}). Starter crons: ${STARTER_CRONS.map((c) => c.name).join(', ')}. Railway: remind the user about the Anthropic spend limit — ${RAILWAY_SPEND_LIMIT_WARNING}`,
        {
          name: z.string().describe('lowercase-with-hyphens'),
          schedule: z.string().describe('Strict 5-field cron, e.g. "0 9 * * *"'),
          skill: z.string().describe('A skill in kairos/skills/, e.g. respond-to-comments'),
        },
        ({ name, schedule, skill }) =>
          run(async () => {
            const cron: StarterCron = { name, schedule, skill, pillar: 'content', description: '' };
            const result = await createAutomation(workspaceRoot, cron, config?.automationTarget ?? 'local');
            if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || 'automation create failed');
            return result.stdout.trim() || `Automation ${name} created.`;
          }),
      ),
      tool('list_cron_automations', 'List scheduled agent automations and verify they are loaded.', {}, () =>
        run(async () => {
          const result = await verifyAutomations(workspaceRoot);
          return result.stdout.trim() || result.stderr.trim() || '(none)';
        }),
      ),
    ],
  });
}
