import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Agent, Plan, Prisma } from '@prisma/client';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import {
  AgentProviderName,
  CreateAgentDto,
  DEFAULT_MODEL,
  INCLUDED_AI_MODEL,
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

// Knowledge caps keep the per-reply token cost bounded — every reply carries
// the full knowledge base in the system prompt (cached by the provider).
const KNOWLEDGE_MAX_DOCS = 5;
const KNOWLEDGE_MAX_TOTAL_CHARS = 100_000;
const KNOWLEDGE_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extract plain text from an uploaded knowledge file (pdf, txt, md). */
async function extractText(file: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const lower = file.fileName.toLowerCase();
  const isPdf = file.mimeType === 'application/pdf' || lower.endsWith('.pdf');
  const isText =
    file.mimeType.startsWith('text/') || /\.(txt|md|markdown|csv)$/.test(lower);
  if (isPdf) {
    try {
      const parsed = await pdfParse(file.buffer);
      return normalizeText(parsed.text);
    } catch {
      throw new BadRequestException('Could not read this PDF');
    }
  }
  if (isText) return normalizeText(file.buffer.toString('utf8'));
  throw new BadRequestException(
    'Unsupported file type — upload a PDF, .txt, .md or .csv',
  );
}

/** Collapse extraction artifacts: repeated blank lines, trailing spaces. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    const included = dto.useIncludedAi === true;
    // Included AI is the platform's OpenAI account on one fixed model, so it
    // overrides provider/model rather than trusting whatever was posted.
    const provider: AgentProviderName = included
      ? 'OPENAI'
      : (dto.provider ?? 'ANTHROPIC');
    if (!included && !dto.apiKey?.trim()) {
      throw new BadRequestException(
        'Provide an API key, or use the included AI tokens',
      );
    }
    const mcpServers = await this.mcpServersInput(
      organizationId,
      dto.mcpServers,
      [],
    );
    const apiKey = dto.apiKey?.trim() ?? '';
    const agent = await this.prisma.agent.create({
      data: {
        mcpServers,
        organizationId,
        name: dto.name,
        soul: dto.soul,
        instructions: dto.instructions,
        provider,
        model: included
          ? INCLUDED_AI_MODEL
          : dto.model?.trim() || DEFAULT_MODEL[provider],
        useIncludedAi: included,
        apiKeyCiphertext: included ? null : this.encryption.encrypt(apiKey),
        apiKeyHint: included ? null : this.encryption.hint(apiKey),
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
    const included = dto.useIncludedAi ?? existing.useIncludedAi;
    // Included AI pins the provider and model, so a switch to it overrides
    // whatever else the patch asked for.
    const provider = included ? 'OPENAI' : (dto.provider ?? existing.provider);
    if (!included && !dto.apiKey?.trim() && !existing.apiKeyCiphertext) {
      throw new BadRequestException(
        'Switching off included AI needs an API key of your own',
      );
    }

    const existingServers = isAgentMcpServers(existing.mcpServers)
      ? existing.mcpServers
      : [];
    let mcpServers: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
    if (dto.mcpServers !== undefined) {
      mcpServers = await this.mcpServersInput(
        organizationId,
        dto.mcpServers,
        existingServers,
      );
    }

    // If the provider changed and no explicit model was given, reset to the new
    // provider's default (an Anthropic model can't run on OpenAI, and vice versa).
    let model = dto.model?.trim();
    if (included) {
      model = INCLUDED_AI_MODEL;
    } else if (!model && dto.provider && dto.provider !== existing.provider) {
      model = DEFAULT_MODEL[provider];
    }

    // Turning included AI on clears the stored key; turning it off requires
    // one, checked above.
    let apiKeyCiphertext: string | null | undefined;
    let apiKeyHint: string | null | undefined;
    if (included) {
      apiKeyCiphertext = null;
      apiKeyHint = null;
    } else if (dto.apiKey) {
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
        provider: included ? 'OPENAI' : dto.provider,
        useIncludedAi: dto.useIncludedAi,
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

  // ---- knowledge documents (context injection) ----

  async listKnowledge(organizationId: string, agentId: string) {
    await this.require(organizationId, agentId);
    return this.prisma.agentKnowledgeDoc.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        charCount: true,
        createdAt: true,
      },
    });
  }

  async addKnowledge(
    organizationId: string,
    agentId: string,
    file: { buffer: Buffer; mimeType: string; fileName: string },
  ) {
    await this.require(organizationId, agentId);
    if (file.buffer.length > KNOWLEDGE_MAX_FILE_BYTES) {
      throw new BadRequestException('File is too large (max 10 MB)');
    }
    const existing = await this.prisma.agentKnowledgeDoc.findMany({
      where: { agentId },
      select: { charCount: true },
    });
    if (existing.length >= KNOWLEDGE_MAX_DOCS) {
      throw new BadRequestException(
        `An agent can have at most ${KNOWLEDGE_MAX_DOCS} documents`,
      );
    }

    const text = await extractText(file);
    if (text.length < 20) {
      throw new BadRequestException(
        'No text could be extracted from this file. Scanned (image-only) ' +
          'PDFs are not supported — upload a text PDF, .txt or .md instead.',
      );
    }
    const usedChars = existing.reduce((sum, d) => sum + d.charCount, 0);
    if (usedChars + text.length > KNOWLEDGE_MAX_TOTAL_CHARS) {
      const left = Math.max(0, KNOWLEDGE_MAX_TOTAL_CHARS - usedChars);
      throw new BadRequestException(
        `Knowledge base is full: this document has ${text.length.toLocaleString()} ` +
          `characters but only ${left.toLocaleString()} remain (limit ` +
          `${KNOWLEDGE_MAX_TOTAL_CHARS.toLocaleString()} across all documents)`,
      );
    }

    return this.prisma.agentKnowledgeDoc.create({
      data: {
        organizationId,
        agentId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        charCount: text.length,
        text,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        charCount: true,
        createdAt: true,
      },
    });
  }

  async removeKnowledge(
    organizationId: string,
    agentId: string,
    docId: string,
  ) {
    await this.require(organizationId, agentId);
    const { count } = await this.prisma.agentKnowledgeDoc.deleteMany({
      where: { id: docId, agentId },
    });
    if (!count) throw new NotFoundException('Document not found');
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
    servers: McpServerDto[] | undefined,
    existing: AgentMcpServer[],
  ): Promise<Prisma.InputJsonValue | typeof Prisma.JsonNull> {
    if (!servers || servers.length === 0) return Prisma.JsonNull;

    // Both providers run MCP server-side now (Anthropic's connector, OpenAI's
    // hosted tool), so the only gate left is the plan.
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
      useIncludedAi: a.useIncludedAi,
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
