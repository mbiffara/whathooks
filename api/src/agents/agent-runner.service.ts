import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Agent } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';

const HISTORY_LIMIT = 20;

type Turn = { role: 'user' | 'assistant'; text: string };

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
  ): Promise<string | null> {
    if (!this.encryption.isConfigured()) return null;

    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(agent.apiKeyCiphertext);
    } catch (e) {
      this.log.error(`Agent "${agent.name}": could not decrypt API key: ${e}`);
      return null;
    }

    const turns = await this.loadHistory(conversationId);
    if (!turns.length) return null;

    const system = buildSystemPrompt(agent);
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
  private async loadHistory(conversationId: string): Promise<Turn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
      select: { direction: true, text: true, type: true },
    });
    rows.reverse();

    const turns: Turn[] = [];
    for (const m of rows) {
      const text = m.text ?? mediaPlaceholder(m.type);
      if (!text) continue;
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
  ): Promise<string | null> {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: agent.model,
      max_tokens: agent.maxTokens,
      system,
      messages: turns.map((t) => ({ role: t.role, content: t.text })),
    });
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return reply || null;
  }

  private async replyOpenAI(
    agent: Agent,
    apiKey: string,
    system: string,
    turns: Turn[],
  ): Promise<string | null> {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: agent.model,
      messages: [
        { role: 'system', content: system },
        ...turns.map((t) => ({ role: t.role, content: t.text }) as const),
      ],
    });
    const reply = response.choices[0]?.message?.content?.trim();
    return reply || null;
  }
}

function buildSystemPrompt(agent: Agent): string {
  return [
    `You are ${agent.name}, an assistant replying to messages on WhatsApp.`,
    '',
    '# Your character',
    agent.soul,
    '',
    '# Instructions',
    agent.instructions,
    '',
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
