import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuotaService } from '../billing/quota.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';
import { FlowEngineService } from '../whatsapp/flow-engine.service';
import {
  FlowGraph,
  FlowGraphRefs,
  defaultGraph,
  validateGraph,
} from './flow-graph';
import { FlowTemplate, buildTemplate } from './flow-templates';
import type { GraphError } from './flow-graph';

/** Loose shape check for a draft graph posted by the editor. */
function isGraphShape(v: unknown): v is FlowGraph {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as FlowGraph).nodes) &&
    Array.isArray((v as FlowGraph).edges)
  );
}

/**
 * 400 whose body carries the structured findings (`graphErrors`) so the
 * editor can render them in the user's language; `message` stays the
 * joined English text for raw API consumers.
 */
function invalidGraph(errors: GraphError[], prefix = '') {
  const shown = errors.slice(0, 8);
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: prefix + shown.map((e) => e.message).join('; '),
    graphErrors: shown,
  });
}

/** CRUD for Flows. Org-scoped; creation is plan-capped. */
@Injectable()
export class FlowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
    private readonly quota: QuotaService,
    private readonly manager: ConnectionManagerService,
  ) {}

  async list(organizationId: string) {
    const flows = await this.prisma.flow.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: {
        session: {
          select: { id: true, label: true, phoneNumber: true, status: true },
        },
      },
    });
    return flows.map((f) => ({
      id: f.id,
      name: f.name,
      enabled: f.enabled,
      session: f.session,
      nodes: (f.graph as unknown as FlowGraph)?.nodes?.length ?? 0,
      updatedAt: f.updatedAt,
      createdAt: f.createdAt,
    }));
  }

  async create(
    organizationId: string,
    dto: { name: string; template?: FlowTemplate },
  ) {
    await this.quota.assertCanAddFlow(organizationId);
    let graph: FlowGraph;
    if (dto.template && dto.template !== 'blank') {
      // Prefill references where the org has an obvious candidate.
      const refs = await this.references(organizationId);
      graph = buildTemplate(dto.template, {
        agentId:
          refs.agents.find((a) => a.enabled)?.id ?? refs.agents[0]?.id ?? '',
        humanAgentId: refs.humanAgents[0]?.id ?? '',
        humanAgentIds: refs.humanAgents.slice(0, 3).map((h) => h.id),
      });
    } else {
      graph = defaultGraph();
    }
    return this.prisma.flow.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        graph: graph as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Assign (or clear, sessionId=null) the flow's session. A session already
   * attached to another flow requires force=true — the other flow is
   * detached and disabled.
   */
  async assignSession(
    organizationId: string,
    id: string,
    sessionId: string | null,
    force: boolean,
  ) {
    const flow = await this.get(organizationId, id);
    const previousSessionId = flow.sessionId;

    if (sessionId === null) {
      const updated = await this.prisma.flow.update({
        where: { id },
        data: { sessionId: null, enabled: false },
      });
      if (previousSessionId) this.engine.invalidate(previousSessionId);
      return updated;
    }

    const session = await this.prisma.waSession.findFirst({
      where: { id: sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const holder = await this.prisma.flow.findUnique({
      where: { sessionId },
      select: { id: true, name: true },
    });
    if (holder && holder.id !== id) {
      if (!force) {
        throw new ConflictException(`SESSION_TAKEN:${holder.name}`);
      }
      await this.prisma.flow.update({
        where: { id: holder.id },
        data: { sessionId: null, enabled: false },
      });
    }
    const updated = await this.prisma.flow.update({
      where: { id },
      data: { sessionId },
    });
    this.engine.invalidate(sessionId);
    if (previousSessionId) this.engine.invalidate(previousSessionId);
    return updated;
  }

  async get(organizationId: string, id: string) {
    const flow = await this.prisma.flow.findFirst({
      where: { id, organizationId },
      include: {
        session: {
          select: { id: true, label: true, phoneNumber: true, status: true },
        },
      },
    });
    if (!flow) throw new NotFoundException('Flow not found');
    return flow;
  }

  /** Replace the graph (validated against org-owned references). */
  /**
   * Save the graph. A half-built draft is allowed through — editing is
   * iterative and losing work to a validation error is worse than storing
   * something incomplete. The findings come back as `graphErrors` for the
   * editor to show as warnings.
   *
   * An ENABLED flow is different: the engine reads its graph on the next
   * inbound message, so it must stay valid. Enabling already validates
   * (see update), and this keeps that guarantee from being edited away.
   */
  async saveGraph(organizationId: string, id: string, graph: unknown) {
    const flow = await this.get(organizationId, id);
    const refs = await this.refsFor(organizationId);
    const errors = validateGraph(graph, refs);
    if (errors.length > 0 && flow.enabled) {
      throw invalidGraph(errors, 'This flow is live, so it must stay valid: ');
    }
    const updated = await this.prisma.flow.update({
      where: { id },
      data: { graph: graph as Prisma.InputJsonValue },
    });
    if (updated.sessionId) this.engine.invalidate(updated.sessionId);
    return { ...updated, graphErrors: errors };
  }

  async update(
    organizationId: string,
    id: string,
    patch: { name?: string; enabled?: boolean },
  ) {
    const flow = await this.get(organizationId, id);
    if (patch.enabled) {
      if (!flow.sessionId) {
        throw new BadRequestException('Assign a session before enabling');
      }
      // Refuse to enable a graph that no longer validates (refs deleted).
      const errors = validateGraph(
        flow.graph,
        await this.refsFor(organizationId),
      );
      if (errors.length > 0) {
        throw invalidGraph(errors, 'Fix the flow before enabling: ');
      }
    }
    const updated = await this.prisma.flow.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
    if (updated.sessionId) this.engine.invalidate(updated.sessionId);
    return updated;
  }

  /**
   * Dry-run the flow against a pretend CONVERSATION. A flow runs on every
   * inbound message and its AI nodes read the history, so simulating a
   * single message in isolation would misreport exactly the branches worth
   * testing. The caller sends the whole transcript; the last turn must be
   * from the contact and is the message being delivered.
   *
   * Nothing is sent, created or written. The AI nodes do run, so their
   * branch decisions are real.
   */
  async simulate(
    organizationId: string,
    id: string,
    messages: { from: 'contact' | 'business'; text: string }[],
    /**
     * The graph as it currently stands in the editor. Testing the STORED
     * graph silently ran a stale version, so an edit you had not saved yet —
     * the usual reason to hit Test — was invisible.
     */
    draft?: unknown,
  ) {
    const flow = await this.get(organizationId, id);
    const graph = isGraphShape(draft)
      ? draft
      : (flow.graph as unknown as FlowGraph);
    const last = messages.at(-1);
    if (!last || last.from !== 'contact') {
      throw new BadRequestException(
        'The last message must come from the contact',
      );
    }
    // Same shape loadHistory produces from stored rows.
    const history = messages.map((m) => ({
      role: m.from === 'contact' ? ('user' as const) : ('assistant' as const),
      text: m.text,
    }));
    const rec = await this.engine.simulate(
      { id: flow.id, graph, organizationId },
      {
        conversationId: `sim_${flow.id}`,
        remoteJid: 'simulation@s.whatsapp.net',
        isGroup: false,
        mentionedMe: false,
        pushName: 'Simulation',
        type: 'TEXT',
        text: last.text,
      },
      this.manager,
      history,
    );
    return {
      steps: rec.steps,
      outcome: rec.outcome,
      error: rec.error ?? null,
      // What an agentReply node would have sent, so the caller can show it
      // and carry it into the next turn's transcript.
      reply: rec.reply ?? null,
      // Once a flow hands off, the real engine stops running it for that
      // conversation — the caller needs to know to stop too.
      handedOff: rec.outcome === 'handed_off',
    };
  }

  async remove(organizationId: string, id: string) {
    const flow = await this.get(organizationId, id);
    await this.prisma.flow.delete({ where: { id } });
    if (flow.sessionId) this.engine.invalidate(flow.sessionId);
    return { ok: true };
  }

  /** Recent engine executions for one flow (newest first). */
  async listRuns(organizationId: string, id: string, limit = 50) {
    await this.get(organizationId, id);
    return this.prisma.flowRun.findMany({
      where: { flowId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  /** Everything the editor's pickers need, in one call. */
  async references(organizationId: string) {
    const [agents, humanAgents, webhooks, tags, members] = await Promise.all([
      this.prisma.agent.findMany({
        where: { organizationId },
        // allowAutoStop tells the editor whether an onHandoff branch on this
        // agent can ever fire — without it the tool is never offered.
        select: { id: true, name: true, enabled: true, allowAutoStop: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.humanAgent.findMany({
        where: { organizationId },
        select: { id: true, name: true, phoneNumber: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.webhook.findMany({
        where: { organizationId },
        select: { id: true, url: true, active: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tag.findMany({
        where: { organizationId },
        select: { id: true, name: true, color: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.membership.findMany({
        where: { organizationId },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return {
      agents,
      humanAgents,
      webhooks,
      tags,
      members: members.map((m) => ({
        id: m.user.id,
        name: m.user.name ?? m.user.email,
      })),
    };
  }

  private async refsFor(organizationId: string): Promise<FlowGraphRefs> {
    const r = await this.references(organizationId);
    return {
      agentIds: new Set(r.agents.map((a) => a.id)),
      humanAgentIds: new Set(r.humanAgents.map((h) => h.id)),
      webhookIds: new Set(r.webhooks.map((w) => w.id)),
      tagIds: new Set(r.tags.map((t) => t.id)),
      memberIds: new Set(r.members.map((m) => m.id)),
    };
  }
}
