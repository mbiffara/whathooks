import type OpenAI from 'openai';
import { extractOpenAIResponsesReply } from './agent-runner.service';

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
