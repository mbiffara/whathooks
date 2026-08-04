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
  | "assignTeammate"
  | "saveContact"
  | "assignGroup";

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

export const NODE_ICONS: Record<FlowNodeType, string> = {
  trigger: "⚡",
  keyword: "🔎",
  intent: "🧭",
  agentReply: "🤖",
  assignHuman: "🧑‍💼",
  roundRobin: "🔁",
  webhook: "🪝",
  tagConversation: "🏷️",
  assignTeammate: "👤",
  saveContact: "📇",
  assignGroup: "👥",
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
  "saveContact",
  "assignGroup",
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
    case "assignGroup":
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
    case "saveContact":
      return ["out"];
    default:
      return []; // terminal
  }
}

/** One-line summary shown on the node card (t = dash.flows translator). */
export function summarize(
  type: FlowNodeType,
  data: Record<string, unknown>,
  refs: FlowRefs | null,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  const name = (list: { id: string; name: string }[] | undefined, id: unknown) =>
    list?.find((x) => x.id === id)?.name ?? "—";
  switch (type) {
    case "keyword": {
      const kw = (data.keywords as string[]) ?? [];
      return kw.length
        ? kw.slice(0, 3).join(", ") + (kw.length > 3 ? "…" : "")
        : t("summaryNoKeywords");
    }
    case "intent": {
      const n = ((data.intents as FlowIntent[]) ?? []).length;
      return `${name(refs?.agents, data.agentId)} · ${t("summaryIntents", { count: n })}`;
    }
    case "agentReply":
      return name(refs?.agents, data.agentId);
    case "assignHuman":
      return name(refs?.humanAgents, data.humanAgentId);
    case "roundRobin":
    case "assignGroup": {
      const n = ((data.humanAgentIds as string[]) ?? []).length;
      return t("summaryHumanAgents", { count: n });
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
