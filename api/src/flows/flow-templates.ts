import { FlowGraph } from './flow-graph';

/**
 * Starter graphs for new flows. Reference fields are prefilled when the org
 * has an obvious candidate (first enabled AI agent, first human agents) and
 * left empty otherwise — save/enable validation walks the user to fill them.
 */
export const FLOW_TEMPLATES = [
  'blank',
  'ai-until-handoff',
  'intent-routing',
  'round-robin',
  'faq-keyword',
] as const;
export type FlowTemplate = (typeof FLOW_TEMPLATES)[number];

export interface TemplatePrefill {
  agentId: string;
  humanAgentId: string;
  humanAgentIds: string[];
}

export function buildTemplate(
  template: FlowTemplate,
  p: TemplatePrefill,
): FlowGraph {
  const trigger = {
    id: 'trigger',
    type: 'trigger' as const,
    position: { x: 40, y: 200 },
    data: {},
  };
  switch (template) {
    case 'ai-until-handoff':
      return {
        nodes: [
          trigger,
          {
            id: 'reply',
            type: 'agentReply',
            position: { x: 340, y: 200 },
            data: { agentId: p.agentId },
          },
          {
            id: 'assign',
            type: 'assignHuman',
            position: { x: 660, y: 200 },
            data: {
              humanAgentId: p.humanAgentId,
              groupPrefix: '',
              farewellText: '',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'reply' },
          {
            id: 'e2',
            source: 'reply',
            sourceHandle: 'onHandoff',
            target: 'assign',
          },
        ],
      };
    case 'intent-routing':
      return {
        nodes: [
          trigger,
          {
            id: 'intent',
            type: 'intent',
            position: { x: 320, y: 200 },
            data: {
              agentId: p.agentId,
              intents: [
                {
                  key: 'sales',
                  label: 'Wants to buy',
                  description: 'Asking about products, prices or availability',
                },
                {
                  key: 'support',
                  label: 'Needs help',
                  description: 'Problem with an existing order or service',
                },
              ],
            },
          },
          {
            id: 'assign_sales',
            type: 'assignHuman',
            position: { x: 660, y: 80 },
            data: {
              humanAgentId: p.humanAgentId,
              groupPrefix: '',
              farewellText: '',
            },
          },
          {
            id: 'reply_support',
            type: 'agentReply',
            position: { x: 660, y: 220 },
            data: { agentId: p.agentId },
          },
          {
            id: 'reply_fallback',
            type: 'agentReply',
            position: { x: 660, y: 360 },
            data: { agentId: p.agentId },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'intent' },
          {
            id: 'e2',
            source: 'intent',
            sourceHandle: 'sales',
            target: 'assign_sales',
          },
          {
            id: 'e3',
            source: 'intent',
            sourceHandle: 'support',
            target: 'reply_support',
          },
          {
            id: 'e4',
            source: 'intent',
            sourceHandle: 'fallback',
            target: 'reply_fallback',
          },
        ],
      };
    case 'round-robin':
      return {
        nodes: [
          trigger,
          {
            id: 'rr',
            type: 'roundRobin',
            position: { x: 360, y: 200 },
            data: {
              humanAgentIds: p.humanAgentIds,
              groupPrefix: '',
              farewellText: '',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'rr' }],
      };
    case 'faq-keyword':
      return {
        nodes: [
          trigger,
          {
            id: 'kw',
            type: 'keyword',
            position: { x: 320, y: 200 },
            data: { keywords: ['horario', 'precio', 'ubicacion'] },
          },
          {
            id: 'reply',
            type: 'agentReply',
            position: { x: 640, y: 120 },
            data: { agentId: p.agentId },
          },
          {
            id: 'assign',
            type: 'assignHuman',
            position: { x: 640, y: 300 },
            data: {
              humanAgentId: p.humanAgentId,
              groupPrefix: '',
              farewellText: '',
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'kw' },
          { id: 'e2', source: 'kw', sourceHandle: 'yes', target: 'reply' },
          { id: 'e3', source: 'kw', sourceHandle: 'no', target: 'assign' },
        ],
      };
    case 'blank':
    default:
      return { nodes: [trigger], edges: [] };
  }
}
