import { Channel } from '@prisma/client';
import { validateGraph, type FlowGraphRefs } from './flow-graph';

/**
 * Refusing a flow whose nodes its channel cannot run.
 *
 * The failure this prevents is not an exception, it is silence followed by an
 * exception at the worst moment: a flow with a group handoff, enabled on an
 * Instagram session, in an org with no WhatsApp number, throws mid-conversation
 * with a customer waiting. Every check here moves that to configuration time.
 */
const BASE: FlowGraphRefs = {
  agentIds: new Set(['a1']),
  humanAgentIds: new Set(['h1']),
  webhookIds: new Set(),
  tagIds: new Set(),
  memberIds: new Set(),
};

/** trigger → assignHuman, the shape that needs a group. */
const handoffGraph = {
  nodes: [
    { id: 'n1', type: 'trigger', data: {} },
    { id: 'n2', type: 'assignHuman', data: { humanAgentId: 'h1' } },
  ],
  edges: [{ source: 'n1', target: 'n2' }],
};

/** trigger → agentReply, which any channel can run. */
const replyGraph = {
  nodes: [
    { id: 'n1', type: 'trigger', data: {} },
    { id: 'n2', type: 'agentReply', data: { agentId: 'a1' } },
  ],
  edges: [{ source: 'n1', target: 'n2' }],
};

const codes = (refs: FlowGraphRefs, graph: unknown) =>
  validateGraph(graph, refs).map((e) => e.code);

describe('channel capability validation', () => {
  it('refuses a group handoff on Instagram with no WhatsApp number', () => {
    expect(
      codes(
        { ...BASE, channel: Channel.INSTAGRAM, hasWhatsappNumber: false },
        handoffGraph,
      ),
    ).toContain('nodeNeedsWhatsapp');
  });

  it('allows it once a WhatsApp number exists to host the group', () => {
    // The group is hosted on the WhatsApp number; the lead stays on Instagram.
    expect(
      codes(
        { ...BASE, channel: Channel.INSTAGRAM, hasWhatsappNumber: true },
        handoffGraph,
      ),
    ).not.toContain('nodeNeedsWhatsapp');
  });

  it('never blocks a WhatsApp flow, which hosts its own groups', () => {
    expect(
      codes(
        { ...BASE, channel: Channel.WHATSAPP, hasWhatsappNumber: true },
        handoffGraph,
      ),
    ).not.toContain('nodeNeedsWhatsapp');
  });

  it('leaves nodes that need no group alone', () => {
    expect(
      codes(
        { ...BASE, channel: Channel.INSTAGRAM, hasWhatsappNumber: false },
        replyGraph,
      ),
    ).not.toContain('nodeNeedsWhatsapp');
  });

  it('skips the check for a detached draft', () => {
    // No session yet means no channel to judge against, and refusing here
    // would stop someone building a flow before attaching it to anything.
    expect(codes(BASE, handoffGraph)).not.toContain('nodeNeedsWhatsapp');
  });

  it('reports the offending node so the editor can point at it', () => {
    const errors = validateGraph(handoffGraph, {
      ...BASE,
      channel: Channel.INSTAGRAM,
      hasWhatsappNumber: false,
    });
    const err = errors.find((e) => e.code === 'nodeNeedsWhatsapp');
    expect(err?.nodeId).toBe('n2');
    expect(err?.message).toMatch(/WhatsApp number/);
  });
});
