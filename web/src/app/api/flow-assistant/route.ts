import { auth } from "@/auth";
import {
  validateDraft,
  type DraftGraph,
} from "@/app/dashboard/flows/assistant";
import { NODE_ICONS, type FlowRefs } from "@/app/dashboard/flows/flow-defs";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";

const MAX_ATTEMPTS = 3;
const NODE_TYPES = Object.keys(NODE_ICONS) as [string, ...string[]];

// Closed shape (no open records): OpenAI strict structured outputs reject
// objects with free-form properties, and require every key to appear in
// `required` — so fields are `.nullable()`, never `.optional()`/`.nullish()`.
// Unused fields come back null and are stripped before validation.
const nodeDataSchema = z.object({
  keywords: z.array(z.string()).nullable(),
  agentId: z.string().nullable(),
  intents: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        description: z.string().nullable(),
      }),
    )
    .nullable(),
  question: z.string().nullable(),
  cases: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        keywords: z.array(z.string()),
      }),
    )
    .nullable(),
  humanAgentId: z.string().nullable(),
  humanAgentIds: z.array(z.string()).nullable(),
  webhookId: z.string().nullable(),
  tagId: z.string().nullable(),
  userId: z.string().nullable(),
  groupPrefix: z.string().nullable(),
  farewellText: z.string().nullable(),
  showLeadName: z.boolean().nullable(),
  copyHistory: z.boolean().nullable(),
  note: z.string().nullable(),
});

const graphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(NODE_TYPES),
      data: nodeDataSchema,
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      sourceHandle: z.string().nullable(),
      target: z.string(),
    }),
  ),
});

/** Drop nullish data fields so node.data matches what the editor stores. */
function cleanGraph(g: z.infer<typeof graphSchema>): DraftGraph {
  return {
    nodes: g.nodes.map((n) => ({
      id: n.id,
      type: n.type as DraftGraph["nodes"][number]["type"],
      data: Object.fromEntries(
        Object.entries(n.data)
          .filter(([, v]) => v != null)
          .map(([k, v]) =>
            (k === "intents" || k === "cases") && Array.isArray(v)
              ? [
                  k,
                  v.map((i) =>
                    Object.fromEntries(
                      Object.entries(i as object).filter(
                        ([, iv]) => iv != null,
                      ),
                    ),
                  ),
                ]
              : [k, v],
          ),
      ),
    })),
    edges: g.edges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
    })),
  };
}

/** The graph DSL, as prose the model can follow. */
function systemPrompt(refs: FlowRefs, locale: string): string {
  const list = (rows: { id: string }[], label: (r: never) => string) =>
    rows.length
      ? rows.map((r) => `  - ${r.id}: ${label(r as never)}`).join("\n")
      : "  (none available — do not use nodes that need these)";
  return `You design conversation-routing graphs ("flows") for whathooks, a WhatsApp automation tool. From the user's description, produce ONE valid graph.

NODE TYPES (type → data fields → output handles):
- trigger → {} → "out". Exactly one, with id "trigger". Every graph starts here.
- keyword → { keywords: string[] } → "yes", "no". Case/accent-insensitive contains-match on the inbound message.
- keywordCases → { cases: [{ key, label, keywords: string[] }] } → one handle per case key, plus "fallback". Several keyword lists, each with its own branch; the FIRST case that matches wins. Use this instead of chaining keyword nodes when a message should route three or more ways on wording alone. Keys are short lowercase slugs; "fallback" is reserved.
- aiDecision → { agentId, question } → "yes", "no". An AI agent answers ONE yes/no question about the conversation. Use it for judgements no keyword list can make ("is the customer angry?", "did they already pay?"). An unclear answer takes "no", so wire the safer outcome there.
- intent → { agentId, intents: [{ key, label, description? }] } → one handle per intent key, plus "fallback". Keys are short lowercase slugs; "fallback" is reserved.
- agentReply → { agentId } → optional "onHandoff". The AI agent answers; the walk ends after replying. Connect "onHandoff" to route the conversation when the agent decides a human is needed.
- assignHuman → { humanAgentId, groupPrefix?, farewellText?, copyHistory? } → terminal. Creates a WhatsApp mirror group with that human.
- roundRobin → { humanAgentIds: string[], same options } → terminal. Rotates leads across humans, one group per lead.
- assignGroup → { humanAgentIds: string[], same options } → terminal. One shared group with every listed human.
- webhook → { webhookId, note? } → "out". Notifies an external system, then continues.
- tagConversation → { tagId } → "out". Tags the conversation, then continues.
- assignTeammate → { userId } → "out". Assigns the conversation in the inbox, then continues.
- saveContact → {} → "out". Saves the sender to the contact book, then continues.

RULES:
- Only use ids listed below. Never invent ids. If the user asks for a tag,
  webhook, agent or human that has no matching reference, use the closest
  existing one; if the category is empty, skip that node and keep the rest
  of the chain connected.
- Keep it focused: 3–8 nodes beyond the trigger is ideal.
- Set copyHistory: true on assign nodes when the human would benefit from context.
- All user-facing text (keywords, intent labels, farewellText) must be written in locale "${locale}".
- Node ids: short lowercase slugs (e.g. "kw_precio", "ai_ventas").
- Leave unused data fields null.

COMMON PATTERNS:
- Routing on wording alone with 3+ destinations: ONE keywordCases node, not a
  chain of keyword nodes. Wire "fallback" so unmatched messages still go
  somewhere.
- keyword vs keywordCases vs intent vs aiDecision: keyword for a single
  yes/no on wording, keywordCases for many wordings to many branches, intent
  when the AI must categorise, aiDecision when the AI must judge one
  yes/no question.
- "AI answers unless X": keyword → "no" → agentReply; "yes" → the exception.
- Branch on intent AND reply: the intent node only CLASSIFIES (it never
  replies). Put it before the actions: route each intent key to its chain
  (e.g. tagConversation → roundRobin) and route "fallback" to an agentReply
  so unmatched messages still get an answer.
- agentReply cannot branch. Its only optional output is "onHandoff"; never
  draw any other handle from it.

AVAILABLE REFERENCES:
AI agents (agentId):
${list(refs.agents, (a: { name: string }) => a.name)}
Human agents (humanAgentId / humanAgentIds):
${list(refs.humanAgents, (h: { name: string }) => h.name)}
Webhooks (webhookId):
${list(refs.webhooks, (w: { url: string }) => w.url)}
Tags (tagId):
${list(refs.tags, (t: { name: string }) => t.name)}
Team members (userId):
${list(refs.members, (m: { name: string }) => m.name)}`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = (await req.json()) as {
    prompt?: string;
    references?: FlowRefs;
    locale?: string;
  };
  const prompt = body.prompt?.trim();
  const refs = body.references;
  if (!prompt || prompt.length > 1000 || !refs) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = openai(process.env.FLOW_ASSISTANT_MODEL ?? "gpt-5.6-luna");
  const system = systemPrompt(refs, body.locale ?? "es");

  let feedback = "";
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const { object } = await generateObject({
        model,
        schema: graphSchema,
        system,
        prompt: feedback ? `${prompt}\n\n${feedback}` : prompt,
      });
      const graph = cleanGraph(object);
      const errors = validateDraft(graph, refs);
      if (errors.length === 0) {
        return NextResponse.json(graph);
      }
      lastErrors = errors;
      feedback =
        "Your previous graph had these problems. Fix ALL of them:\n" +
        errors.map((e) => `- ${e}`).join("\n");
    } catch (e) {
      // Surface the real failure in the function logs; a schema/model
      // error here has nothing to do with the user's prompt.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[flow-assistant] attempt ${attempt + 1} failed:`, msg);
      lastErrors = [`model_error: ${msg.slice(0, 300)}`];
    }
  }
  console.error("[flow-assistant] generation failed:", lastErrors);
  return NextResponse.json(
    { error: "generation_failed", issues: lastErrors },
    { status: 422 },
  );
}
