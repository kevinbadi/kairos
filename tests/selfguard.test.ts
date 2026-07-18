import { describe, expect, it, vi } from 'vitest';
import { CreatorOSClient } from '../src/client/client.js';
import {
  annotateOwnComments,
  annotateOwnMessages,
  isOwnMessage,
  OWN_COMMENT_MARKER,
  OWN_MESSAGE_MARKER,
  SelfReplyBlockedError,
} from '../src/client/selfGuard.js';

const KEY = 'sk_' + 'ab'.repeat(32);

function clientWith(responses: unknown[]): { client: CreatorOSClient; impl: ReturnType<typeof vi.fn> } {
  const impl = vi.fn();
  for (const body of responses) {
    impl.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
  }
  return { client: new CreatorOSClient({ apiKey: KEY, fetchImpl: impl as unknown as typeof fetch }), impl };
}

const COMMENTS_PAYLOAD = {
  comments: [
    { id: 'own1', isOwner: true, username: 'brand', message: 'thanks for watching!' },
    {
      id: 'fan1',
      username: 'superfan',
      message: 'love this',
      replies: [{ id: 'own2', isOwner: true, username: 'brand', message: 'appreciate you!' }],
    },
  ],
};

describe('comment self-reply loop breaker', () => {
  it('annotates own comments (top-level and nested) and collects their ids', () => {
    const payload = structuredClone(COMMENTS_PAYLOAD);
    const ownIds = annotateOwnComments(payload);
    expect([...ownIds].sort()).toEqual(['own1', 'own2']);
    expect(payload.comments[0]!.message).toContain(OWN_COMMENT_MARKER);
    expect(payload.comments[1]!.replies![0]!.message).toContain(OWN_COMMENT_MARKER);
    expect(payload.comments[1]!.message).not.toContain(OWN_COMMENT_MARKER);
  });

  it('blocks replying to an own comment seen in a fetch — the cron loop scenario', async () => {
    const { client, impl } = clientWith([COMMENTS_PAYLOAD]);
    await client.getPostComments('p1', { accountId: 'a1' });
    await expect(
      client.replyToComment({ platform: 'instagram', postId: 'p1', accountId: 'a1', message: 'hi', commentId: 'own1' }),
    ).rejects.toThrow(SelfReplyBlockedError);
    await expect(
      client.replyToComment({ platform: 'instagram', postId: 'p1', accountId: 'a1', message: 'hi', commentId: 'own2' }),
    ).rejects.toThrow(/your own comment/i);
    expect(impl).toHaveBeenCalledTimes(1); // only the fetch — no reply reached the network
  });

  it('still allows replying to a real fan comment after the same fetch', async () => {
    const { client, impl } = clientWith([COMMENTS_PAYLOAD, { reply: { id: 'r1' } }]);
    await client.getPostComments('p1', { accountId: 'a1' });
    await client.replyToComment({ platform: 'instagram', postId: 'p1', accountId: 'a1', message: 'thanks!', commentId: 'fan1' });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it('blocks private replies to own comments too', async () => {
    const { client } = clientWith([COMMENTS_PAYLOAD]);
    await client.getPostComments('p1', { accountId: 'a1' });
    await expect(
      client.privateReplyToComment({ platform: 'instagram', postId: 'p1', commentId: 'own1', accountId: 'a1', message: 'psst' }),
    ).rejects.toThrow(SelfReplyBlockedError);
  });

  it('learns own ids from list_comments payloads as well', async () => {
    const { client } = clientWith([
      { posts: [{ postId: 'p1', comments: [{ id: 'own9', isOwner: true, message: 'my reply' }] }] },
    ]);
    await client.listComments();
    await expect(
      client.replyToComment({ platform: 'facebook', postId: 'p1', accountId: 'a1', message: 'hi', commentId: 'own9' }),
    ).rejects.toThrow(SelfReplyBlockedError);
  });
});

describe('message auto-response loop breaker', () => {
  const conversation = (latest: 'own' | 'theirs') => ({
    messages: [
      { id: 'm1', text: 'hey, is the guide still available?', createdAt: '2026-07-18T10:00:00Z' },
      {
        id: 'm2',
        text: 'Yes! Here you go.',
        isSelf: true,
        createdAt: latest === 'own' ? '2026-07-18T11:00:00Z' : '2026-07-18T09:00:00Z',
      },
    ],
  });

  it('recognizes the self flags the platforms actually use', () => {
    for (const message of [
      { isSelf: true },
      { isOwner: true },
      { fromMe: true },
      { isFromMe: true },
      { isEcho: true },
      { is_echo: true },
      { direction: 'outbound' },
      { direction: 'SENT' },
      { from: { isSelf: true } },
    ]) {
      expect(isOwnMessage(message)).toBe(true);
    }
    expect(isOwnMessage({ direction: 'inbound' })).toBe(false);
    expect(isOwnMessage({ text: 'hi' })).toBe(false);
  });

  it('annotates own messages and reports whether the newest is own', () => {
    const own = conversation('own');
    expect(annotateOwnMessages(own)).toBe(true);
    expect(own.messages[1]!.text).toContain(OWN_MESSAGE_MARKER);
    expect(own.messages[0]!.text).not.toContain(OWN_MESSAGE_MARKER);
    expect(annotateOwnMessages(conversation('theirs'))).toBe(false);
  });

  it('returns null (unknown) without usable timestamps — unknown never blocks', () => {
    expect(annotateOwnMessages({ messages: [{ text: 'a' }, { text: 'b', isSelf: true }] })).toBe(null);
  });

  it('blocks replying to a conversation whose latest message is your own — the cron loop scenario', async () => {
    const { client, impl } = clientWith([conversation('own')]);
    await client.getConversationMessages('c1', { accountId: 'a1' });
    await expect(
      client.sendMessage({ platform: 'instagram', conversationId: 'c1', accountId: 'a1', message: 'hello again' }),
    ).rejects.toThrow(SelfReplyBlockedError);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('allows the reply when the latest message is theirs, then blocks an immediate double-send', async () => {
    const { client, impl } = clientWith([conversation('theirs'), { message: { id: 'm3' } }]);
    await client.getConversationMessages('c1', { accountId: 'a1' });
    await client.sendMessage({ platform: 'instagram', conversationId: 'c1', accountId: 'a1', message: 'yes!' });
    expect(impl).toHaveBeenCalledTimes(2);
    // The send itself marks the conversation as ours — no double-texting in the same run.
    await expect(
      client.sendMessage({ platform: 'instagram', conversationId: 'c1', accountId: 'a1', message: 'also…' }),
    ).rejects.toThrow(/answer yourself/i);
  });

  it('allowFollowUp is the explicit human-approved escape hatch', async () => {
    const { client, impl } = clientWith([conversation('own'), { message: { id: 'm3' } }]);
    await client.getConversationMessages('c1', { accountId: 'a1' });
    await client.sendMessage({
      platform: 'instagram',
      conversationId: 'c1',
      accountId: 'a1',
      message: 'following up as you asked',
      allowFollowUp: true,
    });
    expect(impl).toHaveBeenCalledTimes(2);
  });
});
