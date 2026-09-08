/**
 * Which API task runs the WhatsApp sockets.
 *
 * Exactly one task may hold the Baileys connections, so leadership is a
 * Redis lock with a short TTL that the holder renews every tick. A deploy
 * starts the new task while the old one is still serving, and both sit
 * behind the load balancer; whoever is not the leader cannot send anything.
 * The handover therefore has to be quick and explicit:
 *
 * 1. The new task cannot take the lock, so it leaves a handover request.
 * 2. The leader sees the request on its next tick, closes its sockets and
 *    releases the lock, and from then on reports itself not ready, so the
 *    load balancer stops sending it traffic.
 * 3. The new task takes the lock on its next tick and restores the sockets.
 *
 * Seconds, not the minutes it takes ECS to stop the old task. If the taker
 * dies before it ever holds the lock, the yielded task takes it back after a
 * grace period, so a failed deploy never leaves the sockets with nobody.
 */

/** The subset of ioredis this class uses, so tests can fake it. */
export interface LeadershipStore {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  pexpire(key: string, ttl: number): Promise<number>;
  /** Server-side script, so "delete only if I still own it" is one step. */
  eval(
    script: string,
    numKeys: number,
    ...keysAndArgs: string[]
  ): Promise<unknown>;
}

/**
 * Compare-and-delete. Two round trips (GET, then DEL) leave a gap in which
 * the lease can expire and someone else take the key, so the DEL would
 * remove *their* lock and let a third task in. Redis runs a script
 * atomically, so the check and the delete cannot be split.
 */
const DEL_IF_OWNED = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export interface LeadershipHooks {
  /** Became the leader: open the sockets. */
  onAcquire: () => Promise<void> | void;
  /** No longer the leader (yielded, lost, or shutting down): close them. */
  onRelease: () => void;
  log: (message: string) => void;
}

export interface LeadershipOptions {
  key?: string;
  ttlMs?: number;
  /** How long a handover request stays valid without being renewed. */
  handoverTtlMs?: number;
  /** How long a yielded task waits for a free lock before taking it back. */
  reacquireAfterMs?: number;
  now?: () => number;
}

export interface LeadershipStatus {
  /** Holds the lock. Sockets may still be coming up: see `sockets`. */
  leader: boolean;
  /** Handed the sockets to a newer task; not coming back unless it dies. */
  yielded: boolean;
  /** Another task holds the lock and this one is waiting for it. */
  standby: boolean;
  /** Whether the sockets behind the lock are actually open. */
  sockets: 'none' | 'restoring' | 'up';
}

export class SessionLeadership {
  private readonly key: string;
  private readonly handoverKey: string;
  private readonly ttlMs: number;
  private readonly handoverTtlMs: number;
  private readonly reacquireAfterMs: number;
  private readonly now: () => number;

  private leader = false;
  private sockets: LeadershipStatus['sockets'] = 'none';
  private yielded = false;
  private yieldedAt = 0;
  private standby = false;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: LeadershipStore,
    readonly instanceId: string,
    private readonly hooks: LeadershipHooks,
    opts: LeadershipOptions = {},
  ) {
    this.key = opts.key ?? 'whathooks:session-leader';
    this.handoverKey = `${this.key}:handover`;
    this.ttlMs = opts.ttlMs ?? 20_000;
    this.handoverTtlMs = opts.handoverTtlMs ?? 30_000;
    this.reacquireAfterMs = opts.reacquireAfterMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  status(): LeadershipStatus {
    return {
      leader: this.leader,
      yielded: this.yielded,
      standby: this.standby,
      sockets: this.sockets,
    };
  }

  /**
   * Whether this task should take traffic: it leads *and* its sockets are
   * open, or nobody else leads. Holding the lock with the sockets still
   * down (a restore that failed and is being retried) is not ready: the
   * balancer would send traffic to a task that cannot send.
   */
  ready(): boolean {
    if (this.leader) return this.sockets === 'up';
    return !this.yielded && !this.standby;
  }

  start(intervalMs = 5_000): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      if (this.yielded && !(await this.mayReacquire())) return;

      const acquired = await this.store.set(
        this.key,
        this.instanceId,
        'PX',
        this.ttlMs,
        'NX',
      );
      if (acquired) {
        await this.becomeLeader();
        return;
      }
      const holder = await this.store.get(this.key);
      if (holder === this.instanceId) {
        await this.store.pexpire(this.key, this.ttlMs);
        if (!this.leader) await this.becomeLeader();
        // A restore that failed (database blip while opening the sockets)
        // is retried on every renewal until it succeeds.
        else if (this.sockets === 'none') await this.restore();
        // A newer task is waiting: give it the sockets now rather than when
        // ECS gets round to stopping this one.
        const request = await this.store.get(this.handoverKey);
        if (request && request !== this.instanceId) await this.yield();
        return;
      }
      // Someone else leads.
      this.standby = true;
      if (this.leader) {
        this.hooks.log('Lost session leadership, closing sockets');
        this.leader = false;
        this.sockets = 'none';
        this.hooks.onRelease();
      }
      await this.store.set(
        this.handoverKey,
        this.instanceId,
        'PX',
        this.handoverTtlMs,
        'NX',
      );
    } catch (e) {
      this.hooks.log(`Leadership tick failed: ${e}`);
    }
  }

  /** On shutdown: drop the lock if we hold it so the next task is quick. */
  async release(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    const held = this.leader;
    // Not leader first, then close: the socket close handlers read it to
    // tell a handover from a real disconnect.
    this.leader = false;
    this.sockets = 'none';
    this.hooks.onRelease();
    if (!held) return;
    try {
      await this.delIfOwned(this.key);
      this.hooks.log('Released session leadership');
    } catch {
      /* the TTL will expire it */
    }
  }

  private async becomeLeader(): Promise<void> {
    this.leader = true;
    this.standby = false;
    this.yielded = false;
    this.hooks.log('Acquired session leadership');
    // Our own request, if we ever left one, is fulfilled. Best-effort: a
    // stale request from us is harmless (we hold the lock and ignore our
    // own id), and it expires on its own.
    try {
      await this.delIfOwned(this.handoverKey);
    } catch (e) {
      this.hooks.log(`Could not clear the handover request: ${e}`);
    }
    await this.restore();
  }

  /** Open the sockets; `ready()` stays false until this has succeeded. */
  private async restore(): Promise<void> {
    this.sockets = 'restoring';
    try {
      await this.hooks.onAcquire();
      this.sockets = 'up';
    } catch (e) {
      this.sockets = 'none';
      this.hooks.log(`Restoring sessions failed, will retry: ${e}`);
    }
  }

  private async yield(): Promise<void> {
    this.hooks.log('Handing session leadership to a newer task');
    this.leader = false;
    this.sockets = 'none';
    this.yielded = true;
    this.yieldedAt = this.now();
    this.hooks.onRelease();
    await this.delIfOwned(this.key);
  }

  private delIfOwned(key: string): Promise<unknown> {
    return this.store.eval(DEL_IF_OWNED, 1, key, this.instanceId);
  }

  /**
   * A yielded task stays out of the way while the lock is held or was only
   * just freed. A lock nobody has claimed for a while means the taker died
   * before it got there, and the sockets are better here than nowhere.
   */
  private async mayReacquire(): Promise<boolean> {
    const holder = await this.store.get(this.key);
    if (holder) {
      this.yieldedAt = this.now();
      return false;
    }
    if (this.now() - this.yieldedAt < this.reacquireAfterMs) return false;
    this.hooks.log('Nobody took session leadership; taking it back');
    this.yielded = false;
    return true;
  }
}
