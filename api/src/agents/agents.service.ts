import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Agent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AgentProviderName,
  CreateAgentDto,
  DEFAULT_MODEL,
  UpdateAgentDto,
} from './dto/agent.dto';
import { EncryptionService } from './encryption.service';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

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
    this.ensureEncryption();
    const provider: AgentProviderName = dto.provider ?? 'ANTHROPIC';
    const apiKey = dto.apiKey.trim();
    const agent = await this.prisma.agent.create({
      data: {
        organizationId,
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        provider,
        model: dto.model?.trim() || DEFAULT_MODEL[provider],
        apiKeyCiphertext: this.encryption.encrypt(apiKey),
        apiKeyHint: this.encryption.hint(apiKey),
        maxTokens: dto.maxTokens ?? 1024,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toPublic(agent, 0);
  }

  async update(organizationId: string, id: string, dto: UpdateAgentDto) {
    const existing = await this.require(organizationId, id);
    const provider = dto.provider ?? (existing.provider as AgentProviderName);

    // If the provider changed and no explicit model was given, reset to the new
    // provider's default (an Anthropic model can't run on OpenAI, and vice versa).
    let model = dto.model?.trim();
    if (!model && dto.provider && dto.provider !== existing.provider) {
      model = DEFAULT_MODEL[provider];
    }

    let apiKeyCiphertext: string | undefined;
    let apiKeyHint: string | undefined;
    if (dto.apiKey) {
      this.ensureEncryption();
      const apiKey = dto.apiKey.trim();
      apiKeyCiphertext = this.encryption.encrypt(apiKey);
      apiKeyHint = this.encryption.hint(apiKey);
    }

    const agent = await this.prisma.agent.update({
      where: { id },
      data: {
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        provider: dto.provider,
        model,
        apiKeyCiphertext,
        apiKeyHint,
        maxTokens: dto.maxTokens,
        enabled: dto.enabled,
      },
    });
    const sessionCount = await this.prisma.waSession.count({
      where: { agentId: id },
    });
    return this.toPublic(agent, sessionCount);
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

  private ensureEncryption() {
    if (!this.encryption.isConfigured()) {
      throw new BadRequestException(
        'Agent API-key storage is not configured on the server (AGENT_ENCRYPTION_KEY missing).',
      );
    }
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
      provider: a.provider,
      model: a.model,
      apiKeyHint: a.apiKeyHint, // never the ciphertext or the key itself
      maxTokens: a.maxTokens,
      enabled: a.enabled,
      sessionCount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
