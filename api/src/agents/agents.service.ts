import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Agent, Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AgentProviderName,
  CreateAgentDto,
  DEFAULT_MODEL,
  McpServerDto,
  UpdateAgentDto,
} from './dto/agent.dto';
import { EncryptionService } from './encryption.service';
import {
  AgentMcpServer,
  isAgentMcpServers,
  mcpServersError,
} from './mcp-servers';

/** Plans allowed to attach MCP servers to agents. */
const MCP_PLANS: Plan[] = ['PRO', 'BUSINESS', 'SPONSORED'];

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
    const mcpServers = await this.mcpServersInput(
      organizationId,
      provider,
      dto.mcpServers,
      [],
    );
    const apiKey = dto.apiKey.trim();
    const agent = await this.prisma.agent.create({
      data: {
        mcpServers,
        organizationId,
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        provider,
        model: dto.model?.trim() || DEFAULT_MODEL[provider],
        apiKeyCiphertext: this.encryption.encrypt(apiKey),
        apiKeyHint: this.encryption.hint(apiKey),
        maxTokens: dto.maxTokens ?? 1024,
        allowAutoStop: dto.allowAutoStop ?? false,
        replyDelayMinSeconds: dto.replyDelayMinSeconds ?? 0,
        notifyOnHandoff: dto.notifyOnHandoff ?? false,
        scheduleEnabled: dto.scheduleEnabled ?? false,
        scheduleDays: dto.scheduleDays ?? [],
        scheduleStartMinute: dto.scheduleStartMinute ?? 0,
        scheduleEndMinute: dto.scheduleEndMinute ?? 0,
        scheduleTimezone: dto.scheduleTimezone ?? 'UTC',
        replyDelayMaxSeconds: Math.max(
          dto.replyDelayMinSeconds ?? 0,
          dto.replyDelayMaxSeconds ?? 0,
        ),
        enabled: dto.enabled ?? true,
      },
    });
    return this.toPublic(agent, 0);
  }

  async update(organizationId: string, id: string, dto: UpdateAgentDto) {
    const existing = await this.require(organizationId, id);
    const provider = dto.provider ?? existing.provider;

    const existingServers = isAgentMcpServers(existing.mcpServers)
      ? existing.mcpServers
      : [];
    let mcpServers: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
    if (dto.mcpServers !== undefined) {
      mcpServers = await this.mcpServersInput(
        organizationId,
        provider,
        dto.mcpServers,
        existingServers,
      );
    } else if (provider === 'OPENAI' && existingServers.length > 0) {
      // Switching an MCP-configured agent to OpenAI silently drops the servers
      // (MCP is Anthropic-only) — require the caller to clear them explicitly.
      throw new BadRequestException(
        'This agent has MCP servers, which are only supported on Anthropic. Remove them before switching provider.',
      );
    }

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

    // Normalize the delay window (max ≥ min) when either bound is changing.
    let replyDelayMinSeconds: number | undefined;
    let replyDelayMaxSeconds: number | undefined;
    if (
      dto.replyDelayMinSeconds !== undefined ||
      dto.replyDelayMaxSeconds !== undefined
    ) {
      const min = dto.replyDelayMinSeconds ?? existing.replyDelayMinSeconds;
      const max = dto.replyDelayMaxSeconds ?? existing.replyDelayMaxSeconds;
      replyDelayMinSeconds = min;
      replyDelayMaxSeconds = Math.max(min, max);
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
        allowAutoStop: dto.allowAutoStop,
        replyDelayMinSeconds,
        replyDelayMaxSeconds,
        notifyOnHandoff: dto.notifyOnHandoff,
        scheduleEnabled: dto.scheduleEnabled,
        scheduleDays: dto.scheduleDays,
        scheduleStartMinute: dto.scheduleStartMinute,
        scheduleEndMinute: dto.scheduleEndMinute,
        scheduleTimezone: dto.scheduleTimezone,
        enabled: dto.enabled,
        ...(mcpServers !== undefined ? { mcpServers } : {}),
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

  /**
   * Validate + normalize a submitted MCP server list. Enforces the Anthropic-
   * only and Pro+ gates, encrypts new auth tokens, and carries over the stored
   * token for same-named servers submitted without one.
   */
  private async mcpServersInput(
    organizationId: string,
    provider: AgentProviderName,
    servers: McpServerDto[] | undefined,
    existing: AgentMcpServer[],
  ): Promise<Prisma.InputJsonValue | typeof Prisma.JsonNull> {
    if (!servers || servers.length === 0) return Prisma.JsonNull;

    if (provider !== 'ANTHROPIC') {
      throw new BadRequestException(
        'MCP servers are only supported on Anthropic agents.',
      );
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org || !MCP_PLANS.includes(org.plan)) {
      throw new ForbiddenException(
        'MCP tools require the Pro plan or higher. Upgrade in Billing to use them.',
      );
    }
    const error = mcpServersError(servers);
    if (error) throw new BadRequestException(error);
    this.ensureEncryption();

    const byName = new Map(existing.map((s) => [s.name, s]));
    const stored: AgentMcpServer[] = servers.map((s) => {
      const token = s.authToken?.trim();
      if (token) {
        return {
          name: s.name,
          url: s.url,
          authTokenCiphertext: this.encryption.encrypt(token),
          authTokenHint: this.encryption.hint(token),
        };
      }
      // No token submitted — keep the one already stored under this name.
      const prior = byName.get(s.name);
      return {
        name: s.name,
        url: s.url,
        ...(prior?.authTokenCiphertext
          ? {
              authTokenCiphertext: prior.authTokenCiphertext,
              authTokenHint: prior.authTokenHint,
            }
          : {}),
      };
    });
    return stored as unknown as Prisma.InputJsonValue;
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
      mcpServers: isAgentMcpServers(a.mcpServers)
        ? a.mcpServers.map((s) => ({
            name: s.name,
            url: s.url,
            hasAuth: Boolean(s.authTokenCiphertext),
            authTokenHint: s.authTokenHint ?? null,
          }))
        : [],
      maxTokens: a.maxTokens,
      allowAutoStop: a.allowAutoStop,
      replyDelayMinSeconds: a.replyDelayMinSeconds,
      replyDelayMaxSeconds: a.replyDelayMaxSeconds,
      notifyOnHandoff: a.notifyOnHandoff,
      scheduleEnabled: a.scheduleEnabled,
      scheduleDays: a.scheduleDays,
      scheduleStartMinute: a.scheduleStartMinute,
      scheduleEndMinute: a.scheduleEndMinute,
      scheduleTimezone: a.scheduleTimezone,
      enabled: a.enabled,
      sessionCount,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
