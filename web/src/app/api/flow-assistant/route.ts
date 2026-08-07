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

const graphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(NODE_TYPES),
      data: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      sourceHandle: z.string().nullable().default(null),
      target: z.string(),
    }),
  ),
});

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
- Only use ids listed below. Never invent ids. If a category is empty, do not use node types that need it.
- Keep it focused: 3–8 nodes beyond the trigger is ideal.
- Set copyHistory: true on assign nodes when the human would benefit from context.
- All user-facing text (keywords, intent labels, farewellText) must be written in locale "${locale}".
- Node ids: short lowercase slugs (e.g. "kw_precio", "ai_ventas").

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
  const model = openai(process.env.FLOW_ASSISTANT_MODEL ?? "gpt-5.4-mini");
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
      const graph = object as DraftGraph;
      const errors = validateDraft(graph, refs);
      if (errors.length === 0) {
        return NextResponse.json(graph);
      }
      lastErrors = errors;
      feedback =
        "Your previous graph had these problems — fix ALL of them:\n" +
        errors.map((e) => `- ${e}`).join("\n");
    } catch {
      lastErrors = ["model_error"];
    }
  }
  return NextResponse.json(
    { error: "generation_failed", issues: lastErrors },
    { status: 422 },
  );
}
