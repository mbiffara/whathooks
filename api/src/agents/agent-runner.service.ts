import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';

const HISTORY_LIMIT = 20;

type Turn = { role: 'user' | 'assistant'; text: string };

/** Outcome of a run: a reply to send (if any) and whether the agent handed off. */
export interface AgentReply {
  text: string | null;
  handoff: boolean;
  reason?: string;
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
    const turns = await this.loadHistory(conversationId, convo?.isGroup ?? false);
    if (!turns.length) return null;

    const system = buildSystemPrompt(agent, convo?.isGroup ?? false, agent.allowAutoStop);
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
    const tools: Anthropic.Tool[] = agent.allowAutoStop
      ? [
          {
            name: HANDOFF_TOOL,
            description: HANDOFF_DESCRIPTION,
            input_schema: HANDOFF_SCHEMA,
          },
        ]
      : [];
    const response = await client.messages.create({
      model: agent.model,
      max_tokens: agent.maxTokens,
      system,
      messages: turns.map((t) => ({ role: t.role, content: t.text })),
      ...(tools.length ? { tools } : {}),
    });

    let text = '';
    let handoff = false;
    let reason: string | undefined;
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use' && block.name === HANDOFF_TOOL) {
        handoff = true;
        reason = (block.input as { reason?: string })?.reason;
      }
    }
    return { text: text.trim() || null, handoff, reason };
  }

  private async replyOpenAI(
    agent: Agent,
    apiKey: string,
    system: string,
    turns: Turn[],
  ): Promise<AgentReply> {
    const client = new OpenAI({ apiKey });
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] =
      agent.allowAutoStop
        ? [
            {
              type: 'function',
              function: {
                name: HANDOFF_TOOL,
                description: HANDOFF_DESCRIPTION,
                parameters: HANDOFF_SCHEMA,
              },
            },
          ]
        : [];
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
    const call = message?.tool_calls?.find(
      (c) => c.type === 'function' && c.function.name === HANDOFF_TOOL,
    );
    if (call && call.type === 'function') {
      handoff = true;
      try {
        reason = (JSON.parse(call.function.arguments || '{}') as { reason?: string })
          .reason;
      } catch {
        /* ignore malformed args */
      }
    }
    return { text: message?.content?.trim() || null, handoff, reason };
  }
}

function buildSystemPrompt(
  agent: Agent,
  isGroup: boolean,
  allowAutoStop: boolean,
): string {
  return [
    `You are ${agent.name}, an assistant replying to messages on WhatsApp.`,
    '',
    '# Your character',
    agent.soul,
    '',
    '# Instructions',
    agent.instructions,
    '',
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
