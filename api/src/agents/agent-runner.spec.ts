import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import {
  extractAnthropicReply,
  extractOpenAIResponsesReply,
} from './agent-runner.service';

type Item = OpenAI.Responses.ResponseOutputItem;

const message = (text: string): Item => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});

const call = (name: string, args: string): Item => ({
  id: 'fc_1',
  type: 'function_call',
  call_id: 'call_1',
  name,
  arguments: args,
});

/**
 * The Responses API returns a list of typed items rather than one message;
 * the reply we send is whatever text they carry, plus the two tool signals
 * the rest of the app understands. Server-side MCP items must be invisible.
 */
describe('extractOpenAIResponsesReply', () => {
  it('joins the text of message items', () => {
    const out = extractOpenAIResponsesReply([
      message('Hello, '),
      message('how can I help?'),
    ]);
    expect(out).toEqual({
      text: 'Hello, how can I help?',
      handoff: false,
      reason: undefined,
      notify: null,
    });
  });

  it('ignores the server-side MCP rounds', () => {
    // A tool listing and a tool call happened at OpenAI; the model already
    // folded the result into its text, so neither leaks into the reply.
    const out = extractOpenAIResponsesReply([
      {
        id: 'mcpl_1',
        type: 'mcp_list_tools',
        server_label: 'crm',
        tools: [],
      },
      {
        id: 'mcp_1',
        type: 'mcp_call',
        server_label: 'crm',
        name: 'lookup',
        arguments: '{}',
        output: '{"owner":"Ana"}',
      },
      message('Your rep is Ana.'),
    ]);
    expect(out.text).toBe('Your rep is Ana.');
    expect(out.handoff).toBe(false);
  });

  it('reads the handoff and notify tool calls', () => {
    const out = extractOpenAIResponsesReply([
      call('handoff_to_human', '{"reason":"wants a refund"}'),
      call('notify_owner', '{"message":"  refund request  "}'),
    ]);
    expect(out).toEqual({
      text: null,
      handoff: true,
      reason: 'wants a refund',
      notify: 'refund request',
    });
  });

  it('collects send_media calls in order, dropping ones without an id', () => {
    const out = extractOpenAIResponsesReply([
      message('Te paso el catálogo y la lista.'),
      call('send_media', '{"item_id":"cat","caption":" Catálogo 2026 "}'),
      call('send_media', '{"caption":"no id"}'),
      call('send_media', '{"item_id":"precios"}'),
    ]);
    expect(out.text).toBe('Te paso el catálogo y la lista.');
    expect(out.media).toEqual([
      { itemId: 'cat', caption: 'Catálogo 2026' },
      { itemId: 'precios', caption: null },
    ]);
  });

  it('survives malformed tool arguments', () => {
    const out = extractOpenAIResponsesReply([
      call('handoff_to_human', '{not json'),
    ]);
    expect(out.handoff).toBe(true);
    expect(out.reason).toBeUndefined();
  });

  it('returns null text for an empty reply', () => {
    expect(extractOpenAIResponsesReply([message('   ')]).text).toBeNull();
  });
});

describe('extractAnthropicReply', () => {
  const text = (t: string): Anthropic.ContentBlock => ({
    type: 'text',
    text: t,
    citations: null,
  });
  // The SDK's ToolUseBlock carries provider bookkeeping fields the extractor
  // never reads; the cast keeps the fixture to what matters.
  const use = (name: string, input: unknown): Anthropic.ContentBlock =>
    ({ type: 'tool_use', id: 'tu_1', name, input }) as Anthropic.ContentBlock;

  it('reads text plus the three tool signals', () => {
    const out = extractAnthropicReply([
      text('Acá tenés el catálogo.'),
      use('send_media', { item_id: 'cat', caption: '' }),
      use('notify_owner', { message: 'Pidió el catálogo' }),
      use('handoff_to_human', { reason: 'quiere hablar con alguien' }),
    ]);
    expect(out).toEqual({
      text: 'Acá tenés el catálogo.',
      handoff: true,
      reason: 'quiere hablar con alguien',
      notify: 'Pidió el catálogo',
      media: [{ itemId: 'cat', caption: null }],
    });
  });

  it('ignores tools it does not know and non-object input', () => {
    const out = extractAnthropicReply([
      use('something_else', { x: 1 }),
      use('send_media', 'not an object'),
      text('ok'),
    ]);
    expect(out).toEqual({
      text: 'ok',
      handoff: false,
      reason: undefined,
      notify: null,
    });
  });
});
