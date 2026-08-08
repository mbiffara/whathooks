import { FlowNodeType, FlowRefs, handlesFor, NODE_ICONS } from "./flow-defs";

/** Graph draft as the model emits it — no positions, those are ours. */
export interface DraftNode {
  id: string;
  type: FlowNodeType;
  data: Record<string, unknown>;
}
export interface DraftEdge {
  id?: string;
  source: string;
  sourceHandle: string | null;
  target: string;
}
export interface DraftGraph {
  nodes: DraftNode[];
  edges: DraftEdge[];
}

const NODE_TYPES = Object.keys(NODE_ICONS) as FlowNodeType[];

/**
 * Light structural validation for AI-drafted graphs — enough to drive the
 * model's retry loop. The API's validateGraph still runs at save time.
 * Returns English error strings (they are fed back to the model).
 */
export function validateDraft(graph: DraftGraph, refs: FlowRefs): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const byId = new Map<string, DraftNode>();

  for (const n of graph.nodes) {
    if (!n.id) errors.push("Every node needs an id");
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
    byId.set(n.id, n);
    if (!NODE_TYPES.includes(n.type)) {
      errors.push(`Node "${n.id}": unknown type "${String(n.type)}"`);
      continue;
    }
    const d = n.data ?? {};
    const inRefs = (list: { id: string }[], id: unknown) =>
      typeof id === "string" && list.some((x) => x.id === id);
    switch (n.type) {
      case "keyword": {
        const kw = d.keywords;
        if (!Array.isArray(kw) || kw.length === 0) {
          errors.push(`Node "${n.id}": keywords must be a non-empty array`);
        }
        break;
      }
      case "keywordCases": {
        const cases = d.cases;
        if (!Array.isArray(cases) || cases.length === 0) {
          errors.push(`Node "${n.id}": define at least one case`);
          break;
        }
        for (const c of cases as { key?: string; keywords?: unknown }[]) {
          if (!c?.key || c.key === "fallback") {
            errors.push(
              `Node "${n.id}": every case needs a key, and "fallback" is reserved`,
            );
          }
          if (!Array.isArray(c?.keywords) || c.keywords.length === 0) {
            errors.push(`Node "${n.id}": case "${c?.key}" needs keywords`);
          }
        }
        break;
      }
      case "aiDecision":
        // agentId is optional: empty runs on the org's included tokens.
        if (d.agentId && !inRefs(refs.agents, d.agentId)) {
          errors.push(
            `Node "${n.id}": agentId must be one of the provided AI agent ids`,
          );
        }
        if (typeof d.question !== "string" || !d.question.trim()) {
          errors.push(`Node "${n.id}": write the yes/no question`);
        }
        break;
      case "intent":
        // agentId is optional here too.
        if (d.agentId && !inRefs(refs.agents, d.agentId)) {
          errors.push(
            `Node "${n.id}": agentId must be one of the provided AI agent ids`,
          );
        }
        if (!Array.isArray(d.intents) || d.intents.length === 0) {
          errors.push(`Node "${n.id}": define at least one intent`);
        }
        break;
      case "agentReply":
        if (!inRefs(refs.agents, d.agentId)) {
          errors.push(
            `Node "${n.id}": agentId must be one of the provided AI agent ids`,
          );
        }
        break;
      case "assignHuman":
        if (!inRefs(refs.humanAgents, d.humanAgentId)) {
          errors.push(
            `Node "${n.id}": humanAgentId must be one of the provided human agent ids`,
          );
        }
        break;
      case "roundRobin":
      case "assignGroup": {
        const list = d.humanAgentIds;
        if (
          !Array.isArray(list) ||
          list.length === 0 ||
          !list.every((x) => inRefs(refs.humanAgents, x))
        ) {
          errors.push(
            `Node "${n.id}": humanAgentIds must be provided human agent ids`,
          );
        }
        break;
      }
      case "webhook":
        if (!inRefs(refs.webhooks, d.webhookId)) {
          errors.push(
            `Node "${n.id}": webhookId must be one of the provided webhook ids`,
          );
        }
        break;
      case "tagConversation":
        if (!inRefs(refs.tags, d.tagId)) {
          errors.push(
            `Node "${n.id}": tagId must be one of the provided tag ids`,
          );
        }
        break;
      case "assignTeammate":
        if (!inRefs(refs.members, d.userId)) {
          errors.push(
            `Node "${n.id}": userId must be one of the provided member ids`,
          );
        }
        break;
      default:
        break;
    }
  }

  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) {
    errors.push("The graph needs exactly one trigger node");
  }

  const seen = new Set<string>();
  for (const e of graph.edges) {
    const src = byId.get(e.source);
    if (!src) errors.push(`Edge from unknown node "${e.source}"`);
    if (!byId.has(e.target)) errors.push(`Edge to unknown node "${e.target}"`);
    if (!src) continue;
    const handle = e.sourceHandle ?? "out";
    const allowed = handlesFor(src.type, src.data ?? {});
    if (allowed.length === 0) {
      errors.push(`Node "${e.source}" (${src.type}) cannot have outputs`);
      continue;
    }
    if (!allowed.includes(handle)) {
      errors.push(
        `Node "${e.source}": output "${handle}" is not one of ${allowed.join(", ")}`,
      );
    }
    const key = `${e.source}::${handle}`;
    if (seen.has(key)) {
      errors.push(`Node "${e.source}": two edges leave output "${handle}"`);
    }
    seen.add(key);
  }

  return errors;
}

/**
 * Layered left-to-right auto-layout: columns by BFS depth from the trigger,
 * rows stacked within each column. The model never emits coordinates.
 */
export function layoutDraft(
  graph: DraftGraph,
): Array<DraftNode & { position: { x: number; y: number } }> {
  const depth = new Map<string, number>();
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const queue: string[] = trigger ? [trigger.id] : [];
  if (trigger) depth.set(trigger.id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const e of graph.edges) {
      if (e.source === id && !depth.has(e.target)) {
        depth.set(e.target, d + 1);
        queue.push(e.target);
      }
    }
  }
  const rows = new Map<number, number>();
  return graph.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    return { ...n, position: { x: 80 + d * 300, y: 80 + row * 150 } };
  });
}
