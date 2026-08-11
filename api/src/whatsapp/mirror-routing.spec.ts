import { Channel } from '@prisma/client';

/**
 * Which session and address a mirror reply goes to.
 *
 * The rule that matters: a MirrorThread's `sessionId` is where the GROUP
 * lives, not where the lead lives. Relaying on it was correct only while both
 * were the same session. With an Instagram lead mirrored into a WhatsApp
 * group, using it sends the agent's reply to a WhatsApp number that does not
 * exist — and it would look like it worked, because the send succeeds.
 */
function relayTarget(
  thread: {
    sessionId: string;
    leadJid: string;
    conversationId?: string | null;
  },
  lead: {
    sessionId: string;
    remoteJid: string;
    session: { channel: Channel };
  } | null,
) {
  return {
    sessionId: lead?.sessionId ?? thread.sessionId,
    address: lead?.remoteJid ?? thread.leadJid,
    channel: lead?.session?.channel ?? Channel.WHATSAPP,
  };
}

describe('mirror reply routing', () => {
  it('sends an Instagram lead the reply on Instagram, not the group session', () => {
    const target = relayTarget(
      { sessionId: 'wa-session', leadJid: 'ig:123', conversationId: 'c1' },
      {
        sessionId: 'ig-session',
        remoteJid: 'ig:123',
        session: { channel: Channel.INSTAGRAM },
      },
    );
    expect(target).toEqual({
      sessionId: 'ig-session',
      address: 'ig:123',
      channel: Channel.INSTAGRAM,
    });
    // The group's session must not be the send target.
    expect(target.sessionId).not.toBe('wa-session');
  });

  it('is unchanged for a WhatsApp lead, where both sessions are the same', () => {
    expect(
      relayTarget(
        {
          sessionId: 'wa-session',
          leadJid: '5491122334455@s.whatsapp.net',
          conversationId: 'c1',
        },
        {
          sessionId: 'wa-session',
          remoteJid: '5491122334455@s.whatsapp.net',
          session: { channel: Channel.WHATSAPP },
        },
      ),
    ).toEqual({
      sessionId: 'wa-session',
      address: '5491122334455@s.whatsapp.net',
      channel: Channel.WHATSAPP,
    });
  });

  it('falls back to the legacy fields when no conversation is linked', () => {
    // Rows created before the backfill, and any the backfill could not match,
    // must keep working exactly as they did rather than failing to relay.
    expect(
      relayTarget(
        {
          sessionId: 'wa-session',
          leadJid: '5491122334455@s.whatsapp.net',
          conversationId: null,
        },
        null,
      ),
    ).toEqual({
      sessionId: 'wa-session',
      address: '5491122334455@s.whatsapp.net',
      channel: Channel.WHATSAPP,
    });
  });
});
