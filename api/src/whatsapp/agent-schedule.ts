/**
 * Active-hours schedule for AI agents. When enabled, the agent only
 * auto-replies inside the configured window; days are 0-6 (Sunday = 0)
 * evaluated in the agent's timezone, minutes are from midnight, and
 * end <= start means the window crosses midnight (the early-morning tail
 * belongs to the previous day's window).
 */
export interface AgentSchedule {
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStartMinute: number;
  scheduleEndMinute: number;
  scheduleTimezone: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function agentActiveNow(
  agent: AgentSchedule,
  now: Date = new Date(),
): boolean {
  if (!agent.scheduleEnabled) return true;
  if (agent.scheduleDays.length === 0) return false; // scheduled but no days

  let day: number;
  let minute: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: agent.scheduleTimezone || 'UTC',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    day = WEEKDAYS.indexOf(get('weekday'));
    minute = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  } catch {
    return true; // bad timezone — fail open rather than silencing the agent
  }
  if (day < 0) return true;

  const start = agent.scheduleStartMinute;
  const end = agent.scheduleEndMinute;
  if (end > start) {
    return agent.scheduleDays.includes(day) && minute >= start && minute < end;
  }
  // Crosses midnight: today's evening part, or the tail of yesterday's window.
  const yesterday = (day + 6) % 7;
  return (
    (agent.scheduleDays.includes(day) && minute >= start) ||
    (agent.scheduleDays.includes(yesterday) && minute < end)
  );
}
