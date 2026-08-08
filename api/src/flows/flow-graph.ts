/**
 * Flow graph types + validation, shared by the CRUD API (save-time checks)
 * and the runtime engine. The graph is stored exactly as the ReactFlow
 * editor produces it: { nodes: [{id,type,position,data}], edges: [...] }.
 */

export const FLOW_NODE_TYPES = [
  'trigger',
  'keyword',
  'keywordCases',
  'intent',
  'aiDecision',
  'agentReply',
  'assignHuman',
  'roundRobin',
  'webhook',
  'tagConversation',
  'assignTeammate',
  'saveContact',
  'assignGroup',
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

/** Node types that end the walk (no outgoing edges allowed). */
export const TERMINAL_TYPES: FlowNodeType[] = [
  'assignHuman',
  'roundRobin',
  'assignGroup',
];

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

/** One branch of a keywordCases node: its own keyword list and output. */
export interface FlowKeywordCase {
  key: string;
  label: string;
  keywords: string[];
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

/** Optional field: absent or empty means "use the default" — always valid. */
function isOptStr(v: unknown, max: number): boolean {
  return v === undefined || v === null || v === '' || isStr(v, max);
}

/**
 * One validation finding. `code` + `params` let the web app render the
 * error in the user's language; `message` is the English fallback shown
 * to raw API consumers (and for codes a stale client doesn't know).
 */
export interface GraphError {
  code: string;
  nodeId?: string;
  params?: Record<string, string | number>;
  message: string;
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

/** The branches configured on a keywordCases node (typed accessor). */
export function casesOf(node: FlowNode): FlowKeywordCase[] {
  return Array.isArray(node.data.cases)
    ? (node.data.cases as FlowKeywordCase[])
    : [];
}

/** The intents configured on an intent node (typed accessor). */
export function intentsOf(node: FlowNode): FlowIntent[] {
  return Array.isArray(node.data.intents)
    ? (node.data.intents as FlowIntent[])
    : [];
}

/**
 * Validate a graph against structural rules and org-owned references.
 * Empty array = valid.
 */
export function validateGraph(
  graph: unknown,
  refs: FlowGraphRefs,
): GraphError[] {
  const errors: GraphError[] = [];
  const push = (
    code: string,
    message: string,
    nodeId?: string,
    params?: Record<string, string | number>,
  ) => errors.push({ code, message, nodeId, params });
  const g = graph as FlowGraph;
  if (
    !g ||
    typeof g !== 'object' ||
    !Array.isArray(g.nodes) ||
    !Array.isArray(g.edges)
  ) {
    push('graphShape', 'Graph must be an object with nodes[] and edges[]');
    return errors;
  }
  if (g.nodes.length === 0) {
    push('graphEmpty', 'Graph has no nodes');
    return errors;
  }
  if (g.nodes.length > MAX_NODES) {
    push('graphTooBig', `Graph exceeds ${MAX_NODES} nodes`, undefined, {
      max: MAX_NODES,
    });
    return errors;
  }

  const ids = new Set<string>();
  const byId = new Map<string, FlowNode>();
  for (const n of g.nodes) {
    if (!n || typeof n.id !== 'string' || !n.id) {
      push('nodeIdMissing', 'Every node needs a string id');
      continue;
    }
    if (ids.has(n.id)) {
      push('nodeIdDupe', `Duplicate node id "${n.id}"`, n.id, { id: n.id });
    }
    ids.add(n.id);
    byId.set(n.id, n);
    if (!FLOW_NODE_TYPES.includes(n.type)) {
      push(
        'nodeUnknownType',
        `Node "${n.id}": unknown type "${String(n.type)}"`,
        n.id,
        { type: String(n.type) },
      );
      continue;
    }
    if (
      !n.position ||
      typeof n.position.x !== 'number' ||
      typeof n.position.y !== 'number'
    ) {
      push('nodePosition', `Node "${n.id}": missing position`, n.id);
    }
    const d = n.data ?? {};
    switch (n.type) {
      case 'trigger':
      case 'saveContact': // no configuration
        break;
      case 'keyword': {
        const kw = d.keywords;
        if (
          !Array.isArray(kw) ||
          kw.length === 0 ||
          kw.length > 20 ||
          !kw.every((k) => isStr(k, 80))
        ) {
          push(
            'keywordList',
            `Node "${n.id}": keywords must be 1–20 short strings`,
            n.id,
          );
        }
        break;
      }
      case 'keywordCases': {
        const cases = d.cases;
        if (!Array.isArray(cases) || cases.length === 0 || cases.length > 10) {
          push('caseCount', `Node "${n.id}": define 1–10 cases`, n.id);
          break;
        }
        const caseKeys = new Set<string>();
        for (const c of cases as FlowKeywordCase[]) {
          if (!c || !INTENT_KEY.test(c.key ?? '')) {
            push(
              'caseKeySlug',
              `Node "${n.id}": case keys must be short lowercase slugs`,
              n.id,
            );
          } else if (caseKeys.has(c.key)) {
            push(
              'caseKeyDupe',
              `Node "${n.id}": duplicate case key "${c.key}"`,
              n.id,
              { key: c.key },
            );
          } else if (c.key === 'fallback') {
            push(
              'caseKeyReserved',
              `Node "${n.id}": "fallback" is a reserved case key`,
              n.id,
            );
          } else {
            caseKeys.add(c.key);
          }
          if (!isStr(c.label, 80)) {
            push('caseLabel', `Node "${n.id}": every case needs a label`, n.id);
          }
          const kw = c?.keywords;
          if (
            !Array.isArray(kw) ||
            kw.length === 0 ||
            kw.length > 20 ||
            !kw.every((k) => isStr(k, 80))
          ) {
            push(
              'caseKeywords',
              `Node "${n.id}": every case needs 1–20 keywords`,
              n.id,
            );
          }
        }
        break;
      }
      case 'aiDecision': {
        // No agent = run on the org's included tokens. Only a *wrong* id is
        // an error; an empty one is the default.
        if (d.agentId && !refs.agentIds.has(d.agentId as string)) {
          push(
            'decisionAgent',
            `Node "${n.id}": that AI agent no longer exists`,
            n.id,
          );
        }
        if (!isStr(d.question, 500)) {
          push(
            'decisionQuestion',
            `Node "${n.id}": write the yes/no question the agent answers`,
            n.id,
          );
        }
        break;
      }
      case 'intent': {
        // Same as aiDecision: empty means included tokens.
        if (d.agentId && !refs.agentIds.has(d.agentId as string)) {
          push(
            'intentAgent',
            `Node "${n.id}": that AI agent no longer exists`,
            n.id,
          );
        }
        const intents = d.intents;
        if (
          !Array.isArray(intents) ||
          intents.length === 0 ||
          intents.length > 8
        ) {
          push('intentCount', `Node "${n.id}": define 1–8 intents`, n.id);
          break;
        }
        const keys = new Set<string>();
        for (const it of intents as FlowIntent[]) {
          if (!it || !INTENT_KEY.test(it.key ?? '')) {
            push(
              'intentKeySlug',
              `Node "${n.id}": intent keys must be short lowercase slugs`,
              n.id,
            );
          } else if (keys.has(it.key)) {
            push(
              'intentKeyDupe',
              `Node "${n.id}": duplicate intent key "${it.key}"`,
              n.id,
              { key: it.key },
            );
          } else if (it.key === 'fallback') {
            push(
              'intentKeyReserved',
              `Node "${n.id}": "fallback" is a reserved intent key`,
              n.id,
            );
          } else {
            keys.add(it.key);
          }
          if (!isStr(it.label, 80)) {
            push(
              'intentLabel',
              `Node "${n.id}": every intent needs a label`,
              n.id,
            );
          }
        }
        break;
      }
      case 'agentReply':
        if (!isStr(d.agentId, 64) || !refs.agentIds.has(d.agentId)) {
          push('agentMissing', `Node "${n.id}": pick an AI agent`, n.id);
        }
        break;
      case 'assignHuman':
        if (
          !isStr(d.humanAgentId, 64) ||
          !refs.humanAgentIds.has(d.humanAgentId)
        ) {
          push('humanMissing', `Node "${n.id}": pick a human agent`, n.id);
        }
        break;
      case 'roundRobin':
      case 'assignGroup': {
        const list = d.humanAgentIds;
        if (
          !Array.isArray(list) ||
          list.length === 0 ||
          list.length > 10 ||
          !list.every((x) => typeof x === 'string' && refs.humanAgentIds.has(x))
        ) {
          push(
            'roundRobinAgents',
            `Node "${n.id}": pick 1–10 human agents`,
            n.id,
          );
        }
        break;
      }
      case 'webhook':
        if (!isStr(d.webhookId, 64) || !refs.webhookIds.has(d.webhookId)) {
          push('webhookMissing', `Node "${n.id}": pick a webhook`, n.id);
        }
        break;
      case 'tagConversation':
        if (!isStr(d.tagId, 64) || !refs.tagIds.has(d.tagId)) {
          push('tagMissing', `Node "${n.id}": pick a tag`, n.id);
        }
        break;
      case 'assignTeammate':
        if (!isStr(d.userId, 64) || !refs.memberIds.has(d.userId)) {
          push('teammateMissing', `Node "${n.id}": pick a team member`, n.id);
        }
        break;
    }
    // Shared optional fields on assign nodes: empty means "use the default".
    if (
      n.type === 'assignHuman' ||
      n.type === 'roundRobin' ||
      n.type === 'assignGroup'
    ) {
      if (!isOptStr(d.groupPrefix, 40)) {
        push(
          'groupPrefixLength',
          `Node "${n.id}": group prefix can have up to 40 characters`,
          n.id,
          { max: 40 },
        );
      }
      if (!isOptStr(d.farewellText, 500)) {
        push(
          'farewellTooLong',
          `Node "${n.id}": farewell text too long (max 500)`,
          n.id,
          { max: 500 },
        );
      }
    }
  }

  const triggers = g.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) {
    push('triggerCount', 'The graph needs exactly one trigger node');
  }

  const seenHandles = new Set<string>();
  for (const e of g.edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') {
      push('edgeShape', 'Every edge needs source and target');
      continue;
    }
    const src = byId.get(e.source);
    if (!src) {
      push(
        'edgeUnknownSource',
        `Edge from unknown node "${e.source}"`,
        undefined,
        { id: e.source },
      );
    }
    if (!byId.has(e.target)) {
      push(
        'edgeUnknownTarget',
        `Edge to unknown node "${e.target}"`,
        undefined,
        { id: e.target },
      );
    }
    if (!src) continue;
    const handle = e.sourceHandle ?? 'out';
    const dupeKey = `${e.source}::${handle}`;
    if (seenHandles.has(dupeKey)) {
      push(
        'edgeDupeHandle',
        `Node "${e.source}": two edges leave the same output "${handle}"`,
        e.source,
        { handle },
      );
    }
    seenHandles.add(dupeKey);
    if (TERMINAL_TYPES.includes(src.type)) {
      push(
        'edgeFromTerminal',
        `Node "${e.source}" (${src.type}) cannot have outputs`,
        e.source,
        { type: src.type },
      );
      continue;
    }
    const allowed = allowedHandles(src);
    if (!allowed.includes(handle)) {
      push(
        'edgeBadHandle',
        `Node "${e.source}": output "${handle}" is not one of ${allowed.join(', ')}`,
        e.source,
        { handle, allowed: allowed.join(', ') },
      );
    }
  }

  return errors;
}

/** Legal source-handle names per node. */
export function allowedHandles(node: FlowNode): string[] {
  switch (node.type) {
    case 'keyword':
    case 'aiDecision':
      return ['yes', 'no'];
    case 'keywordCases':
      return [...casesOf(node).map((c) => c.key), 'fallback'];
    case 'intent':
      return [...intentsOf(node).map((i) => i.key), 'fallback'];
    case 'agentReply':
      return ['onHandoff'];
    case 'trigger':
    case 'webhook':
    case 'tagConversation':
    case 'assignTeammate':
    case 'saveContact':
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
