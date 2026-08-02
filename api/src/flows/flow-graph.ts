/**
 * Flow graph types + validation, shared by the CRUD API (save-time checks)
 * and the runtime engine. The graph is stored exactly as the ReactFlow
 * editor produces it: { nodes: [{id,type,position,data}], edges: [...] }.
 */

export const FLOW_NODE_TYPES = [
  'trigger',
  'keyword',
  'intent',
  'agentReply',
  'assignHuman',
  'roundRobin',
  'webhook',
  'tagConversation',
  'assignTeammate',
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

/** Node types that end the walk (no outgoing edges allowed). */
export const TERMINAL_TYPES: FlowNodeType[] = ['assignHuman', 'roundRobin'];

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowIntent {
  key: string;
  label: string;
  description?: string;
}

/** Org-owned ids the graph is allowed to reference. */
export interface FlowGraphRefs {
  agentIds: Set<string>;
  humanAgentIds: Set<string>;
  webhookIds: Set<string>;
  tagIds: Set<string>;
  memberIds: Set<string>;
}

const MAX_NODES = 50;
const INTENT_KEY = /^[a-z0-9_-]{1,24}$/;

function isStr(v: unknown, max = 200): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** A minimal default graph for newly created flows. */
export function defaultGraph(): FlowGraph {
  return {
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 80, y: 120 },
        data: {},
      },
    ],
    edges: [],
  };
}

/** The intents configured on an intent node (typed accessor). */
export function intentsOf(node: FlowNode): FlowIntent[] {
  return Array.isArray(node.data.intents)
    ? (node.data.intents as FlowIntent[])
    : [];
}

/**
 * Validate a graph against structural rules and org-owned references.
 * Returns human-readable errors; empty array = valid.
 */
export function validateGraph(
  graph: unknown,
  refs: FlowGraphRefs,
): string[] {
  const errors: string[] = [];
  const g = graph as FlowGraph;
  if (
    !g ||
    typeof g !== 'object' ||
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges)
  ) {
    return ['Graph must be an object with nodes[] and edges[]'];
  }
  if (g.nodes.length === 0) return ['Graph has no nodes'];
  if (g.nodes.length > MAX_NODES) {
    return [`Graph exceeds ${MAX_NODES} nodes`];
  }

  const ids = new Set<string>();
  const byId = new Map<string, FlowNode>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) {
      errors.push('Every node needs a string id');
      continue;
    }
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
    byId.set(n.id, n);
    if (!FLOW_NODE_TYPES.includes(n.type)) {
      errors.push(`Node "${n.id}": unknown type "${String(n.type)}"`);
      continue;
    }
    if (
      !n.position ||
      typeof n.position.x !== 'number' ||
      typeof n.position.y !== 'number'
    ) {
      errors.push(`Node "${n.id}": missing position`);
    }
    const d = n.data ?? {};
    switch (n.type) {
      case 'trigger':
        break;
      case 'keyword': {
        const kw = d.keywords;
        if (
          !Array.isArray(kw) ||
          kw.length === 0 ||
          kw.length > 20 ||
          !kw.every((k) => isStr(k, 80))
        ) {
          errors.push(`Node "${n.id}": keywords must be 1–20 short strings`);
        }
        break;
      }
      case 'intent': {
        if (!isStr(d.agentId, 64) || !refs.agentIds.has(d.agentId as string)) {
          errors.push(`Node "${n.id}": pick an AI agent for classification`);
        }
        const intents = d.intents;
        if (
          !Array.isArray(intents) ||
          intents.length === 0 ||
          intents.length > 8
        ) {
          errors.push(`Node "${n.id}": define 1–8 intents`);
          break;
        }
        const keys = new Set<string>();
        for (const it of intents as FlowIntent[]) {
          if (!it || !INTENT_KEY.test(it.key ?? '')) {
            errors.push(
              `Node "${n.id}": intent keys must be short lowercase slugs`,
            );
          } else if (keys.has(it.key)) {
            errors.push(`Node "${n.id}": duplicate intent key "${it.key}"`);
          } else if (it.key === 'fallback') {
            errors.push(`Node "${n.id}": "fallback" is a reserved intent key`);
          } else {
            keys.add(it.key);
          }
          if (!isStr(it.label, 80)) {
            errors.push(`Node "${n.id}": every intent needs a label`);
          }
        }
        break;
      }
      case 'agentReply':
        if (!isStr(d.agentId, 64) || !refs.agentIds.has(d.agentId as string)) {
          errors.push(`Node "${n.id}": pick an AI agent`);
        }
        break;
      case 'assignHuman':
        if (
          !isStr(d.humanAgentId, 64) ||
          !refs.humanAgentIds.has(d.humanAgentId as string)
        ) {
          errors.push(`Node "${n.id}": pick a human agent`);
        }
        break;
      case 'roundRobin': {
        const list = d.humanAgentIds;
        if (
          !Array.isArray(list) ||
          list.length === 0 ||
          list.length > 10 ||
          !list.every(
            (x) => typeof x === 'string' && refs.humanAgentIds.has(x),
          )
        ) {
          errors.push(`Node "${n.id}": pick 1–10 human agents`);
        }
        break;
      }
      case 'webhook':
        if (
          !isStr(d.webhookId, 64) ||
          !refs.webhookIds.has(d.webhookId as string)
        ) {
          errors.push(`Node "${n.id}": pick a webhook`);
        }
        break;
      case 'tagConversation':
        if (!isStr(d.tagId, 64) || !refs.tagIds.has(d.tagId as string)) {
          errors.push(`Node "${n.id}": pick a tag`);
        }
        break;
      case 'assignTeammate':
        if (!isStr(d.userId, 64) || !refs.memberIds.has(d.userId as string)) {
          errors.push(`Node "${n.id}": pick a team member`);
        }
        break;
    }
    // Shared optional fields on assign nodes
    if (n.type === 'assignHuman' || n.type === 'roundRobin') {
      if (d.groupPrefix !== undefined && !isStr(d.groupPrefix, 40)) {
        errors.push(`Node "${n.id}": group prefix must be 1–40 characters`);
      }
      if (d.farewellText !== undefined && !isStr(d.farewellText, 500)) {
        errors.push(`Node "${n.id}": farewell text too long (max 500)`);
      }
    }
  }

  const triggers = g.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) {
    errors.push('The graph needs exactly one trigger node');
  }

  const seenHandles = new Set<string>();
  for (const e of g.edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      errors.push('Every edge needs source and target');
      continue;
    }
    const src = byId.get(e.source);
    if (!src) errors.push(`Edge from unknown node "${e.source}"`);
    if (!byId.has(e.target)) errors.push(`Edge to unknown node "${e.target}"`);
    if (!src) continue;
    const handle = e.sourceHandle ?? 'out';
    const dupeKey = `${e.source}::${handle}`;
    if (seenHandles.has(dupeKey)) {
      errors.push(
        `Node "${e.source}": two edges leave the same output "${handle}"`,
      );
    }
    seenHandles.add(dupeKey);
    if (TERMINAL_TYPES.includes(src.type)) {
      errors.push(`Node "${e.source}" (${src.type}) cannot have outputs`);
      continue;
    }
    const allowed = allowedHandles(src);
    if (!allowed.includes(handle)) {
      errors.push(
        `Node "${e.source}": output "${handle}" is not one of ${allowed.join(', ')}`,
      );
    }
  }

  return errors;
}

/** Legal source-handle names per node. */
export function allowedHandles(node: FlowNode): string[] {
  switch (node.type) {
    case 'keyword':
      return ['yes', 'no'];
    case 'intent':
      return [...intentsOf(node).map((i) => i.key), 'fallback'];
    case 'agentReply':
      return ['onHandoff'];
    case 'trigger':
    case 'webhook':
    case 'tagConversation':
    case 'assignTeammate':
      return ['out'];
    default:
      return [];
  }
}

/** The edge leaving `nodeId` through `handle` (normalizing null → "out"). */
export function edgeFrom(
  graph: FlowGraph,
  nodeId: string,
  handle: string,
): FlowEdge | undefined {
  return graph.edges.find(
    (e) => e.source === nodeId && (e.sourceHandle ?? 'out') === handle,
  );
}
