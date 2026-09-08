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
  del(key: string): Promise<number>;
}

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
  leader: boolean;
  /** Handed the sockets to a newer task; not coming back unless it dies. */
  yielded: boolean;
  /** Another task holds the lock and this one is waiting for it. */
  standby: boolean;
}

export class SessionLeadership {
  private readonly key: string;
  private readonly handoverKey: string;
  private readonly ttlMs: number;
  private readonly handoverTtlMs: number;
  private readonly reacquireAfterMs: number;
  private readonly now: () => number;

  private leader = false;
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
    };
  }

  /** Whether this task should take traffic: it leads, or nobody else does. */
  ready(): boolean {
    return this.leader || (!this.yielded && !this.standby);
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
    this.hooks.onRelease();
    if (!held) return;
    try {
      if ((await this.store.get(this.key)) === this.instanceId) {
        await this.store.del(this.key);
      }
      this.hooks.log('Released session leadership');
    } catch {
      /* the TTL will expire it */
    }
  }

  private async becomeLeader(): Promise<void> {
    this.leader = true;
    this.standby = false;
    this.yielded = false;
    // Our own request, if we ever left one, is fulfilled.
    if ((await this.store.get(this.handoverKey)) === this.instanceId) {
      await this.store.del(this.handoverKey);
    }
    this.hooks.log('Acquired session leadership');
    await this.hooks.onAcquire();
  }

  private async yield(): Promise<void> {
    this.hooks.log('Handing session leadership to a newer task');
    this.leader = false;
    this.yielded = true;
    this.yieldedAt = this.now();
    this.hooks.onRelease();
    if ((await this.store.get(this.key)) === this.instanceId) {
      await this.store.del(this.key);
    }
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
