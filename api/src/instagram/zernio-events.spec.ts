import { isMessageEvent, typeForAttachment } from './zernio-events';

/** Trimmed from the real 2026-08-11 delivery. */
const REAL_MESSAGE_RECEIVED = {
  id: '2d507d40-beea-4a84-ac47-21d80834feff',
  event: 'message.received',
  message: {
    id: '6a7b2716d0fe733d1a2ea5b0',
    conversationId: '6a7a2546d0fe733d1af2cc11',
    platform: 'instagram',
    platformMessageId: 'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlE',
    direction: 'incoming',
    text: 'Hola',
    attachments: [],
    sender: { id: '2307893396386885', name: 'Timeless' },
    sentAt: '2026-08-11T13:43:49.113Z',
  },
  conversation: {
    id: '6a7a2546d0fe733d1af2cc11',
    platformConversationId: '2307893396386885',
    participantUsername: 'timelessprivateclub',
  },
  account: { id: '6a7a247ad0fe733d1af2a95e', username: 'marcepiano' },
};

describe('isMessageEvent', () => {
  it('accepts a real message.received', () => {
    expect(isMessageEvent(REAL_MESSAGE_RECEIVED)).toBe(true);
  });

  it('accepts message.sent, which fires for our own API sends', () => {
    expect(
      isMessageEvent({
        ...REAL_MESSAGE_RECEIVED,
        event: 'message.sent',
        message: { ...REAL_MESSAGE_RECEIVED.message, direction: 'outgoing' },
      }),
    ).toBe(true);
  });

  it('rejects webhook.test, which is an event type but not a message', () => {
    // Zernio's own test delivery is not in the subscription list, so anything
    // that assumed "delivered means message" would try to parse it.
    expect(
      isMessageEvent({
        id: '4cb2264a',
        event: 'webhook.test',
        message: 'This is a test webhook from Zernio',
        timestamp: '2026-08-11T13:40:39.010Z',
      }),
    ).toBe(false);
  });

  it('rejects the events we subscribe to but do not yet handle', () => {
    for (const event of [
      'account.connected',
      'account.disconnected',
      'message.read',
      'reaction.received',
      'conversation.started',
    ]) {
      expect(isMessageEvent({ ...REAL_MESSAGE_RECEIVED, event })).toBe(false);
    }
  });

  it('rejects a message with no platform conversation id', () => {
    // Without it there is no usable thread key: the internal id returns an
    // empty 200 from the REST API, so storing against it would strand the
    // thread permanently.
    const { platformConversationId, ...rest } =
      REAL_MESSAGE_RECEIVED.conversation;
    expect(platformConversationId).toBeTruthy();
    expect(
      isMessageEvent({ ...REAL_MESSAGE_RECEIVED, conversation: rest }),
    ).toBe(false);
  });

  it('rejects garbage without throwing', () => {
    expect(isMessageEvent(null)).toBe(false);
    expect(isMessageEvent(undefined)).toBe(false);
    expect(isMessageEvent('nope')).toBe(false);
    expect(isMessageEvent({})).toBe(false);
  });
});

describe('typeForAttachment', () => {
  it('maps Meta attachment types onto ours', () => {
    expect(typeForAttachment('image')).toBe('IMAGE');
    expect(typeForAttachment('video')).toBe('VIDEO');
    expect(typeForAttachment('audio')).toBe('AUDIO');
    expect(typeForAttachment('file')).toBe('DOCUMENT');
  });

  it('falls back rather than guessing', () => {
    expect(typeForAttachment('share')).toBe('UNKNOWN');
    expect(typeForAttachment(undefined)).toBe('UNKNOWN');
  });
});
