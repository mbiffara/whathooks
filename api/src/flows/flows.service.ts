import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FlowEngineService } from '../whatsapp/flow-engine.service';
import {
  FlowGraph,
  FlowGraphRefs,
  defaultGraph,
  validateGraph,
} from './flow-graph';

/** CRUD for Flows (platform-admin experiment). Org-scoped like the rest. */
@Injectable()
export class FlowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: FlowEngineService,
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

  async create(organizationId: string, dto: { sessionId: string; name: string }) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: dto.sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    const existing = await this.prisma.flow.findUnique({
      where: { sessionId: dto.sessionId },
    });
    if (existing) {
      throw new ConflictException('This session already has a flow');
    }
    return this.prisma.flow.create({
      data: {
        organizationId,
        sessionId: dto.sessionId,
        name: dto.name.trim(),
        graph: defaultGraph() as unknown as Prisma.InputJsonValue,
      },
    });
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
  async saveGraph(organizationId: string, id: string, graph: unknown) {
    await this.get(organizationId, id);
    const refs = await this.refsFor(organizationId);
    const errors = validateGraph(graph, refs);
    if (errors.length > 0) {
      throw new BadRequestException(errors.slice(0, 8).join('; '));
    }
    const updated = await this.prisma.flow.update({
      where: { id },
      data: { graph: graph as Prisma.InputJsonValue },
    });
    this.engine.invalidate(updated.sessionId);
    return updated;
  }

  async update(
    organizationId: string,
    id: string,
    patch: { name?: string; enabled?: boolean },
  ) {
    const flow = await this.get(organizationId, id);
    if (patch.enabled) {
      // Refuse to enable a graph that no longer validates (refs deleted).
      const errors = validateGraph(
        flow.graph,
        await this.refsFor(organizationId),
      );
      if (errors.length > 0) {
        throw new BadRequestException(
          `Fix the flow before enabling: ${errors.slice(0, 5).join('; ')}`,
        );
      }
    }
    const updated = await this.prisma.flow.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
    this.engine.invalidate(updated.sessionId);
    return updated;
  }

  async remove(organizationId: string, id: string) {
    const flow = await this.get(organizationId, id);
    await this.prisma.flow.delete({ where: { id } });
    this.engine.invalidate(flow.sessionId);
    return { ok: true };
  }

  /** Everything the editor's pickers need, in one call. */
  async references(organizationId: string) {
    const [agents, humanAgents, webhooks, tags, members] = await Promise.all([
      this.prisma.agent.findMany({
        where: { organizationId },
        select: { id: true, name: true, enabled: true },
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
