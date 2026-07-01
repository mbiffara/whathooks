import { Injectable, NotFoundException } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const agents = await this.prisma.agent.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { sessions: true } } },
    });
    return agents.map((a) => this.toPublic(a, a._count.sessions));
  }

  async get(organizationId: string, id: string) {
    const agent = await this.require(organizationId, id);
    const sessionCount = await this.prisma.waSession.count({
      where: { agentId: id },
    });
    return this.toPublic(agent, sessionCount);
  }

  async create(organizationId: string, dto: CreateAgentDto) {
    const agent = await this.prisma.agent.create({
      data: {
        organizationId,
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        model: dto.model ?? 'claude-opus-4-8',
        maxTokens: dto.maxTokens ?? 1024,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toPublic(agent, 0);
  }

  async update(organizationId: string, id: string, dto: UpdateAgentDto) {
    await this.require(organizationId, id);
    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        model: dto.model,
        maxTokens: dto.maxTokens,
        enabled: dto.enabled,
      },
    });
    return this.toPublic(agent, 0);
  }

  async remove(organizationId: string, id: string) {
    await this.require(organizationId, id);
    await this.prisma.agent.delete({ where: { id } });
    return { ok: true };
  }

  /** Assign (or clear, when agentId is null) the agent on a session. */
  async assignToSession(
    organizationId: string,
    sessionId: string,
    agentId: string | null,
  ) {
    const session = await this.prisma.waSession.findFirst({
      where: { id: sessionId, organizationId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (agentId) await this.require(organizationId, agentId);

    await this.prisma.waSession.update({
      where: { id: sessionId },
      data: { agentId: agentId || null },
    });
    return { ok: true, agentId: agentId || null };
  }

  private async require(organizationId: string, id: string): Promise<Agent> {
    const agent = await this.prisma.agent.findFirst({
      where: { id, organizationId },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  private toPublic(a: Agent, sessionCount: number) {
    return {
      id: a.id,
      name: a.name,
      soul: a.soul,
      instructions: a.instructions,
      model: a.model,
      maxTokens: a.maxTokens,
      enabled: a.enabled,
      sessionCount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
