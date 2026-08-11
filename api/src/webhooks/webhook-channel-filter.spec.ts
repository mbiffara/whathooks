import { Channel } from '@prisma/client';

/**
 * The `where` clause that decides which subscribers see an event.
 *
 * Extracted and asserted directly because the obvious spelling of this is
 * wrong in a way nothing would catch at runtime: two `OR` properties in one
 * object literal means the second silently replaces the first, dropping the
 * session scoping and delivering every org event to every webhook. It has to
 * be an AND of two ORs.
 */
function subscriberWhere(params: {
  organizationId: string;
  sessionId?: string | null;
  channel?: Channel | null;
}) {
  return {
    organizationId: params.organizationId,
    active: true,
    AND: [
      {
        OR: [{ sessionId: null }, { sessionId: params.sessionId ?? undefined }],
      },
      ...(params.channel
        ? [{ OR: [{ channel: null }, { channel: params.channel }] }]
        : []),
    ],
  };
}

describe('webhook subscriber filter', () => {
  it('keeps session scoping when a channel is given', () => {
    const w = subscriberWhere({
      organizationId: 'org1',
      sessionId: 's1',
      channel: Channel.INSTAGRAM,
    });
    // Both constraints must survive: this is the regression the AND exists for.
    expect(w.AND).toHaveLength(2);
    expect(w.AND[0]).toEqual({
      OR: [{ sessionId: null }, { sessionId: 's1' }],
    });
    expect(w.AND[1]).toEqual({
      OR: [{ channel: null }, { channel: 'INSTAGRAM' }],
    });
  });

  it('omits the channel constraint when the event is not channel-specific', () => {
    const w = subscriberWhere({ organizationId: 'org1', sessionId: 's1' });
    expect(w.AND).toHaveLength(1);
    expect(w.AND[0]).toEqual({
      OR: [{ sessionId: null }, { sessionId: 's1' }],
    });
  });

  it('still scopes by session with no channel', () => {
    const w = subscriberWhere({ organizationId: 'org1', sessionId: null });
    expect(w.AND[0]).toEqual({
      OR: [{ sessionId: null }, { sessionId: undefined }],
    });
  });

  it('matches channel-agnostic subscribers as well as pinned ones', () => {
    // `{ channel: null }` in the OR is what lets a webhook created without a
    // channel receive Instagram events; migrated rows are pinned to WHATSAPP
    // and therefore excluded.
    const w = subscriberWhere({
      organizationId: 'org1',
      channel: Channel.INSTAGRAM,
    });
    const clause = w.AND[1] as { OR: Array<{ channel: Channel | null }> };
    expect(clause.OR.map((c) => c.channel)).toEqual([null, 'INSTAGRAM']);
    expect(clause.OR.map((c) => c.channel)).not.toContain('WHATSAPP');
  });
});
