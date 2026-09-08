import { LeadershipStore, SessionLeadership } from './session-leadership';

/** In-memory Redis with the four commands leadership uses. TTLs are ignored. */
class FakeStore implements LeadershipStore {
  readonly data = new Map<string, string>();
  set(key: string, value: string): Promise<'OK' | null> {
    if (this.data.has(key)) return Promise.resolve(null);
    this.data.set(key, value);
    return Promise.resolve('OK');
  }
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }
  pexpire(): Promise<number> {
    return Promise.resolve(1);
  }
  /** The only script used is compare-and-delete. */
  eval(_script: string, _n: number, key: string, owner: string) {
    if (this.data.get(key) !== owner) return Promise.resolve(0);
    this.data.delete(key);
    return Promise.resolve(1);
  }
}

function task(
  store: FakeStore,
  id: string,
  clock: { now: number },
  opts: { failAcquires?: number } = {},
) {
  const events: string[] = [];
  let failures = opts.failAcquires ?? 0;
  const leadership = new SessionLeadership(
    store,
    id,
    {
      onAcquire: () => {
        if (failures > 0) {
          failures -= 1;
          events.push('acquire-failed');
          throw new Error('db down');
        }
        events.push('acquire');
      },
      onRelease: () => {
        events.push('release');
      },
      log: () => undefined,
    },
    { reacquireAfterMs: 30_000, now: () => clock.now },
  );
  return { leadership, events };
}

describe('SessionLeadership', () => {
  it('hands the sockets to a newer task within two ticks', async () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    const old = task(store, 'old', clock);
    const fresh = task(store, 'new', clock);

    await old.leadership.tick();
    expect(old.leadership.status()).toMatchObject({ leader: true });
    expect(old.events).toEqual(['acquire']);

    // The new task boots, cannot take the lock, and asks for it.
    await fresh.leadership.tick();
    expect(fresh.leadership.status()).toMatchObject({
      leader: false,
      standby: true,
    });
    expect(fresh.leadership.ready()).toBe(false);
    expect(store.data.get('whathooks:session-leader:handover')).toBe('new');

    // The leader sees the request and yields at once.
    await old.leadership.tick();
    expect(old.leadership.status()).toMatchObject({
      leader: false,
      yielded: true,
    });
    expect(old.leadership.ready()).toBe(false);
    expect(old.events).toEqual(['acquire', 'release']);
    expect(store.data.has('whathooks:session-leader')).toBe(false);

    // The new task takes over and clears its own request.
    await fresh.leadership.tick();
    expect(fresh.leadership.status()).toMatchObject({ leader: true });
    expect(fresh.leadership.ready()).toBe(true);
    expect(fresh.events).toEqual(['acquire']);
    expect(store.data.has('whathooks:session-leader:handover')).toBe(false);

    // The old task stays out of the way for as long as the lock is held.
    clock.now += 60_000;
    await old.leadership.tick();
    expect(old.leadership.status()).toMatchObject({
      leader: false,
      yielded: true,
    });
  });

  it('takes the lock back when the taker dies before claiming it', async () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    const old = task(store, 'old', clock);
    await old.leadership.tick();
    store.data.set('whathooks:session-leader:handover', 'new');
    await old.leadership.tick();
    expect(old.leadership.status().yielded).toBe(true);

    // Too soon: the taker may simply not have ticked yet.
    clock.now += 10_000;
    await old.leadership.tick();
    expect(old.leadership.status().leader).toBe(false);

    // Long enough with nobody holding it: back to work.
    clock.now += 30_000;
    await old.leadership.tick();
    expect(old.leadership.status()).toMatchObject({
      leader: true,
      yielded: false,
    });
    expect(old.events).toEqual(['acquire', 'release', 'acquire']);
  });

  it('is not ready until the sockets are up, and retries a failed restore', async () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    const t = task(store, 'a', clock, { failAcquires: 1 });
    await t.leadership.tick();
    // Holds the lock, but nothing is open: keep traffic away.
    expect(t.leadership.status()).toMatchObject({
      leader: true,
      sockets: 'none',
    });
    expect(t.leadership.ready()).toBe(false);
    await t.leadership.tick();
    expect(t.leadership.status().sockets).toBe('up');
    expect(t.leadership.ready()).toBe(true);
    expect(t.events).toEqual(['acquire-failed', 'acquire']);
  });

  it('never deletes a lock another task has since taken', async () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    const old = task(store, 'old', clock);
    await old.leadership.tick();
    // The lease expired and a newer task grabbed the key before we yield.
    store.data.set('whathooks:session-leader', 'new');
    store.data.set('whathooks:session-leader:handover', 'new');
    await old.leadership.tick();
    expect(store.data.get('whathooks:session-leader')).toBe('new');
    expect(old.leadership.status().leader).toBe(false);
  });

  it('is ready when alone, even before the first tick', () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    expect(task(store, 'only', clock).leadership.ready()).toBe(true);
  });

  it('releases the lock on shutdown only if it holds it', async () => {
    const store = new FakeStore();
    const clock = { now: 0 };
    const a = task(store, 'a', clock);
    const b = task(store, 'b', clock);
    await a.leadership.tick();
    await b.leadership.tick();
    await b.leadership.release();
    expect(store.data.get('whathooks:session-leader')).toBe('a');
    await a.leadership.release();
    expect(store.data.has('whathooks:session-leader')).toBe(false);
  });
});
