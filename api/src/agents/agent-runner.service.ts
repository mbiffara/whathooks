import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const HISTORY_LIMIT = 20;

/**
 * Runs an AI agent: builds a system prompt from the agent's soul + instructions,
 * feeds the recent conversation as history, and returns the reply text. Has no
 * dependency on the connection manager (which calls this) — the caller sends the
 * resulting text, so there's no circular dependency.
 */
@Injectable()
export class AgentRunnerService {
  private readonly log = new Logger(AgentRunnerService.name);
  private readonly client?: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    } else {
      this.log.warn('ANTHROPIC_API_KEY not set — agents will not auto-reply');
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  /** Generate a reply for the latest message in a conversation, or null. */
  async generateReply(
    agent: Agent,
    conversationId: string,
  ): Promise<string | null> {
    if (!this.client) return null;

    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_LIMIT,
      select: { direction: true, text: true, type: true },
    });
    rows.reverse(); // chronological

    const messages: Anthropic.MessageParam[] = [];
    for (const m of rows) {
      const text = m.text ?? mediaPlaceholder(m.type);
      if (!text) continue;
      messages.push({
        role: m.direction === 'INBOUND' ? 'user' : 'assistant',
        content: text,
      });
    }
    // The Messages API requires the first turn to be a user message.
    const firstUser = messages.findIndex((m) => m.role === 'user');
    if (firstUser < 0) return null;
    const trimmed = messages.slice(firstUser);

    try {
      const response = await this.client.messages.create({
        model: agent.model,
        max_tokens: agent.maxTokens,
        system: buildSystemPrompt(agent),
        messages: trimmed,
      });
      const reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      return reply || null;
    } catch (e) {
      this.log.error(`Agent "${agent.name}" reply failed: ${e}`);
      return null;
    }
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
