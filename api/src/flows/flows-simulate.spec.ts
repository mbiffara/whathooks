// FlowsService injects the connection manager, which pulls in Baileys' ESM
// build that Jest cannot load. The simulator never touches it here.
jest.mock('../whatsapp/connection-manager.service', () => ({
  ConnectionManagerService: class {},
}));

import { FlowsService } from './flows.service';
import { FlowGraph } from './flow-graph';

/**
 * The simulator used to invent a conversation id, so the read-only nodes that
 * look the conversation up (tagDecision) always saw nothing and reported the
 * branch production would NOT take. These cover which id the dry run gets.
 */

const GRAPH: FlowGraph = {
  nodes: [
    {
      id: 't',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: {},
    },
  ],
  edges: [],
};

function makeService(
  flow: { id: string; sessionId: string | null },
  conversation: { id: string } | null,
) {
  const prisma = {
    flow: { findFirst: jest.fn().mockResolvedValue({ ...flow, graph: GRAPH }) },
    conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
  };
  // What the engine was handed to walk, so the tests can read the ctx back.
  const ctxs: Record<string, unknown>[] = [];
  const engine = {
    simulate: jest.fn((_flow: unknown, ctx: Record<string, unknown>) => {
      ctxs.push(ctx);
      return Promise.resolve({ steps: [], outcome: 'completed', dryRun: true });
    }),
  };
  const service = new FlowsService(
    prisma as never,
    engine as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, ctxs };
}

const MESSAGES = [{ from: 'contact' as const, text: 'hola' }];

describe('FlowsService.simulate conversation resolution', () => {
  it('runs against the real thread when the number has one', async () => {
    const t = makeService({ id: 'f1', sessionId: 's1' }, { id: 'conv1' });
    await t.service.simulate('org1', 'f1', MESSAGES, undefined, '5491111');
    expect(t.prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        sessionId: 's1',
        OR: [
          { remoteJid: '5491111@s.whatsapp.net' },
          { phoneNumber: '5491111' },
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      select: { id: true },
    });
    expect(t.ctxs[0]).toMatchObject({
      conversationId: 'conv1',
      remoteJid: '5491111@s.whatsapp.net',
    });
  });

  it('falls back to a synthetic id when the number has no thread', async () => {
    const t = makeService({ id: 'f1', sessionId: 's1' }, null);
    await t.service.simulate('org1', 'f1', MESSAGES, undefined, '5491111');
    expect(t.ctxs[0]).toMatchObject({
      conversationId: 'sim_f1',
    });
  });

  it('does not look anything up without a number or a session', async () => {
    const t = makeService({ id: 'f1', sessionId: null }, { id: 'conv1' });
    await t.service.simulate('org1', 'f1', MESSAGES);
    expect(t.prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(t.ctxs[0]).toMatchObject({
      conversationId: 'sim_f1',
      remoteJid: 'simulation@s.whatsapp.net',
    });
  });
});
