import { INSTAGRAM_SEAT, PLANS } from './plans';

/**
 * The allowance each Instagram seat adds, isolated from the database.
 *
 * Two ways to get this wrong and neither throws: adding to a `null` cap turns
 * unlimited into limited, and applying it after the admin override would let a
 * seat quietly raise a ceiling support set deliberately.
 */
function withSeats(
  limits: { messagesPerMonth: number | null; includedAiTokens: number | null },
  seats: number,
  messageLimitOverride: number | null = null,
) {
  const out = { ...limits };
  if (seats > 0) {
    if (out.messagesPerMonth != null) {
      out.messagesPerMonth += seats * INSTAGRAM_SEAT.messagesPerMonth;
    }
    if (out.includedAiTokens != null) {
      out.includedAiTokens += seats * INSTAGRAM_SEAT.includedAiTokens;
    }
  }
  if (messageLimitOverride != null) {
    out.messagesPerMonth = messageLimitOverride;
  }
  return out;
}

describe('Instagram seat allowance', () => {
  it('adds 5k messages and 1M tokens per seat', () => {
    expect(withSeats(PLANS.STARTER, 1)).toMatchObject({
      messagesPerMonth: 10_000, // 5,000 plan + 5,000 seat
      includedAiTokens: 2_000_000, // 1M plan + 1M seat
    });
    expect(withSeats(PLANS.PRO, 3)).toMatchObject({
      messagesPerMonth: 35_000, // 20,000 + 3x5,000
      includedAiTokens: 8_000_000, // 5M + 3x1M
    });
  });

  it('changes nothing without seats', () => {
    expect(withSeats(PLANS.STARTER, 0)).toMatchObject({
      messagesPerMonth: PLANS.STARTER.messagesPerMonth,
      includedAiTokens: PLANS.STARTER.includedAiTokens,
    });
  });

  it('never turns an unlimited plan into a limited one', () => {
    // SPONSORED is null across the board; adding a number would cap a comped
    // org at exactly the seat allowance, which is far worse than no change.
    const out = withSeats(PLANS.SPONSORED, 4);
    expect(out.messagesPerMonth).toBeNull();
    expect(out.includedAiTokens).toBeNull();
  });

  it('leaves the admin override as the final word on messages', () => {
    // Support sets an override deliberately; a seat must not raise it.
    const out = withSeats(PLANS.STARTER, 2, 1_000);
    expect(out.messagesPerMonth).toBe(1_000);
    // Tokens have no override, so the seat allowance still applies there.
    expect(out.includedAiTokens).toBe(3_000_000);
  });

  it('scales linearly, so the tenth seat is worth the first', () => {
    const one = withSeats(PLANS.BUSINESS, 1).messagesPerMonth!;
    const ten = withSeats(PLANS.BUSINESS, 10).messagesPerMonth!;
    expect(ten - one).toBe(9 * INSTAGRAM_SEAT.messagesPerMonth);
  });
});
