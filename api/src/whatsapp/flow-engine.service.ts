import { Injectable, Logger } from '@nestjs/common';
import { MessageSource } from '@prisma/client';
import { AgentRunnerService } from '../agents/agent-runner.service';
import {
  FlowGraph,
  FlowNode,
  edgeFrom,
  intentsOf,
} from '../flows/flow-graph';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import type {
  ConnectionManagerService,
  InboundAutomationCtx,
} from './connection-manager.service';

/** Cached per-session flow lookup (mirror-link cache pattern). */
interface CachedFlow {
  flow: { id: string; graph: FlowGraph } | null;
  expires: number;
}

const MAX_STEPS = 20;
const DEFAULT_GROUP_PREFIX = '🔒 Lead';

/**
 * Runtime for Flows: walks a session's graph for each inbound DM. The
 * connection manager passes itself in (send/mirror/agent primitives) so
 * there is no DI cycle — this service only depends on data + integrations.
 */
@Injectable()
export class FlowEngineService {
  private readonly log = new Logger(FlowEngineService.name);
  private readonly cache = new Map<string, CachedFlow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
    private readonly webhooks: WebhookDispatchService,
  ) {}

  /** The session's enabled flow, cached ~30s (checked on every DM). */
  async enabledFlowFor(
    sessionId: string,
  ): Promise<{ id: string; graph: FlowGraph } | null> {
    const cached = this.cache.get(sessionId);
    if (cached && cached.expires > Date.now()) return cached.flow;
    const row = await this.prisma.flow.findUnique({
      where: { sessionId },
      select: { id: true, graph: true, enabled: true },
    });
    const flow = row?.enabled
      ? { id: row.id, graph: row.graph as unknown as FlowGraph }
      : null;
    this.cache.set(sessionId, { flow, expires: Date.now() + 30_000 });
    return flow;
  }

  /** Drop a session's cache entry (called on flow save/toggle). */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Walk the graph for one inbound DM. Never throws into the caller. */
  async run(
    flow: { id: string; graph: FlowGraph },
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
  ): Promise<void> {
    try {
      // Safety: a handed-off conversation is owned by its human agent.
      const state = await this.prisma.flowConversationState.findUnique({
        where: { conversationId: ctx.conversationId },
      });
      if (state?.status === 'HANDED_OFF') return;

      const graph = flow.graph;
      const trigger = graph.nodes.find((n) => n.type === 'trigger');
      if (!trigger) return;

      let current: FlowNode | undefined = this.follow(graph, trigger, 'out');
      let steps = 0;
      while (current && steps < MAX_STEPS) {
        steps++;
        const node: FlowNode = current;
        current = await this.execute(flow, sessionId, ctx, manager, node);
      }
      if (steps >= MAX_STEPS) {
        this.log.warn(`Flow ${flow.id}: step limit reached (cycle?)`);
      }
    } catch (e) {
      this.log.warn(`Flow ${flow.id} failed on ${sessionId}: ${e}`);
    }
  }

  /** Execute one node; returns the next node (undefined = stop). */
  private async execute(
    flow: { id: string; graph: FlowGraph },
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
    node: FlowNode,
  ): Promise<FlowNode | undefined> {
    const graph = flow.graph;
    switch (node.type) {
      case 'keyword': {
        const keywords = (node.data.keywords as string[]) ?? [];
        const haystack = normalize(ctx.text ?? '');
        const hit = keywords.some((k) => haystack.includes(normalize(k)));
        return this.follow(graph, node, hit ? 'yes' : 'no');
      }

      case 'intent': {
        const agent = await this.prisma.agent.findUnique({
          where: { id: node.data.agentId as string },
        });
        const intents = intentsOf(node);
        const key = agent
          ? await this.agentRunner.classify(agent, ctx.conversationId, intents)
          : null;
        const branch = key && intents.some((i) => i.key === key) ? key : null;
        const next = branch ? this.follow(graph, node, branch) : undefined;
        return next ?? this.follow(graph, node, 'fallback');
      }

      case 'agentReply': {
        const handoffEdge = edgeFrom(graph, node.id, 'onHandoff');
        const outcome = await manager.runAgentReply(
          sessionId,
          ctx.conversationId,
          ctx.remoteJid,
          node.data.agentId as string,
          { pauseOnHandoff: !handoffEdge },
        );
        if (outcome === 'handoff' && handoffEdge) {
          return graph.nodes.find((n) => n.id === handoffEdge.target);
        }
        return undefined; // terminal after replying (or skipping)
      }

      case 'assignHuman': {
        await this.assign(flow, sessionId, ctx, manager, node, [
          node.data.humanAgentId as string,
        ]);
        return undefined;
      }

      case 'roundRobin': {
        const list = (node.data.humanAgentIds as string[]) ?? [];
        await this.assign(flow, sessionId, ctx, manager, node, list);
        return undefined;
      }

      case 'webhook': {
        await this.webhooks
          .dispatchTo(node.data.webhookId as string, 'flow.action', {
            note: (node.data.note as string) ?? null,
            nodeId: node.id,
            flowId: flow.id,
            conversationId: ctx.conversationId,
            from: ctx.remoteJid,
            pushName: ctx.pushName,
            text: ctx.text,
            sessionId,
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: webhook node failed: ${e}`),
          );
        return this.follow(graph, node, 'out');
      }

      case 'tagConversation': {
        await this.prisma.conversation
          .update({
            where: { id: ctx.conversationId },
            data: { tags: { connect: { id: node.data.tagId as string } } },
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: tag node failed: ${e}`),
          );
        return this.follow(graph, node, 'out');
      }

      case 'assignTeammate': {
        await this.prisma.conversation
          .update({
            where: { id: ctx.conversationId },
            data: { assignedToUserId: node.data.userId as string },
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: assignTeammate node failed: ${e}`),
          );
        return this.follow(graph, node, 'out');
      }

      default:
        return undefined;
    }
  }

  /** Hand the conversation to a human agent through the mirror machinery. */
  private async assign(
    flow: { id: string },
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
    node: FlowNode,
    candidateIds: string[],
  ): Promise<void> {
    if (candidateIds.length === 0) return;
    let chosenId = candidateIds[0];
    if (candidateIds.length > 1) {
      const counter = await this.prisma.flowCounter.upsert({
        where: { flowId_nodeId: { flowId: flow.id, nodeId: node.id } },
        create: { flowId: flow.id, nodeId: node.id, value: 1 },
        update: { value: { increment: 1 } },
      });
      chosenId = candidateIds[(counter.value - 1) % candidateIds.length];
    }
    const human = await this.prisma.humanAgent.findUnique({
      where: { id: chosenId },
    });
    if (!human) {
      this.log.warn(`Flow ${flow.id}: human agent ${chosenId} missing`);
      return;
    }
    const thread = await manager.createMirrorThread(
      sessionId,
      ctx.remoteJid,
      { id: human.id, number: human.phoneNumber },
      {
        prefix: (node.data.groupPrefix as string) || DEFAULT_GROUP_PREFIX,
        showLeadName: (node.data.showLeadName as boolean) ?? true,
      },
    );
    await manager.forwardLeadToGroup(sessionId, thread, ctx);
    const farewell = (node.data.farewellText as string) ?? '';
    if (farewell.trim()) {
      await manager.sendText(sessionId, ctx.remoteJid, farewell.trim(), {
        source: MessageSource.API,
      });
    }
    await this.prisma.flowConversationState.upsert({
      where: { conversationId: ctx.conversationId },
      create: {
        flowId: flow.id,
        conversationId: ctx.conversationId,
        status: 'HANDED_OFF',
        humanAgentId: human.id,
      },
      update: { status: 'HANDED_OFF', humanAgentId: human.id },
    });
    this.log.log(
      `Flow ${flow.id}: handed ${ctx.conversationId} to ${human.name}`,
    );
  }

  private follow(
    graph: FlowGraph,
    node: FlowNode,
    handle: string,
  ): FlowNode | undefined {
    const edge = edgeFrom(graph, node.id, handle);
    if (!edge) return undefined;
    return graph.nodes.find((n) => n.id === edge.target);
  }
}

/** Lowercase + strip diacritics so "camión" matches "camion". */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
