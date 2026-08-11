import { InstagramHealthService } from './instagram-health.service';

/**
 * The sweep's alerting rules, exercised against fakes.
 *
 * The case that matters is the loop: the expiry warning and the outage alert
 * share one flag on the session row, so clearing that flag on every healthy
 * sweep would email "restored" and then "expiring" again, twice per sweep,
 * for as long as the token sat near expiry. Nothing about that is visible in
 * a type check and it would only surface as a customer complaint.
 */
function build(opts: {
  sessions: Array<{ id: string; externalAccountId: string; status: string }>;
  accounts: Array<{
    _id: string;
    platform?: string;
    isActive?: boolean;
    needsReconnection?: boolean;
    tokenExpiresAt?: string;
  }>;
}) {
  const sent: Array<{ id: string; kind: string }> = [];
  // Mirrors the real conditional-update semantics: claiming succeeds only
  // when the flag is null, clearing only when it is set.
  const flags = new Map<string, boolean>();
  const alerts = {
    alert: (id: string, kind: string) => {
      sent.push({ id, kind });
      return Promise.resolve();
    },
    claimOutage: (id: string) => {
      if (flags.get(id)) return Promise.resolve(false);
      flags.set(id, true);
      return Promise.resolve(true);
    },
    clearOutage: (id: string) => {
      if (!flags.get(id)) return Promise.resolve(false);
      flags.set(id, false);
      return Promise.resolve(true);
    },
  };
  const state = [...opts.sessions];
  const prisma = {
    waSession: {
      findMany: () => Promise.resolve(state),
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const row = state.find((s) => s.id === where.id);
        if (row && data.status) row.status = data.status;
        return Promise.resolve(row);
      },
    },
  };
  const zernio = {
    configured: true,
    listAccounts: () => Promise.resolve(opts.accounts),
  };
  const svc = new InstagramHealthService(
    prisma as never,
    zernio as never,
    alerts as never,
  );
  return { svc, sent, flags };
}

const soon = () => new Date(Date.now() + 2 * 86_400_000).toISOString();
const later = () => new Date(Date.now() + 40 * 86_400_000).toISOString();

describe('InstagramHealthService.sweep', () => {
  it('says nothing about a healthy account with a fresh token', async () => {
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'CONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, tokenExpiresAt: later() }],
    });
    await svc.sweep();
    await svc.sweep();
    expect(sent).toEqual([]);
  });

  it('warns once about an expiring token, not once per sweep', async () => {
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'CONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, tokenExpiresAt: soon() }],
    });
    await svc.sweep();
    await svc.sweep();
    await svc.sweep();
    expect(sent).toEqual([{ id: 's1', kind: 'sessionDown' }]);
  });

  it('never ping-pongs restored/expiring on a healthy expiring account', async () => {
    // The regression this file exists for.
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'CONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, tokenExpiresAt: soon() }],
    });
    for (let i = 0; i < 5; i++) await svc.sweep();
    expect(sent.filter((s) => s.kind === 'sessionRestored')).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  it('alerts once when Zernio reports the account needs reconnection', async () => {
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'CONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, needsReconnection: true }],
    });
    await svc.sweep();
    await svc.sweep();
    expect(sent).toEqual([{ id: 's1', kind: 'sessionLoggedOut' }]);
  });

  it('treats an account missing from Zernio as broken', async () => {
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'gone', status: 'CONNECTED' }],
      accounts: [{ _id: 'other', isActive: true }],
    });
    await svc.sweep();
    expect(sent).toEqual([{ id: 's1', kind: 'sessionLoggedOut' }]);
  });

  it('reports recovery once, after a real outage', async () => {
    const { svc, sent, flags } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'DISCONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, tokenExpiresAt: later() }],
    });
    flags.set('s1', true); // we had alerted about the outage
    await svc.sweep();
    await svc.sweep();
    expect(sent).toEqual([{ id: 's1', kind: 'sessionRestored' }]);
  });

  it('does not claim recovery for a session that was never down', async () => {
    const { svc, sent } = build({
      sessions: [{ id: 's1', externalAccountId: 'a1', status: 'CONNECTED' }],
      accounts: [{ _id: 'a1', isActive: true, tokenExpiresAt: later() }],
    });
    await svc.sweep();
    expect(sent).toEqual([]);
  });
});
