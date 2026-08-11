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
  decide?: (...a: unknown[]) => Promise<boolean | null>;
  generateReply?: (
    ...a: unknown[]
  ) => Promise<{ text: string | null; handoff: boolean } | null>;
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
      findUnique: jest.fn().mockResolvedValue({
        id: 'agent1',
        name: 'A',
        enabled: true,
        scheduleEnabled: false,
        scheduleDays: [],
        scheduleStartMinute: 0,
        scheduleEndMinute: 0,
        scheduleTimezone: 'UTC',
      }),
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
    decide: jest.fn(overrides.decide ?? (() => Promise.resolve(null))),
    generateReply: jest.fn(
      overrides.generateReply ??
        (() =>
          Promise.resolve({ text: 'Hola, ¿en qué te ayudo?', handoff: false })),
    ),
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
        agents: AnyRecord[],
        opts: AnyRecord,
      ) => {
        created.push({ sessionId, leadJid, agents, opts });
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
    // Channel-routed send: the engine uses this wherever the destination may
    // not be WhatsApp (farewells go to the lead, whatever channel they used).
    sendOnSession: jest.fn((sessionId: string, to: string, text: string) => {
      sent.push({ to, text });
      return Promise.resolve();
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.created[0]).toMatchObject({
      leadJid: CTX.remoteJid,
      agents: [{ id: 'ha1', number: '555ha1' }],
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    const createArgs = t.prisma.contact.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      organizationId: 'org1',
      phoneNumber: '549111',
      name: 'Juan',
    });
    expect(t.webhooks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'contact.created' }),
    );
    // The walk continued through the out handle.
    expect(t.updates.length).toBeGreaterThan(0);

    // Second run: the contact exists with a name and this session already
    // linked — no create, no dispatch.
    t.prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      name: 'Juan',
      sessions: [{ id: 's1' }],
    });
    t.prisma.contact.create.mockClear();
    (t.webhooks.dispatch as jest.Mock).mockClear();
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
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
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      first.manager as never,
    );
    expect(first.created[0]).toMatchObject({ agents: [{ id: 'ha1' }] });

    const second = makeEngine({ counterValues: [2] });
    await second.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      second.manager as never,
    );
    expect(second.created[0]).toMatchObject({ agents: [{ id: 'ha2' }] });
  });

  it('linked human agents also claim inbox assignment on handoff', async () => {
    const t = makeEngine({});
    t.prisma.humanAgent.findUnique.mockResolvedValue({
      id: 'ha1',
      name: 'Agent ha1',
      phoneNumber: '555ha1',
      userId: 'user1',
    } as never);
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('a', 'assignHuman', { humanAgentId: 'ha1' }),
      ],
      edges: [edge('t', 'a')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.updates[0]).toMatchObject({
      where: { id: 'conv1' },
      data: { assignedToUserId: 'user1' },
    });
  });

  it('assignGroup puts every agent in one group and hands off', async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('g', 'assignGroup', { humanAgentIds: ['ha1', 'ha2'] }),
      ],
      edges: [edge('t', 'g')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    // One group with both agents — no round-robin counter involved.
    expect(t.created).toHaveLength(1);
    expect(t.created[0]).toMatchObject({
      agents: [
        { id: 'ha1', number: '555ha1' },
        { id: 'ha2', number: '555ha2' },
      ],
    });
    expect(t.prisma.flowCounter.upsert).not.toHaveBeenCalled();
    expect(t.forwarded).toHaveLength(1);
    expect(t.stateUpserts[0]).toMatchObject({
      create: { status: 'HANDED_OFF', humanAgentId: 'ha1' },
    });
    expect((t.runs[0] as { data: { outcome: string } }).data).toMatchObject({
      outcome: 'handed_off',
    });
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    // pauseOnHandoff false because the edge exists
    expect((t.agentReplies[0] as { args: unknown[] }).args[4]).toEqual({
      pauseOnHandoff: false,
      stepInstructions: null,
    });
    expect(t.created[0]).toMatchObject({ agents: [{ id: 'ha2' }] });
  });

  it('skips handed-off conversations entirely', async () => {
    const t = makeEngine({});
    t.prisma.flowConversationState.findUnique.mockResolvedValue({
      status: 'HANDED_OFF',
    });
    const graph = defaultGraph();
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
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
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.dispatched.length + t.updates.length).toBeLessThanOrEqual(20);
    expect(t.dispatched.length).toBeGreaterThan(3); // it did loop, then stopped
  });
});

describe('keywordCases routing', () => {
  const graph = (): FlowGraph => ({
    nodes: [
      node('t', 'trigger'),
      node('c', 'keywordCases', {
        cases: [
          { key: 'billing', label: 'Billing', keywords: ['factura', 'pago'] },
          { key: 'support', label: 'Support', keywords: ['no funciona'] },
        ],
      }),
      node('tag', 'tagConversation', { tagId: 'tag1' }),
      node('r', 'agentReply', { agentId: 'agent1' }),
    ],
    edges: [
      edge('t', 'c'),
      edge('c', 'tag', 'billing'),
      edge('c', 'r', 'fallback'),
    ],
  });

  it('takes the branch whose keywords match, ignoring accents', async () => {
    const t = makeEngine({});
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      { ...CTX, text: 'Necesito la FACTURA de marzo' },
      t.manager as never,
    );
    expect(t.updates).toHaveLength(1); // tagged via the billing branch
    expect(t.agentReplies).toHaveLength(0);
  });

  it('falls back when no case matches', async () => {
    const t = makeEngine({});
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      { ...CTX, text: 'hola, buenas tardes' },
      t.manager as never,
    );
    expect(t.updates).toHaveLength(0);
    expect(t.agentReplies).toHaveLength(1);
  });

  it('falls back when the matching case has no edge wired', async () => {
    const t = makeEngine({});
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      // "support" matches but only billing and fallback are connected.
      { ...CTX, text: 'el bot no funciona' },
      t.manager as never,
    );
    expect(t.agentReplies).toHaveLength(1);
  });
});

describe('aiDecision routing', () => {
  const graph = (): FlowGraph => ({
    nodes: [
      node('t', 'trigger'),
      node('d', 'aiDecision', {
        agentId: 'agent1',
        question: 'Is the customer angry?',
      }),
      node('a', 'assignHuman', { humanAgentId: 'ha1' }),
      node('r', 'agentReply', { agentId: 'agent1' }),
    ],
    edges: [edge('t', 'd'), edge('d', 'a', 'yes'), edge('d', 'r', 'no')],
  });

  it('takes yes when the agent decides yes', async () => {
    const t = makeEngine({ decide: () => Promise.resolve(true) });
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.created).toHaveLength(1); // handed to a human
  });

  it('takes no when the agent decides no', async () => {
    const t = makeEngine({ decide: () => Promise.resolve(false) });
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.created).toHaveLength(0);
    expect(t.agentReplies).toHaveLength(1);
  });

  it('treats an undecided answer as no, so a flow never stalls', async () => {
    const t = makeEngine({ decide: () => Promise.resolve(null) });
    await t.engine.run(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.agentReplies).toHaveLength(1);
  });
});

describe('FlowEngineService.simulate', () => {
  /** Every action node, so nothing can quietly stay live in a dry run. */
  const graph = (): FlowGraph => ({
    nodes: [
      node('t', 'trigger'),
      node('k', 'keyword', { keywords: ['precio'] }),
      node('tag', 'tagConversation', { tagId: 'tag1' }),
      node('wh', 'webhook', { webhookId: 'wh1' }),
      node('sc', 'saveContact'),
      node('at', 'assignTeammate', { userId: 'user1' }),
      node('a', 'assignHuman', { humanAgentId: 'ha1' }),
      node('r', 'agentReply', { agentId: 'agent1' }),
    ],
    edges: [
      edge('t', 'k'),
      edge('k', 'tag', 'yes'),
      edge('tag', 'wh'),
      edge('wh', 'sc'),
      edge('sc', 'at'),
      edge('at', 'a'),
      edge('k', 'r', 'no'),
    ],
  });

  it('walks the real branches but performs no side effect', async () => {
    const t = makeEngine({});
    const rec = await t.engine.simulate(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      { ...CTX, text: 'cual es el PRECIO?' },
      t.manager as never,
    );

    // Real routing: the accent/case-insensitive keyword match took "yes".
    expect(rec.steps.map((s) => s.nodeId)).toEqual([
      'k',
      'tag',
      'wh',
      'sc',
      'at',
      'a',
    ]);
    expect(rec.outcome).toBe('handed_off');

    // Nothing happened.
    expect(t.sent).toHaveLength(0);
    expect(t.created).toHaveLength(0); // no mirror group
    expect(t.forwarded).toHaveLength(0);
    expect(t.dispatched).toHaveLength(0); // no webhook
    expect(t.updates).toHaveLength(0); // no tag, no assignment
    expect(t.stateUpserts).toHaveLength(0);
    expect(t.agentReplies).toHaveLength(0);
  });

  it('generates the reply text but never sends it', async () => {
    const t = makeEngine({});
    const rec = await t.engine.simulate(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      { ...CTX, text: 'hola' },
      t.manager as never,
    );
    expect(rec.steps.map((s) => s.nodeId)).toEqual(['k', 'r']);
    expect(rec.outcome).toBe('agent_replied');
    // The caller needs the text to continue the conversation…
    expect(rec.reply).toBe('Hola, ¿en qué te ayudo?');
    // …but nothing reached WhatsApp.
    expect(t.agentReplies).toHaveLength(0);
    expect(t.sent).toHaveLength(0);
  });

  it('records no FlowRun — a simulation is not part of the history', async () => {
    const t = makeEngine({});
    await t.engine.simulate(
      { id: 'f1', graph: graph(), organizationId: 'org1' },
      CTX,
      t.manager as never,
    );
    expect(t.runs).toHaveLength(0);
  });
});

describe('AI nodes without an agent', () => {
  it('validates with no agentId, and rejects an unknown one', () => {
    const withNone: FlowGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('i', 'intent', { intents: [{ key: 'sales', label: 'Sales' }] }),
      ],
      edges: [edge('trigger', 'i')],
    };
    expect(validateGraph(withNone, REFS)).toEqual([]);

    const withBogus: FlowGraph = {
      nodes: [
        node('trigger', 'trigger'),
        node('i', 'intent', {
          agentId: 'deleted',
          intents: [{ key: 'sales', label: 'Sales' }],
        }),
      ],
      edges: [edge('trigger', 'i')],
    };
    expect(validateGraph(withBogus, REFS)).toHaveLength(1);
  });

  it('classifies on the org itself, not a configured agent', async () => {
    const t = makeEngine({ classify: () => Promise.resolve('sales') });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        // No agentId: the node runs on the org's included tokens.
        node('i', 'intent', { intents: [{ key: 'sales', label: 'Sales' }] }),
        node('tag', 'tagConversation', { tagId: 'tag1' }),
      ],
      edges: [edge('t', 'i'), edge('i', 'tag', 'sales')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.updates).toHaveLength(1);
    // The runner is handed the paying org, never an Agent row.
    expect(t.agentRunner.classify).toHaveBeenCalledWith(
      { organizationId: 'org1' },
      expect.any(String),
      expect.any(Array),
      undefined, // a real run reads stored messages, not a supplied transcript
    );
  });

  it('decides on the org itself when no agent is set', async () => {
    const t = makeEngine({ decide: () => Promise.resolve(true) });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('d', 'aiDecision', { question: 'Angry?' }),
        node('a', 'assignHuman', { humanAgentId: 'ha1' }),
      ],
      edges: [edge('t', 'd'), edge('d', 'a', 'yes')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.agentRunner.decide).toHaveBeenCalledWith(
      { organizationId: 'org1' },
      expect.any(String),
      'Angry?',
      undefined,
    );
  });
});

describe('simulate with a conversation', () => {
  it('passes the supplied transcript to the AI nodes', async () => {
    const t = makeEngine({ classify: () => Promise.resolve('sales') });
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('i', 'intent', { intents: [{ key: 'sales', label: 'Sales' }] }),
        node('tag', 'tagConversation', { tagId: 'tag1' }),
      ],
      edges: [edge('t', 'i'), edge('i', 'tag', 'sales')],
    };
    const history = [
      { role: 'user' as const, text: 'hola' },
      { role: 'assistant' as const, text: '¿En qué te ayudo?' },
      { role: 'user' as const, text: 'cuánto sale?' },
    ];

    const rec = await t.engine.simulate(
      { id: 'f1', graph, organizationId: 'org1' },
      { ...CTX, text: 'cuánto sale?' },
      t.manager as never,
      history,
    );

    // Without this the classifier reads zero stored rows and always falls
    // through — the branch a simulation most needs to get right.
    expect(t.agentRunner.classify).toHaveBeenCalledWith(
      { organizationId: 'org1' },
      expect.any(String),
      expect.any(Array),
      history,
    );
    expect(rec.steps.map((s) => s.nodeId)).toEqual(['i', 'tag']);
    expect(t.updates).toHaveLength(0); // still a dry run
  });
});

describe('agentReply step instructions', () => {
  it("passes the node's prompt through to the reply", async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('r', 'agentReply', {
          agentId: 'agent1',
          prompt: 'Quote the plans and offer the trial.',
        }),
      ],
      edges: [edge('t', 'r')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.agentReplies[0].args).toEqual([
      's1',
      'conv1',
      expect.any(String),
      'agent1',
      expect.objectContaining({
        stepInstructions: 'Quote the plans and offer the trial.',
      }),
    ]);
  });

  it('sends null when the node has no prompt', async () => {
    const t = makeEngine({});
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger'),
        node('r', 'agentReply', { agentId: 'agent1' }),
      ],
      edges: [edge('t', 'r')],
    };
    await t.engine.run(
      { id: 'f1', graph, organizationId: 'org1' },
      's1',
      CTX,
      t.manager as never,
    );
    expect(t.agentReplies[0].args).toEqual([
      's1',
      'conv1',
      expect.any(String),
      'agent1',
      expect.objectContaining({ stepInstructions: null }),
    ]);
  });
});

describe('simulate reports why an agent did not reply', () => {
  const graph = (data: Record<string, unknown>): FlowGraph => ({
    nodes: [node('t', 'trigger'), node('r', 'agentReply', data)],
    edges: [edge('t', 'r')],
  });

  it('says so when the node has no agent selected', async () => {
    const t = makeEngine({});
    const rec = await t.engine.simulate(
      { id: 'f1', graph: graph({}), organizationId: 'org1' },
      CTX,
      t.manager as never,
    );
    expect(rec.steps[0].note).toMatch(/no AI agent selected/);
    expect(rec.reply).toBeUndefined();
  });

  it('says so when the agent is disabled, like production would skip', async () => {
    const t = makeEngine({});
    t.prisma.agent.findUnique.mockResolvedValue({
      id: 'agent1',
      name: 'A',
      enabled: false,
      scheduleEnabled: false,
      scheduleDays: [],
      scheduleStartMinute: 0,
      scheduleEndMinute: 0,
      scheduleTimezone: 'UTC',
    });
    const rec = await t.engine.simulate(
      { id: 'f1', graph: graph({ agentId: 'agent1' }), organizationId: 'org1' },
      CTX,
      t.manager as never,
    );
    expect(rec.steps[0].note).toMatch(/disabled/);
  });

  it('says so when the agent returns nothing', async () => {
    const t = makeEngine({ generateReply: () => Promise.resolve(null) });
    const rec = await t.engine.simulate(
      { id: 'f1', graph: graph({ agentId: 'agent1' }), organizationId: 'org1' },
      CTX,
      t.manager as never,
    );
    expect(rec.steps[0].note).toMatch(/could not reply/);
  });
});

describe('simulated handoff shows the farewell', () => {
  const graph = (data: Record<string, unknown>): FlowGraph => ({
    nodes: [node('t', 'trigger'), node('a', 'assignHuman', data)],
    edges: [edge('t', 'a')],
  });

  it('returns the farewell the lead would receive', async () => {
    const t = makeEngine({});
    const rec = await t.engine.simulate(
      {
        id: 'f1',
        graph: graph({
          humanAgentId: 'ha1',
          farewellText: '  Gracias, te conectamos con Marcelo.  ',
        }),
        organizationId: 'org1',
      },
      CTX,
      t.manager as never,
    );
    expect(rec.outcome).toBe('handed_off');
    expect(rec.reply).toBe('Gracias, te conectamos con Marcelo.');
    expect(t.sent).toHaveLength(0); // shown, never sent
    expect(t.created).toHaveLength(0); // and no group
  });

  it('leaves reply unset when the node has no farewell', async () => {
    const t = makeEngine({});
    const rec = await t.engine.simulate(
      {
        id: 'f1',
        graph: graph({ humanAgentId: 'ha1' }),
        organizationId: 'org1',
      },
      CTX,
      t.manager as never,
    );
    expect(rec.outcome).toBe('handed_off');
    expect(rec.reply).toBeUndefined();
  });
});
