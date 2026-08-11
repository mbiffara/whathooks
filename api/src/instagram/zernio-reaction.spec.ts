import type { ZernioSignalEvent } from './zernio-events';

/**
 * Field paths for reaction.received, pinned to a real delivery.
 *
 * These were originally guessed from the shape of message.received and two of
 * them were wrong: the sender is nested (`reaction.sender.id`, not
 * `reaction.senderId`), and there is an `action` field that decides whether a
 * reaction is being added or taken away. Neither mistake would have thrown —
 * the first silently groups every reaction under one key, the second re-adds
 * the emoji someone just removed.
 */
const REAL_REACTION: ZernioSignalEvent = {
  id: '13160324-012b-4c55-ad69-00b725b501d9',
  event: 'reaction.received',
  reaction: {
    emoji: '❤',
    action: 'added',
    messageId: '6a7b7f95fa5b16567be22474',
    platformMessageId: 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlE',
    sender: { id: '2307893396386885', contactId: '6a7b24280a562323534d9df6' },
    reactedAt: '2026-08-11T20:25:41.104Z',
  },
  conversation: { participantUsername: 'timelessprivateclub' },
  account: {
    id: '6a7a247ad0fe733d1af2a95e',
    accountId: '6a7a247ad0fe733d1af2a95e',
  },
};

/** The extraction the ingest performs, isolated. */
function extract(e: ZernioSignalEvent) {
  const targetId =
    e.message?.platformMessageId ??
    e.reaction?.platformMessageId ??
    e.platformMessageId ??
    null;
  const removed = e.reaction?.action === 'removed';
  const emoji = removed ? '' : (e.reaction?.emoji ?? e.emoji ?? '');
  const key =
    e.reaction?.sender?.id ?? e.message?.sender?.id ?? 'instagram-participant';
  const by =
    e.conversation?.participantUsername ??
    e.message?.sender?.name ??
    'Instagram';
  return { targetId, emoji, key, by };
}

describe('reaction.received extraction', () => {
  it('reads every field off the real payload', () => {
    expect(extract(REAL_REACTION)).toEqual({
      targetId: 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlE',
      emoji: '❤',
      key: '2307893396386885',
      by: 'timelessprivateclub',
    });
  });

  it('treats a removal as a removal even though the emoji is still there', () => {
    const removal: ZernioSignalEvent = {
      ...REAL_REACTION,
      reaction: { ...REAL_REACTION.reaction, action: 'removed' },
    };
    // The emoji is present on a removal, so keying off it alone would re-add
    // the reaction the customer just took away.
    expect(removal.reaction?.emoji).toBe('❤');
    expect(extract(removal).emoji).toBe('');
  });

  it('keys on the reacting person, not the conversation', () => {
    // Grouping every reaction under one key would let one person's emoji
    // replace another's on the same message.
    expect(extract(REAL_REACTION).key).toBe(REAL_REACTION.reaction?.sender?.id);
    expect(extract(REAL_REACTION).key).not.toBe('instagram-participant');
  });

  it('degrades without throwing when the shape is unfamiliar', () => {
    expect(extract({ id: 'x', event: 'reaction.received' })).toEqual({
      targetId: null,
      emoji: '',
      key: 'instagram-participant',
      by: 'Instagram',
    });
  });
});
