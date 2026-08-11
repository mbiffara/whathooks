/**
 * Zernio webhook payloads, as observed rather than as documented.
 *
 * These are deliberately NOT shared with the REST client's types: the same
 * entities come back differently on the two surfaces. The webhook calls the
 * message body `text` where the REST list calls it `message`; the sender is
 * nested here and flat there; `profileId` is a string here and an object
 * there. One shared interface would be wrong on one side or the other.
 */

/** Envelope common to every delivery. `id` is the dedupe key. */
export interface ZernioEnvelope {
  id: string;
  event: string;
  timestamp?: string;
}

export interface ZernioMessageEvent extends ZernioEnvelope {
  message: {
    id: string;
    /**
     * Zernio's INTERNAL conversation id. Not usable against the REST API,
     * which returns an empty 200 for it — always key on
     * `conversation.platformConversationId` instead.
     */
    conversationId: string;
    platform: string;
    /** Instagram's own message id. Our dedupe key against outbound echoes. */
    platformMessageId: string;
    direction: 'incoming' | 'outgoing';
    text?: string | null;
    attachments?: Array<{
      type: string;
      url: string;
      refreshUrl?: string;
    }>;
    sender?: {
      id: string;
      name?: string | null;
      username?: string | null;
      instagramProfile?: {
        isFollower?: boolean;
        isFollowing?: boolean;
        followerCount?: number;
        isVerified?: boolean;
      } | null;
    };
    isStoryMention?: boolean;
    isDeleted?: boolean;
    sentAt?: string;
  };
  conversation: {
    id: string;
    /** The only id that works for reading and sending. Key threads on this. */
    platformConversationId: string;
    participantId?: string;
    participantName?: string | null;
    participantUsername?: string | null;
    participantPicture?: string | null;
  };
  account: {
    id: string;
    accountId?: string;
    username?: string;
    platform?: string;
  };
}

export interface ZernioAccountEvent extends ZernioEnvelope {
  account: { id: string; accountId?: string; username?: string };
}

/** Events that carry a message we store. */
export const MESSAGE_EVENTS = ['message.received', 'message.sent'] as const;

export function isMessageEvent(e: unknown): e is ZernioMessageEvent {
  const v = e as ZernioMessageEvent;
  return (
    !!v &&
    typeof v.id === 'string' &&
    MESSAGE_EVENTS.includes(v.event as (typeof MESSAGE_EVENTS)[number]) &&
    !!v.message?.platformMessageId &&
    !!v.conversation?.platformConversationId &&
    !!(v.account?.id || v.account?.accountId)
  );
}

/** Map an attachment's type to our MessageType vocabulary. */
export function typeForAttachment(type: string | undefined): string {
  switch ((type ?? '').toLowerCase()) {
    case 'image':
      return 'IMAGE';
    case 'video':
      return 'VIDEO';
    case 'audio':
      return 'AUDIO';
    case 'file':
      return 'DOCUMENT';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Delivery receipts and reactions, typed loosely on purpose.
 *
 * Zernio documents none of these payloads. Every field is optional and read
 * defensively so an unexpected shape degrades to "we could not find the
 * target" — logged — instead of throwing inside a webhook handler.
 */
export interface ZernioSignalEvent extends ZernioEnvelope {
  platformMessageId?: string;
  emoji?: string;
  message?: {
    platformMessageId?: string;
    reaction?: string;
    sender?: { id?: string; name?: string | null };
  };
  /** Confirmed shape, captured from a live delivery on 2026-08-11. */
  reaction?: {
    emoji?: string;
    /** "added" | "removed". A removal still carries the emoji. */
    action?: string;
    messageId?: string;
    platformMessageId?: string;
    sender?: { id?: string; contactId?: string };
    reactedAt?: string;
  };
  conversation?: { participantUsername?: string | null };
  account?: { id?: string; accountId?: string; username?: string };
}
