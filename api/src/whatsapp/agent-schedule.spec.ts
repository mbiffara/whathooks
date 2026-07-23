import { agentActiveNow, AgentSchedule } from './agent-schedule';

// Fri–Sun, 18:00 → midnight, Buenos Aires (UTC-3, no DST)
const weekendEvenings: AgentSchedule = {
  scheduleEnabled: true,
  scheduleDays: [5, 6, 0],
  scheduleStartMinute: 18 * 60,
  scheduleEndMinute: 0,
  scheduleTimezone: 'America/Argentina/Buenos_Aires',
};

// 2026-07-24 is a Friday.
const at = (iso: string) => new Date(iso);

describe('agentActiveNow', () => {
  it('always on when scheduling is disabled', () => {
    expect(
      agentActiveNow(
        { ...weekendEvenings, scheduleEnabled: false },
        at('2026-07-22T15:00:00Z'),
      ),
    ).toBe(true);
  });

  it('never on when scheduled with no days', () => {
    expect(
      agentActiveNow(
        { ...weekendEvenings, scheduleDays: [] },
        at('2026-07-24T22:00:00Z'),
      ),
    ).toBe(false);
  });

  it('inside the window on an enabled day', () => {
    // Friday 19:00 ART = 22:00 UTC
    expect(agentActiveNow(weekendEvenings, at('2026-07-24T22:00:00Z'))).toBe(
      true,
    );
  });

  it('before the window on an enabled day', () => {
    // Friday 17:00 ART
    expect(agentActiveNow(weekendEvenings, at('2026-07-24T20:00:00Z'))).toBe(
      false,
    );
  });

  it('end at midnight covers late evening', () => {
    // Saturday 23:59 ART = Sunday 02:59 UTC
    expect(agentActiveNow(weekendEvenings, at('2026-07-26T02:59:00Z'))).toBe(
      true,
    );
  });

  it('off outside the enabled days', () => {
    // Monday 10:00 ART
    expect(agentActiveNow(weekendEvenings, at('2026-07-27T13:00:00Z'))).toBe(
      false,
    );
  });

  it('overnight window spills into the next morning', () => {
    // Fri 22:00 → 06:00: Saturday 03:00 ART = 06:00 UTC belongs to Friday
    const overnight = {
      ...weekendEvenings,
      scheduleStartMinute: 22 * 60,
      scheduleEndMinute: 6 * 60,
      scheduleDays: [5],
    };
    expect(agentActiveNow(overnight, at('2026-07-25T06:00:00Z'))).toBe(true);
    // ...but Saturday 07:00 ART does not
    expect(agentActiveNow(overnight, at('2026-07-25T10:00:00Z'))).toBe(false);
  });

  it('fails open on an invalid timezone', () => {
    expect(
      agentActiveNow(
        { ...weekendEvenings, scheduleTimezone: 'Not/AZone' },
        at('2026-07-22T15:00:00Z'),
      ),
    ).toBe(true);
  });
});
