import { FlowEngineService } from './flow-engine.service';
import { FlowGraph, defaultGraph, validateGraph } from '../flows/flow-graph';

// ---- graph fixtures --------------------------------------------------------

const REFS = {
  agentIds: new Set(['agent1']),
  humanAgentIds: new Set(['ha1', 'ha2']),
  webhookIds: new Set(['wh1']),
  tagIds: new Set(['tag1']),
  memberIds: new Set(['user1']),
};

function node(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): FlowGraph['nodes'][number] {
  return {
    id,
    type: type as FlowGraph['nodes'][number]['type'],
    position: { x: 0, y: 0 },
    data,
  };
}
function edge(
  source: string,
  target: string,
  sourceHandle?: string,
): FlowGraph['edges'][number] {
  return {
    id: `${source}-${sourceHandle}-${target}`,
    source,
    target,
    sourceHandle,
  };
}

// ---- validation ------------------------------------------------------------

describe('validateGraph', () => {
  it('accepts the default graph', () => {
    expect(validateGraph(defaultGraph(), REFS)).toEqual([]);
  });

  it('requires exactly one trigger', () => {
    const g: FlowGraph = {
      nodes: [node('a', 'keyword', { keywords: ['x'] })],
      edges: [],
    };
    expect(validateGraph(g, REFS).map((e) => e.message)).toContain(
      'The graph needs exactly one trigger node',
    );
  });

  it('treats empty optional assign fields as absent', () => {
    const g: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('a', 'assignHuman', {
          humanAgentId: 'ha1',
          groupPrefix: '',
          farewellText: '',
        }),
      ],
      edges: [edge('t', 'a')],
    };
    expect(validateGraph(g, REFS)).toEqual([]);
  });

  it('rejects unknown references and bad handles', () => {
    const g: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('k', 'keyword', { keywords: ['hola'] }),
        node('r', 'agentReply', { agentId: 'nope' }),
      ],
      edges: [edge('t', 'k'), edge('k', 'r', 'maybe')],
    };
    const errors = validateGraph(g, REFS);
    expect(errors.some((e) => e.message.includes('pick an AI agent'))).toBe(
      true,
    );
    expect(errors.some((e) => e.message.includes('"maybe"'))).toBe(true);
  });

  it('rejects outputs on terminal nodes and duplicate handles', () => {
    const g: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('a', 'assignHuman', { humanAgentId: 'ha1' }),
        node('k', 'keyword', { keywords: ['x'] }),
      ],
      edges: [
        edge('t', 'a'),
        edge('a', 'k'),
        edge('k', 'a', 'yes'),
        edge('k', 'a', 'yes'),
      ],
    };
    const errors = validateGraph(g, REFS);
    expect(errors.some((e) => e.message.includes('cannot have outputs'))).toBe(
      true,
    );
    expect(errors.some((e) => e.message.includes('two edges leave'))).toBe(
      true,
    );
  });

  it('validates intent nodes (reserved fallback key, dupes)', () => {
    const g: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('i', 'intent', {
          agentId: 'agent1',
          intents: [
            { key: 'fallback', label: 'x' },
            { key: 'sales', label: 'Sales' },
            { key: 'sales', label: 'Sales again' },
          ],
        }),
      ],
      edges: [edge('t', 'i')],
    };
    const errors = validateGraph(g, REFS);
    expect(errors.some((e) => e.message.includes('reserved'))).toBe(true);
    expect(errors.some((e) => e.message.includes('duplicate intent key'))).toBe(
      true,
    );
  });
});

// ---- engine walk -----------------------------------------------------------

type AnyRecord = Record<string, unknown>;

function makeEngine(overrides: {
  classify?: (...a: unknown[]) => Promise<string | null>;
  counterValues?: number[];
}) {
  const sent: Array<{ to: string; text: string }> = [];
  const created: AnyRecord[] = [];
  const forwarded: AnyRecord[] = [];
  const dispatched: AnyRecord[] = [];
  const updates: AnyRecord[] = [];
  const stateUpserts: AnyRecord[] = [];
  const agentReplies: AnyRecord[] = [];
  let counterCall = 0;

  const runs: AnyRecord[] = [];
  const prisma = {
    flowRun: {
      create: jest.fn((args: AnyRecord) => {
        runs.push(args);
        return Promise.resolve({});
      }),
    },
    flowConversationState: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((args: AnyRecord) => {
        stateUpserts.push(args);
        return Promise.resolve({});
      }),
    },
    agent: {
      findUnique: jest.fn().mockResolvedValue({ id: 'agent1', name: 'A' }),
    },
    humanAgent: {
      findUnique: jest.fn((args: { where: { id: string } }) =>
        Promise.resolve({
          id: args.where.id,
          name: `Agent ${args.where.id}`,
          phoneNumber: `555${args.where.id}`,
        }),
      ),
    },
    flowCounter: {
      upsert: jest.fn(() => {
        const values = overrides.counterValues ?? [1, 2, 3, 4];
        const value = values[counterCall % values.length];
        counterCall++;
        return Promise.resolve({ value });
      }),
    },
    conversation: {
      update: jest.fn((args: AnyRecord) => {
        updates.push(args);
        return Promise.resolve({});
      }),
    },
    message: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    waSession: {
      findUnique: jest.fn().mockResolvedValue({ organizationId: 'org1' }),
    },
    contact: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: AnyRecord) =>
        Promise.resolve({ id: 'c1', ...(args.data as AnyRecord) }),
      ),
      update: jest.fn((args: AnyRecord) =>
        Promise.resolve({ id: 'c1', ...(args.data as AnyRecord) }),
      ),
    },
  };
  const agentRunner = {
    classify: jest.fn(overrides.classify ?? (() => Promise.resolve(null))),
  };
  const webhooks = {
    dispatchTo: jest.fn((...args: unknown[]) => {
      dispatched.push({ args });
      return Promise.resolve();
    }),
    dispatch: jest.fn(() => Promise.resolve()),
  };
  const manager = {
    runAgentReply: jest.fn((...args: unknown[]) => {
      agentReplies.push({ args });
      return Promise.resolve('replied');
    }),
    createMirrorThread: jest.fn(
      (
        sessionId: string,
        leadJid: string,
        agent: AnyRecord,
        opts: AnyRecord,
      ) => {
        created.push({ sessionId, leadJid, agent, opts });
        return Promise.resolve({
          id: 'thr1',
          groupJid: 'g@g.us',
          showLeadName: true,
        });
      },
    ),
    forwardLeadToGroup: jest.fn((...args: unknown[]) => {
      forwarded.push({ args });
      return Promise.resolve();
    }),
    sendText: jest.fn((sessionId: string, to: string, text: string) => {
      sent.push({ to, text });
      return Promise.resolve({ messageId: 'm', waMessageId: 'w' });
    }),
  };

  const engine = new FlowEngineService(
    prisma as never,
    agentRunner as never,
    webhooks as never,
  );
  return {
    engine,
    manager,
    prisma,
    agentRunner,
    webhooks,
    sent,
    created,
    forwarded,
    dispatched,
    updates,
    stateUpserts,
    agentReplies,
    runs,
  };
}

const CTX = {
  conversationId: 'conv1',
  remoteJid: '549111@s.whatsapp.net',
  isGroup: false,
  mentionedMe: false,
  pushName: 'Juan',
  type: 'TEXT' as never,
  text: 'Quiero información de propiedades',
};

describe('FlowEngineService.run', () => {
  it('routes keyword yes/no with accent-insensitive matching', async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('k', 'keyword', { keywords: ['informacion'] }),
        node('tag', 'tagConversation', { tagId: 'tag1' }),
      ],
      edges: [edge('t', 'k'), edge('k', 'tag', 'yes')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.updates).toHaveLength(1); // tag connected via the yes branch
  });

  it('falls back when intent classification returns null', async () => {
    const t = makeEngine({ classify: () => Promise.resolve(null) });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('i', 'intent', {
          agentId: 'agent1',
          intents: [{ key: 'sales', label: 'Sales' }],
        }),
        node('a', 'assignHuman', { humanAgentId: 'ha1' }),
        node('r', 'agentReply', { agentId: 'agent1' }),
      ],
      edges: [
        edge('t', 'i'),
        edge('i', 'a', 'sales'),
        edge('i', 'r', 'fallback'),
      ],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.created).toHaveLength(0);
    expect(t.agentReplies).toHaveLength(1);
  });

  it('assigns via intent branch: creates thread, forwards, farewell, state', async () => {
    const t = makeEngine({ classify: () => Promise.resolve('sales') });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('i', 'intent', {
          agentId: 'agent1',
          intents: [{ key: 'sales', label: 'Sales' }],
        }),
        node('a', 'assignHuman', {
          humanAgentId: 'ha1',
          groupPrefix: 'ConsultasWeb',
          farewellText: 'Te conectamos con un asesor.',
        }),
      ],
      edges: [edge('t', 'i'), edge('i', 'a', 'sales')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.created[0]).toMatchObject({
      leadJid: CTX.remoteJid,
      agent: { id: 'ha1', number: '555ha1' },
      opts: { prefix: 'ConsultasWeb' },
    });
    expect(t.forwarded).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ text: 'Te conectamos con un asesor.' });
    expect(t.stateUpserts[0]).toMatchObject({
      create: { status: 'HANDED_OFF', humanAgentId: 'ha1' },
    });
    // The run was recorded with the taken path and outcome.
    expect(t.runs).toHaveLength(1);
    expect(
      (t.runs[0] as { data: { outcome: string; steps: unknown[] } }).data,
    ).toMatchObject({ outcome: 'handed_off' });
  });

  it('copies the conversation history into the new group when asked', async () => {
    const t = makeEngine({});
    // Newest first, as the real query returns them.
    t.prisma.message.findMany.mockResolvedValue([
      { direction: 'INBOUND', source: 'CONTACT', type: 'TEXT', text: CTX.text },
      {
        direction: 'OUTBOUND',
        source: 'AGENT',
        type: 'TEXT',
        text: 'Hola, ¿en qué te ayudo?',
      },
      { direction: 'INBOUND', source: 'CONTACT', type: 'TEXT', text: 'Hola' },
    ]);
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('a', 'assignHuman', { humanAgentId: 'ha1', copyHistory: true }),
      ],
      edges: [edge('t', 'a')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    // The transcript lands in the group, attributed per speaker…
    const transcript = t.sent.find((s) => s.to === 'g@g.us');
    expect(transcript?.text).toContain('Historial');
    expect(transcript?.text).toContain('*Juan:* Hola');
    expect(transcript?.text).toContain('*Bot:* Hola, ¿en qué te ayudo?');
    // …without the triggering message, which is forwarded separately.
    expect(transcript?.text.includes(CTX.text)).toBe(false);
    expect(t.forwarded).toHaveLength(1);
  });

  it('saveContact creates the lead once and dispatches contact.created', async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('c', 'saveContact'),
        node('tag', 'tagConversation', { tagId: 'tag1' }),
      ],
      edges: [edge('t', 'c'), edge('c', 'tag', 'out')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org1',
          phoneNumber: '549111',
          name: 'Juan',
        }),
      }),
    );
    expect(t.webhooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'contact.created' }),
    );
    // The walk continued through the out handle.
    expect(t.updates.length).toBeGreaterThan(0);

    // Second run: the contact exists with a name — no create, no dispatch.
    t.prisma.contact.findFirst.mockResolvedValue({ id: 'c1', name: 'Juan' });
    t.prisma.contact.create.mockClear();
    (t.webhooks.dispatch as jest.Mock).mockClear();
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.prisma.contact.create).not.toHaveBeenCalled();
    expect(t.webhooks.dispatch).not.toHaveBeenCalled();
  });

  it('round-robins across human agents using the counter', async () => {
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('rr', 'roundRobin', { humanAgentIds: ['ha1', 'ha2'] }),
      ],
      edges: [edge('t', 'rr')],
    };
    const first = makeEngine({ counterValues: [1] });
    await first.engine.run(
      { id: 'f1', graph },
      's1',
      CTX,
      first.manager as never,
    );
    expect(first.created[0]).toMatchObject({ agent: { id: 'ha1' } });

    const second = makeEngine({ counterValues: [2] });
    await second.engine.run(
      { id: 'f1', graph },
      's1',
      CTX,
      second.manager as never,
    );
    expect(second.created[0]).toMatchObject({ agent: { id: 'ha2' } });
  });

  it('continues along onHandoff when the agent hands off', async () => {
    const t = makeEngine({});
    t.manager.runAgentReply.mockImplementation((...args: unknown[]) => {
      t.agentReplies.push({ args });
      return Promise.resolve('handoff');
    });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('r', 'agentReply', { agentId: 'agent1' }),
        node('a', 'assignHuman', { humanAgentId: 'ha2' }),
      ],
      edges: [edge('t', 'r'), edge('r', 'a', 'onHandoff')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    // pauseOnHandoff false because the edge exists
    expect((t.agentReplies[0] as { args: unknown[] }).args[4]).toEqual({
      pauseOnHandoff: false,
    });
    expect(t.created[0]).toMatchObject({ agent: { id: 'ha2' } });
  });

  it('skips handed-off conversations entirely', async () => {
    const t = makeEngine({});
    t.prisma.flowConversationState.findUnique.mockResolvedValue({
      status: 'HANDED_OFF',
    });
    const graph = defaultGraph();
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.agentReplies).toHaveLength(0);
  });

  it('stops at the step limit on cyclic graphs', async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('w', 'webhook', { webhookId: 'wh1' }),
        node('tag', 'tagConversation', { tagId: 'tag1' }),
      ],
      edges: [edge('t', 'w'), edge('w', 'tag'), edge('tag', 'w')],
    };
    await t.engine.run({ id: 'f1', graph }, 's1', CTX, t.manager as never);
    expect(t.dispatched.length + t.updates.length).toBeLessThanOrEqual(20);
    expect(t.dispatched.length).toBeGreaterThan(3); // it did loop, then stopped
  });
});
