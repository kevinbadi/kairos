/**
 * Types generated against the live CreatorOS API docs (OpenAPI 3.1).
 * Field names are verbatim from the spec — notably `scheduledFor` (there is
 * no `scheduledAt` in the API) and `mediaItems` (there is no `mediaUrls`).
 */
import type { Platform } from './platformMatrix.js';

export interface MediaItem {
  type: 'image' | 'video' | 'gif' | 'document';
  url: string;
  title?: string;
  altText?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  /** Video cover image. */
  thumbnail?: string;
  /** Instagram Reel cover. */
  instagramThumbnail?: string;
}

export interface ThreadItem {
  content: string;
  mediaItems?: MediaItem[];
}

/**
 * Per-platform options. Native thread support: `threadItems` on Twitter/X,
 * Threads, and Bluesky — first item is the root; when set, top-level post
 * `content` is NOT published.
 */
export interface PlatformSpecificData {
  // Twitter/X, Threads, Bluesky
  threadItems?: ThreadItem[];
  // Twitter/X
  replyToTweetId?: string;
  quoteTweetId?: string;
  replySettings?: 'following' | 'mentionedUsers' | 'subscribers' | 'verified';
  poll?: { options: string[]; duration_minutes: number };
  // YouTube
  title?: string;
  visibility?: 'public' | 'private' | 'unlisted';
  madeForKids?: boolean;
  firstComment?: string;
  containsSyntheticMedia?: boolean;
  categoryId?: string;
  playlistId?: string;
  // Instagram
  contentType?: string;
  shareToFeed?: boolean;
  collaborators?: string[];
  userTags?: Array<{ username: string; x?: number; y?: number; mediaIndex?: number }>;
  audioName?: string;
  thumbOffset?: number;
  // Facebook
  draft?: boolean;
  pageId?: string;
  carouselCards?: Array<{ link: string; name?: string; description?: string }>;
  carouselLink?: string;
  // TikTok (camelCase and snake_case both accepted by the API)
  privacyLevel?: string;
  privacy_level?: string;
  allowComment?: boolean;
  allow_comment?: boolean;
  allowDuet?: boolean;
  allow_duet?: boolean;
  allowStitch?: boolean;
  allow_stitch?: boolean;
  contentPreviewConfirmed?: boolean;
  content_preview_confirmed?: boolean;
  expressConsentGiven?: boolean;
  express_consent_given?: boolean;
  commercialContentType?: 'none' | 'brand_organic' | 'brand_content';
  videoCoverTimestampMs?: number;
  videoCoverImageUrl?: string;
  photoCoverIndex?: number;
  autoAddMusic?: boolean;
  description?: string;
  // Reddit
  subreddit?: string;
  url?: string;
  flairId?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  // Pinterest
  boardId?: string;
  link?: string;
  // Telegram
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  // Discord
  channelId?: string;
  [key: string]: unknown;
}

export interface PostPlatformTarget {
  platform: Platform;
  /** 24-char hex account id — every post targets account IDs. */
  accountId: string;
  customContent?: string;
  customMedia?: MediaItem[];
  /** Per-platform scheduled time override (absolute ISO 8601). */
  scheduledFor?: string;
  platformSpecificData?: PlatformSpecificData;
}

export interface CreatePostBody {
  title?: string;
  content?: string;
  mediaItems?: MediaItem[];
  platforms?: PostPlatformTarget[];
  /** ISO 8601. Naive timestamps are wall-clock in `timezone` (default UTC!). */
  scheduledFor?: string;
  publishNow?: boolean;
  isDraft?: boolean;
  /** IANA timezone name, e.g. America/New_York. Defaults to UTC. */
  timezone?: string;
  /**
   * Queue scheduling: profile id — without scheduledFor, the post is
   * auto-assigned to the profile's next available queue slot. Never fetch
   * /v1/queue/next-slot and paste it into scheduledFor (bypasses queue
   * locking); pass this field and let the server assign.
   */
  queuedFromProfile?: string;
  /** A specific queue under queuedFromProfile (optional). */
  queueId?: string;
  tags?: string[];
  hashtags?: string[];
  metadata?: Record<string, unknown>;
  tiktokSettings?: PlatformSpecificData;
  facebookSettings?: PlatformSpecificData;
  [key: string]: unknown;
}

export type PostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'partial'
  | 'cancelled';

export interface Post {
  _id: string;
  status: PostStatus;
  content?: string;
  title?: string;
  scheduledFor?: string;
  publishedAt?: string;
  platforms?: Array<{
    platform: Platform;
    accountId: string;
    status: string;
    platformPostId?: string;
    platformPostUrl?: string;
    errorMessage?: string;
    errorCategory?: string;
  }>;
  [key: string]: unknown;
}

export interface SocialAccount {
  _id: string;
  platform: Platform;
  profileId: string | { _id: string; name?: string };
  username?: string;
  displayName?: string;
  profileUrl?: string;
  isActive: boolean;
  followersCount?: number;
  [key: string]: unknown;
}

export interface Profile {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  isDefault?: boolean;
  [key: string]: unknown;
}

export interface PresignResponse {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export interface DmButton {
  type: 'url' | 'postback' | 'phone';
  /** Max 20 chars. */
  title: string;
  url?: string;
  payload?: string;
  /** Facebook only. */
  phone?: string;
}

export interface CommentAutomationBody {
  profileId: string;
  accountId: string;
  name: string;
  /** DM text — max 640 chars when buttons are set. */
  dmMessage: string;
  trigger?: 'comment' | 'story_reply';
  /** Omit for account-wide (any post) automation. */
  platformPostId?: string;
  /** CreatorOS post id, only alongside platformPostId. */
  postId?: string;
  postTitle?: string;
  /** Empty = any comment triggers. */
  keywords?: string[];
  matchMode?: 'exact' | 'contains';
  buttons?: DmButton[];
  /** Optional public reply to the triggering comment. */
  commentReply?: string;
  linkTracking?: boolean;
  clickTag?: string;
}

export interface WebhookConfig {
  _id?: string;
  name: string;
  url: string;
  secret?: string;
  events: string[];
  isActive?: boolean;
  customHeaders?: Record<string, string>;
  failureCount?: number;
  lastFiredAt?: string;
}

export interface ApiErrorBody {
  error: string;
  type?: string;
  code?: string;
  param?: string;
  platform?: string;
  platformError?: unknown;
}
