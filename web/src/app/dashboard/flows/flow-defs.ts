/** Shared editor-side definitions for Flow graphs (mirror of the API's). */

export type FlowNodeType =
  | "trigger"
  | "keyword"
  | "intent"
  | "agentReply"
  | "assignHuman"
  | "roundRobin"
  | "webhook"
  | "tagConversation"
  | "assignTeammate";

export interface FlowIntent {
  key: string;
  label: string;
  description?: string;
}

export interface FlowRefs {
  agents: { id: string; name: string; enabled: boolean }[];
  humanAgents: { id: string; name: string; phoneNumber: string }[];
  webhooks: { id: string; url: string; active: boolean }[];
  tags: { id: string; name: string; color: string }[];
  members: { id: string; name: string }[];
}

export const NODE_META: Record<
  FlowNodeType,
  { title: string; icon: string; hint: string }
> = {
  trigger: {
    title: "Message received",
    icon: "⚡",
    hint: "Runs for every DM from a lead that isn't already handed off.",
  },
  keyword: {
    title: "Keyword match",
    icon: "🔎",
    hint: "Routes yes/no on whether the message contains any keyword (accent-insensitive).",
  },
  intent: {
    title: "Classify intent",
    icon: "🧭",
    hint: "An AI agent classifies the conversation into one of your intents.",
  },
  agentReply: {
    title: "AI agent replies",
    icon: "🤖",
    hint: "The chosen AI agent answers. If it hands off and an On-handoff edge exists, the flow continues there.",
  },
  assignHuman: {
    title: "Assign human agent",
    icon: "🧑‍💼",
    hint: "Creates the lead's mirror group with this human agent. Ends the flow.",
  },
  roundRobin: {
    title: "Round-robin assign",
    icon: "🔁",
    hint: "Distributes leads across several human agents, in turns. Ends the flow.",
  },
  webhook: {
    title: "Trigger webhook",
    icon: "🪝",
    hint: "Sends a flow.action event to one of your webhooks, then continues.",
  },
  tagConversation: {
    title: "Tag conversation",
    icon: "🏷️",
    hint: "Adds a tag to the conversation, then continues.",
  },
  assignTeammate: {
    title: "Assign teammate",
    icon: "👤",
    hint: "Assigns the conversation in the shared inbox, then continues.",
  },
};

/** Palette (what can be added — trigger is fixed). */
export const PALETTE: FlowNodeType[] = [
  "keyword",
  "intent",
  "agentReply",
  "assignHuman",
  "roundRobin",
  "webhook",
  "tagConversation",
  "assignTeammate",
];

export function defaultDataFor(type: FlowNodeType): Record<string, unknown> {
  switch (type) {
    case "keyword":
      return { keywords: [] };
    case "intent":
      return { agentId: "", intents: [{ key: "sales", label: "Sales" }] };
    case "agentReply":
      return { agentId: "" };
    case "assignHuman":
      return { humanAgentId: "", groupPrefix: "", farewellText: "" };
    case "roundRobin":
      return { humanAgentIds: [], groupPrefix: "", farewellText: "" };
    case "webhook":
      return { webhookId: "", note: "" };
    case "tagConversation":
      return { tagId: "" };
    case "assignTeammate":
      return { userId: "" };
    default:
      return {};
  }
}

/** Source-handle names a node exposes (order = vertical order on the card). */
export function handlesFor(
  type: FlowNodeType,
  data: Record<string, unknown>,
): string[] {
  switch (type) {
    case "keyword":
      return ["yes", "no"];
    case "intent": {
      const intents = (data.intents as FlowIntent[]) ?? [];
      return [...intents.map((i) => i.key), "fallback"];
    }
    case "agentReply":
      return ["onHandoff"];
    case "trigger":
    case "webhook":
    case "tagConversation":
    case "assignTeammate":
      return ["out"];
    default:
      return []; // terminal
  }
}

/** One-line summary shown on the node card. */
export function summarize(
  type: FlowNodeType,
  data: Record<string, unknown>,
  refs: FlowRefs | null,
): string {
  const name = (list: { id: string; name: string }[] | undefined, id: unknown) =>
    list?.find((x) => x.id === id)?.name ?? "—";
  switch (type) {
    case "keyword": {
      const kw = (data.keywords as string[]) ?? [];
      return kw.length ? kw.slice(0, 3).join(", ") + (kw.length > 3 ? "…" : "") : "no keywords";
    }
    case "intent": {
      const n = ((data.intents as FlowIntent[]) ?? []).length;
      return `${name(refs?.agents, data.agentId)} · ${n} intent${n === 1 ? "" : "s"}`;
    }
    case "agentReply":
      return name(refs?.agents, data.agentId);
    case "assignHuman":
      return name(refs?.humanAgents, data.humanAgentId);
    case "roundRobin": {
      const n = ((data.humanAgentIds as string[]) ?? []).length;
      return `${n} human agent${n === 1 ? "" : "s"}`;
    }
    case "webhook": {
      const url = refs?.webhooks.find((w) => w.id === data.webhookId)?.url;
      return url ? url.replace(/^https?:\/\//, "").slice(0, 30) : "—";
    }
    case "tagConversation":
      return name(refs?.tags, data.tagId);
    case "assignTeammate":
      return name(refs?.members, data.userId);
    default:
      return "";
  }
}
