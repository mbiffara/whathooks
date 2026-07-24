import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';
import { AgentMcpServer, isAgentMcpServers } from './mcp-servers';

const HISTORY_LIMIT = 20;
// MCP tool rounds run server-side at Anthropic; when a turn pauses at the
// server-side iteration limit we resume it, but never indefinitely.
const MAX_PAUSE_CONTINUATIONS = 4;
const MCP_BETA = 'mcp-client-2025-11-20';

type Turn = { role: 'user' | 'assistant'; text: string };

/** Outcome of a run: a reply to send (if any) and whether the agent handed off. */
export interface AgentReply {
  text: string | null;
  handoff: boolean;
  reason?: string;
  /** notify_owner tool call: message for the owner's email (null = not called). */
  notify?: string | null;
}

// A tool the agent may call to pause itself on a conversation (handoff to human).
const HANDOFF_TOOL = 'handoff_to_human';
const HANDOFF_DESCRIPTION =
  'Pause yourself on this conversation and hand it off to a human operator. ' +
  'Call this when you are unsure how to help, the request is out of scope, or ' +
  'the user explicitly asks for a human. After calling it you will stop ' +
  'replying until an operator resumes you.';
const HANDOFF_SCHEMA = {
  type: 'object' as const,
  properties: {
    reason: {
      type: 'string',
      description: 'Short note for the operator on why you handed off.',
    },
  },
};

// Always-available tool: email the business owner about this conversation.
// Deliberately NOT mentioned in the base prompt — the agent only reaches for
// it when the operator's own instructions tell it to (e.g. "when someone asks
// for a quote, use notify_owner"). Does not pause the agent.
const NOTIFY_TOOL = 'notify_owner';
const NOTIFY_DESCRIPTION =
  'Send an email notification to the business owner about this conversation. ' +
  'Only use it when your instructions tell you to. It does not pause you — ' +
  'you can keep replying normally.';
const NOTIFY_SCHEMA = {
  type: 'object' as const,
  properties: {
    message: {
      type: 'string',
      description:
        'What to tell the owner — include the relevant details from the conversation.',
    },
  },
  required: ['message'],
};

/**
 * Runs an AI agent: builds a system prompt from the agent's soul + instructions,
 * feeds the recent conversation as history, and returns the reply text. Each
 * agent carries its own provider (Anthropic/OpenAI), model, and encrypted API
 * key. Has no dependency on the connection manager (which calls this) — the
 * caller sends the resulting text, so there's no circular dependency.
 */
@Injectable()
export class AgentRunnerService {
  private readonly log = new Logger(AgentRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /** Agents can only run if we can decrypt their stored API keys. */
  isConfigured(): boolean {
    return this.encryption.isConfigured();
  }

  /** Generate a reply for the latest message in a conversation, or null. */
  async generateReply(
    agent: Agent,
    conversationId: string,
  ): Promise<AgentReply | null> {
    if (!this.encryption.isConfigured()) return null;

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(agent.apiKeyCiphertext);
    } catch (e) {
      this.log.error(`Agent "${agent.name}": could not decrypt API key: ${e}`);
      return null;
    }

    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isGroup: true },
    });
    const turns = await this.loadHistory(
      conversationId,
      convo?.isGroup ?? false,
    );
    if (!turns.length) return null;

    const knowledge = await this.prisma.agentKnowledgeDoc.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'asc' },
      select: { fileName: true, text: true },
    });
    const system = buildSystemPrompt(
      agent,
      convo?.isGroup ?? false,
      agent.allowAutoStop,
      knowledge,
    );
    try {
      if (agent.provider === 'OPENAI') {
        return await this.replyOpenAI(agent, apiKey, system, turns);
      }
      return await this.replyAnthropic(agent, apiKey, system, turns);
    } catch (e) {
      this.log.error(`Agent "${agent.name}" reply failed: ${e}`);
      return null;
    }
  }

  /** Recent messages, chronological, starting from the first inbound turn. */
  private async loadHistory(
    conversationId: string,
    isGroup: boolean,
  ): Promise<Turn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
      select: { direction: true, text: true, type: true, senderName: true },
    });
    rows.reverse();

    const turns: Turn[] = [];
    for (const m of rows) {
      let text = m.text ?? mediaPlaceholder(m.type);
      if (!text) continue;
      // In a group multiple people talk, so label who said what.
      if (isGroup && m.direction === 'INBOUND' && m.senderName) {
        text = `${m.senderName}: ${text}`;
      }
      turns.push({
        role: m.direction === 'INBOUND' ? 'user' : 'assistant',
        text,
      });
    }
    // The conversation must open with a user turn for the Messages API.
    const firstUser = turns.findIndex((t) => t.role === 'user');
    return firstUser < 0 ? [] : turns.slice(firstUser);
  }

  private async replyAnthropic(
    agent: Agent,
    apiKey: string,
    system: string,
    turns: Turn[],
  ): Promise<AgentReply> {
    const client = new Anthropic({ apiKey });
    const mcpServers = isAgentMcpServers(agent.mcpServers)
      ? agent.mcpServers
      : [];
    if (mcpServers.length > 0) {
      return this.replyAnthropicMcp(agent, client, system, turns, mcpServers);
    }

    const tools: Anthropic.Tool[] = [
      ...(agent.allowAutoStop
        ? [
            {
              name: HANDOFF_TOOL,
              description: HANDOFF_DESCRIPTION,
              input_schema: HANDOFF_SCHEMA,
            },
          ]
        : []),
      {
        name: NOTIFY_TOOL,
        description: NOTIFY_DESCRIPTION,
        input_schema: NOTIFY_SCHEMA,
      },
    ];
    const response = await client.messages.create({
      model: agent.model,
      max_tokens: agent.maxTokens,
      system: cachedSystem(system),
      messages: turns.map((t) => ({ role: t.role, content: t.text })),
      ...(tools.length ? { tools } : {}),
    });
    return extractAnthropicReply(response.content);
  }

  /**
   * Anthropic reply via the MCP connector: the API connects to the agent's
   * MCP servers from Anthropic's infrastructure and runs tool calls
   * server-side — we still make (almost) one request. The server-side loop
   * can stop at its iteration limit with `pause_turn`; we resume by
   * re-sending with the paused assistant turn appended.
   */
  private async replyAnthropicMcp(
    agent: Agent,
    client: Anthropic,
    system: string,
    turns: Turn[],
    mcpServers: AgentMcpServer[],
  ): Promise<AgentReply> {
    const servers = mcpServers.map((s) => ({
      type: 'url' as const,
      url: s.url,
      name: s.name,
      ...(s.authTokenCiphertext
        ? {
            authorization_token: this.encryption.decrypt(s.authTokenCiphertext),
          }
        : {}),
    }));
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...mcpServers.map((s) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: s.name,
      })),
      ...(agent.allowAutoStop
        ? [
            {
              name: HANDOFF_TOOL,
              description: HANDOFF_DESCRIPTION,
              input_schema: HANDOFF_SCHEMA,
            },
          ]
        : []),
      {
        name: NOTIFY_TOOL,
        description: NOTIFY_DESCRIPTION,
        input_schema: NOTIFY_SCHEMA,
      },
    ];

    const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({
      role: t.role,
      content: t.text,
    }));
    let response = await client.beta.messages.create({
      model: agent.model,
      max_tokens: agent.maxTokens,
      system: cachedSystem(system),
      messages,
      betas: [MCP_BETA],
      mcp_servers: servers,
      tools,
    });
    // Resume server-side tool loops that hit the iteration limit.
    for (
      let i = 0;
      response.stop_reason === 'pause_turn' && i < MAX_PAUSE_CONTINUATIONS;
      i++
    ) {
      messages.push({ role: 'assistant', content: response.content });
      response = await client.beta.messages.create({
        model: agent.model,
        max_tokens: agent.maxTokens,
        system: cachedSystem(system),
        messages,
        betas: [MCP_BETA],
        mcp_servers: servers,
        tools,
      });
    }
    return extractAnthropicReply(response.content);
  }

  private async replyOpenAI(
    agent: Agent,
    apiKey: string,
    system: string,
    turns: Turn[],
  ): Promise<AgentReply> {
    const client = new OpenAI({ apiKey });
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      ...(agent.allowAutoStop
        ? [
            {
              type: 'function' as const,
              function: {
                name: HANDOFF_TOOL,
                description: HANDOFF_DESCRIPTION,
                parameters: HANDOFF_SCHEMA,
              },
            },
          ]
        : []),
      {
        type: 'function' as const,
        function: {
          name: NOTIFY_TOOL,
          description: NOTIFY_DESCRIPTION,
          parameters: NOTIFY_SCHEMA,
        },
      },
    ];
    const response = await client.chat.completions.create({
      model: agent.model,
      messages: [
        { role: 'system', content: system },
        ...turns.map((t) => ({ role: t.role, content: t.text }) as const),
      ],
      ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    });

    const message = response.choices[0]?.message;
    let handoff = false;
    let reason: string | undefined;
    let notify: string | null = null;
    for (const call of message?.tool_calls ?? []) {
      if (call.type !== 'function') continue;
      let args: { reason?: string; message?: string } = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        /* ignore malformed args */
      }
      if (call.function.name === HANDOFF_TOOL) {
        handoff = true;
        reason = args.reason;
      } else if (call.function.name === NOTIFY_TOOL) {
        notify = args.message?.trim() || null;
      }
    }
    return { text: message?.content?.trim() || null, handoff, reason, notify };
  }
}

/** Pull the reply text + handoff signal out of Anthropic content blocks. */
function extractAnthropicReply(
  content: Array<Anthropic.ContentBlock | Anthropic.Beta.BetaContentBlock>,
): AgentReply {
  let text = '';
  let handoff = false;
  let reason: string | undefined;
  let notify: string | null = null;
  for (const block of content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use' && block.name === HANDOFF_TOOL) {
      handoff = true;
      reason = (block.input as { reason?: string })?.reason;
    } else if (block.type === 'tool_use' && block.name === NOTIFY_TOOL) {
      notify = (block.input as { message?: string })?.message?.trim() || null;
    }
    // mcp_tool_use / mcp_tool_result blocks are the server-side tool calls —
    // nothing to do client-side; the model folds results into its text.
  }
  return { text: text.trim() || null, handoff, reason, notify };
}

/**
 * System prompt as a cacheable block: with knowledge docs injected the prompt
 * can be large, and it's identical across replies — provider-side prompt
 * caching makes repeat replies cheap. Below the cacheable minimum the marker
 * is ignored, so this is safe for small prompts too.
 */
function cachedSystem(
  system: string,
): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> {
  return [
    { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
  ];
}

/**
 * Today's date in the agent's timezone (falls back to UTC on a bad tz).
 * Date-only on purpose: the system prompt is cached, and clock time would
 * bust the cache on every reply — a date busts it once a day.
 */
function todayIn(timezone: string): string {
  const opts = { dateStyle: 'full' as const };
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...opts,
      timeZone: timezone || 'UTC',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      ...opts,
      timeZone: 'UTC',
    }).format(new Date());
  }
}

function buildSystemPrompt(
  agent: Agent,
  isGroup: boolean,
  allowAutoStop: boolean,
  knowledge: Array<{ fileName: string; text: string }> = [],
): string {
  return [
    `You are ${agent.name}, an assistant replying to messages on WhatsApp.`,
    `Today's date is ${todayIn(agent.scheduleTimezone)}.`,
    '',
    '# Your character',
    agent.soul,
    '',
    '# Instructions',
    agent.instructions,
    '',
    ...(knowledge.length
      ? [
          '# Knowledge base',
          'Reference documents provided by your operator. Ground your answers',
          'in them when relevant; if something is not covered, say you are not',
          'sure instead of inventing an answer.',
          '',
          ...knowledge.flatMap((d) => [`## ${d.fileName}`, d.text, '']),
        ]
      : []),
    ...(isGroup
      ? [
          '# Group chat',
          'You are in a group with several participants. Each incoming message is',
          'prefixed with the sender’s name. You were @mentioned, so reply to the',
          'person who summoned you. Do NOT prefix your reply with your own name.',
          '',
        ]
      : []),
    ...(allowAutoStop
      ? [
          '# Handing off',
          `If you don't know how to help, the request is outside your scope, or the`,
          'user needs a human, call the handoff_to_human tool to pause yourself on',
          'this conversation. Prefer handing off over guessing or making things up.',
          'You may send a brief message (e.g. letting them know a human will follow',
          'up) together with the tool call, or hand off silently.',
          '',
        ]
      : []),
    'Reply with ONLY the message to send back over WhatsApp — no preamble, no',
    'quotation marks, no meta-commentary, and no explanation of your reasoning.',
    'Keep replies concise and conversational, suitable for a chat message.',
  ].join('\n');
}

function mediaPlaceholder(type: string): string | null {
  switch (type) {
    case 'IMAGE':
      return '[the contact sent an image]';
    case 'VIDEO':
      return '[the contact sent a video]';
    case 'AUDIO':
      return '[the contact sent a voice message]';
    case 'DOCUMENT':
      return '[the contact sent a document]';
    case 'STICKER':
      return '[the contact sent a sticker]';
    case 'LOCATION':
      return '[the contact shared a location]';
    case 'CONTACT':
      return '[the contact shared a contact card]';
    default:
      return null;
  }
}
