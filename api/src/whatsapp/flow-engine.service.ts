import { Injectable, Logger } from '@nestjs/common';
import { Agent, MessageSource } from '@prisma/client';
import { AgentRunnerService, Turn } from '../agents/agent-runner.service';
import {
  FlowGraph,
  FlowNode,
  casesOf,
  edgeFrom,
  intentsOf,
} from '../flows/flow-graph';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { agentActiveNow } from './agent-schedule';
import type {
  ConnectionManagerService,
  InboundAutomationCtx,
} from './connection-manager.service';

/** Cached per-session flow lookup (mirror-link cache pattern). */
interface CachedFlow {
  flow: FlowRef | null;
  expires: number;
}

/** A flow as the engine needs it: id, graph, and who pays for AI nodes. */
export interface FlowRef {
  id: string;
  graph: FlowGraph;
  organizationId: string;
}

const MAX_STEPS = 20;
// Messages copied into a fresh mirror group when the assign node asks for it.
const HISTORY_COPY_LIMIT = 25;

interface RunRecorder {
  steps: Array<{ nodeId: string; type: string; note?: string }>;
  outcome: string;
  error?: string;
  /**
   * Simulation: walk the real graph with the real branching, but perform no
   * side effect. Guarded inside execute() rather than in a second walker, so
   * a routing change can never apply to one and not the other.
   */
  dryRun?: boolean;
  /**
   * The pretend conversation so far. A simulation has no stored messages, so
   * without this the AI nodes would see an empty history and always fall
   * through — which is exactly the thing worth testing.
   */
  history?: Turn[];
  /** Simulation: what the agent would have replied, for the caller to show. */
  reply?: string | null;
}
const DEFAULT_GROUP_PREFIX = '🔒 Lead';

/**
 * Runtime for Flows: walks a session's graph for each inbound DM. The
 * connection manager passes itself in (send/mirror/agent primitives) so
 * there is no DI cycle — this service only depends on data + integrations.
 */
@Injectable()
export class FlowEngineService {
  private readonly log = new Logger(FlowEngineService.name);
  private readonly cache = new Map<string, CachedFlow>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentRunner: AgentRunnerService,
    private readonly webhooks: WebhookDispatchService,
  ) {}

  /** The session's enabled flow, cached ~30s (checked on every DM). */
  async enabledFlowFor(sessionId: string): Promise<FlowRef | null> {
    const cached = this.cache.get(sessionId);
    if (cached && cached.expires > Date.now()) return cached.flow;
    const row = await this.prisma.flow.findUnique({
      where: { sessionId },
      select: {
        id: true,
        graph: true,
        enabled: true,
        organizationId: true,
      },
    });
    const flow = row?.enabled
      ? {
          id: row.id,
          graph: row.graph as unknown as FlowGraph,
          organizationId: row.organizationId,
        }
      : null;
    this.cache.set(sessionId, { flow, expires: Date.now() + 30_000 });
    return flow;
  }

  /** Drop a session's cache entry (called on flow save/toggle). */
  invalidate(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Walk the graph for one inbound DM. Never throws into the caller. */
  async run(
    flow: FlowRef,
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
  ): Promise<void> {
    // Safety: a handed-off conversation is owned by its human agent.
    const state = await this.prisma.flowConversationState.findUnique({
      where: { conversationId: ctx.conversationId },
    });
    if (state?.status === 'HANDED_OFF') return;

    const startedAt = Date.now();
    const rec: RunRecorder = { steps: [], outcome: 'completed' };
    try {
      const graph = flow.graph;
      const trigger = graph.nodes.find((n) => n.type === 'trigger');
      if (!trigger) return;

      let current: FlowNode | undefined = this.follow(graph, trigger, 'out');
      let steps = 0;
      while (current && steps < MAX_STEPS) {
        steps++;
        const node: FlowNode = current;
        current = await this.execute(flow, sessionId, ctx, manager, node, rec);
      }
      if (steps >= MAX_STEPS) {
        rec.outcome = 'step_limit';
        this.log.warn(`Flow ${flow.id}: step limit reached (cycle?)`);
      }
    } catch (e) {
      rec.outcome = 'error';
      rec.error = String(e);
      this.log.warn(`Flow ${flow.id} failed on ${sessionId}: ${e}`);
    } finally {
      await this.prisma.flowRun
        .create({
          data: {
            flowId: flow.id,
            conversationId: ctx.conversationId,
            leadJid: ctx.remoteJid,
            steps: rec.steps,
            outcome: rec.outcome,
            error: rec.error ?? null,
            durationMs: Date.now() - startedAt,
          },
        })
        .catch((e) => this.log.warn(`Flow run not recorded: ${e}`));
    }
  }

  /**
   * Walk the graph for a hypothetical message without touching anything:
   * no WhatsApp sends, no groups, no webhooks, no writes. Branching is the
   * real thing, including the AI nodes, so intent and aiDecision genuinely
   * call the agent (and spend its tokens) — a simulation that guessed those
   * would not be worth running.
   */
  async simulate(
    flow: FlowRef,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
    history: Turn[] = [],
  ): Promise<RunRecorder> {
    const rec: RunRecorder = {
      steps: [],
      outcome: 'completed',
      dryRun: true,
      history,
    };
    try {
      const trigger = flow.graph.nodes.find((n) => n.type === 'trigger');
      if (!trigger) {
        rec.outcome = 'error';
        rec.error = 'No trigger node';
        return rec;
      }
      let current = this.follow(flow.graph, trigger, 'out');
      let steps = 0;
      while (current && steps < MAX_STEPS) {
        steps++;
        current = await this.execute(
          flow,
          'simulation',
          ctx,
          manager,
          current,
          rec,
        );
      }
      if (steps >= MAX_STEPS) rec.outcome = 'step_limit';
    } catch (e) {
      rec.outcome = 'error';
      rec.error = String(e);
    }
    return rec;
  }

  /**
   * Who runs an AI node: the configured agent, or the org itself on included
   * tokens when none is set. These nodes only ever used an agent for its
   * credentials and model, never its persona, so leaving the field empty is
   * the simpler default rather than a missing setting.
   */
  private async aiTarget(
    flow: FlowRef,
    node: FlowNode,
  ): Promise<Agent | { organizationId: string }> {
    const agentId = node.data.agentId as string | undefined;
    if (agentId) {
      const agent = await this.prisma.agent.findUnique({
        where: { id: agentId },
      });
      if (agent) return agent;
    }
    return { organizationId: flow.organizationId };
  }

  /** Execute one node; returns the next node (undefined = stop). */
  private async execute(
    flow: FlowRef,
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
    node: FlowNode,
    rec: RunRecorder,
  ): Promise<FlowNode | undefined> {
    const graph = flow.graph;
    switch (node.type) {
      case 'keyword': {
        const keywords = (node.data.keywords as string[]) ?? [];
        const haystack = normalize(ctx.text ?? '');
        const hit = keywords.some((k) => haystack.includes(normalize(k)));
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: hit ? 'yes' : 'no',
        });
        return this.follow(graph, node, hit ? 'yes' : 'no');
      }

      case 'keywordCases': {
        // First case whose keyword list matches wins, so ordering in the
        // editor is the tie-break the user can see and control.
        const haystack = normalize(ctx.text ?? '');
        const hit = casesOf(node).find((c) =>
          (c.keywords ?? []).some((k) => haystack.includes(normalize(k))),
        );
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: hit?.key ?? 'fallback',
        });
        const next = hit ? this.follow(graph, node, hit.key) : undefined;
        return next ?? this.follow(graph, node, 'fallback');
      }

      case 'aiDecision': {
        const yes = await this.agentRunner.decide(
          await this.aiTarget(flow, node),
          ctx.conversationId,
          (node.data.question as string) ?? '',
          rec.history,
        );
        // A failed or unreadable decision takes "no": the safer branch, and
        // the one a user is likelier to have wired to a human.
        const branch = yes === true ? 'yes' : 'no';
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: yes === null ? `${branch} (undecided)` : branch,
        });
        return this.follow(graph, node, branch);
      }

      case 'intent': {
        const intents = intentsOf(node);
        const key = await this.agentRunner.classify(
          await this.aiTarget(flow, node),
          ctx.conversationId,
          intents,
          rec.history,
        );
        const branch = key && intents.some((i) => i.key === key) ? key : null;
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: branch ?? 'fallback',
        });
        const next = branch ? this.follow(graph, node, branch) : undefined;
        return next ?? this.follow(graph, node, 'fallback');
      }

      case 'agentReply': {
        const handoffEdge = edgeFrom(graph, node.id, 'onHandoff');
        if (rec.dryRun) {
          // Generate the reply for real but never send it: seeing what the
          // agent would say is the point of a conversation simulator, and
          // the transcript needs it to continue realistically.
          //
          // Every branch below reports WHY nothing came back. Reporting
          // "replied" when the agent produced nothing sends you looking for
          // a UI bug instead of the misconfiguration that caused it.
          const stop = (note: string) => {
            rec.steps.push({ nodeId: node.id, type: node.type, note });
            rec.outcome = 'agent_skipped';
            return undefined;
          };
          const agentId = node.data.agentId as string | undefined;
          const agent = agentId
            ? await this.prisma.agent.findUnique({ where: { id: agentId } })
            : null;
          if (!agent) return stop('no AI agent selected on this node');
          // Mirror the checks the live path makes, or the simulation would
          // promise a reply production would never send.
          if (!agent.enabled) return stop(`agent "${agent.name}" is disabled`);
          if (!agentActiveNow(agent)) {
            return stop(`agent "${agent.name}" is outside its active hours`);
          }

          const reply = await this.agentRunner.generateReply(
            agent,
            ctx.conversationId,
            rec.history,
            (node.data.prompt as string) ?? null,
          );
          if (!reply) {
            return stop(
              `agent "${agent.name}" could not reply — check its API key or token balance`,
            );
          }
          rec.reply = reply.text ?? null;
          rec.steps.push({
            nodeId: node.id,
            type: node.type,
            note: reply.handoff
              ? 'handed off to a human'
              : reply.text
                ? 'replied (not sent)'
                : handoffEdge && !agent.allowAutoStop
                  ? `agent "${agent.name}" cannot hand off — turn on "let the agent pause itself" on the agent`
                  : 'the agent produced no text',
          });
          if (reply.handoff && handoffEdge) {
            rec.outcome = 'handed_off';
            return graph.nodes.find((n) => n.id === handoffEdge.target);
          }
          rec.outcome = reply.handoff ? 'handed_off' : 'agent_replied';
          return undefined;
        }
        const outcome = await manager.runAgentReply(
          sessionId,
          ctx.conversationId,
          ctx.remoteJid,
          node.data.agentId as string,
          {
            pauseOnHandoff: !handoffEdge,
            stepInstructions: (node.data.prompt as string) ?? null,
          },
        );
        rec.steps.push({ nodeId: node.id, type: node.type, note: outcome });
        rec.outcome =
          outcome === 'replied'
            ? 'agent_replied'
            : outcome === 'handoff'
              ? 'handed_off'
              : 'agent_skipped';
        if (outcome === 'handoff' && handoffEdge) {
          return graph.nodes.find((n) => n.id === handoffEdge.target);
        }
        return undefined; // terminal after replying (or skipping)
      }

      case 'assignHuman': {
        if (rec.dryRun) return this.dryAssign(node, rec);
        const who = await this.assign(flow, sessionId, ctx, manager, node, [
          node.data.humanAgentId as string,
        ]);
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: who ?? 'failed',
        });
        rec.outcome = who ? 'handed_off' : rec.outcome;
        return undefined;
      }

      case 'roundRobin': {
        if (rec.dryRun) return this.dryAssign(node, rec);
        const list = (node.data.humanAgentIds as string[]) ?? [];
        const who = await this.assign(
          flow,
          sessionId,
          ctx,
          manager,
          node,
          list,
        );
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: who ?? 'failed',
        });
        rec.outcome = who ? 'handed_off' : rec.outcome;
        return undefined;
      }

      case 'assignGroup': {
        if (rec.dryRun) return this.dryAssign(node, rec);
        const list = (node.data.humanAgentIds as string[]) ?? [];
        const who = await this.assign(
          flow,
          sessionId,
          ctx,
          manager,
          node,
          list,
          true, // one shared group; any listed agent replies as the brand
        );
        rec.steps.push({
          nodeId: node.id,
          type: node.type,
          note: who ?? 'failed',
        });
        rec.outcome = who ? 'handed_off' : rec.outcome;
        return undefined;
      }

      case 'webhook': {
        if (rec.dryRun) {
          rec.steps.push({
            nodeId: node.id,
            type: node.type,
            note: 'would call webhook (not sent)',
          });
          return this.follow(graph, node, 'out');
        }
        await this.webhooks
          .dispatchTo(node.data.webhookId as string, 'flow.action', {
            note: (node.data.note as string) ?? null,
            nodeId: node.id,
            flowId: flow.id,
            conversationId: ctx.conversationId,
            from: ctx.remoteJid,
            pushName: ctx.pushName,
            text: ctx.text,
            sessionId,
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: webhook node failed: ${e}`),
          );
        rec.steps.push({ nodeId: node.id, type: node.type });
        return this.follow(graph, node, 'out');
      }

      case 'tagConversation': {
        if (rec.dryRun) {
          rec.steps.push({
            nodeId: node.id,
            type: node.type,
            note: 'would tag (not applied)',
          });
          return this.follow(graph, node, 'out');
        }
        await this.prisma.conversation
          .update({
            where: { id: ctx.conversationId },
            data: { tags: { connect: { id: node.data.tagId as string } } },
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: tag node failed: ${e}`),
          );
        rec.steps.push({ nodeId: node.id, type: node.type });
        return this.follow(graph, node, 'out');
      }

      case 'assignTeammate': {
        if (rec.dryRun) {
          rec.steps.push({
            nodeId: node.id,
            type: node.type,
            note: 'would assign (not applied)',
          });
          return this.follow(graph, node, 'out');
        }
        await this.prisma.conversation
          .update({
            where: { id: ctx.conversationId },
            data: { assignedToUserId: node.data.userId as string },
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: assignTeammate node failed: ${e}`),
          );
        rec.steps.push({ nodeId: node.id, type: node.type });
        return this.follow(graph, node, 'out');
      }

      case 'saveContact': {
        if (rec.dryRun) {
          rec.steps.push({
            nodeId: node.id,
            type: node.type,
            note: 'would save contact (not saved)',
          });
          return this.follow(graph, node, 'out');
        }
        const note = await this.saveContact(sessionId, ctx).catch((e) => {
          this.log.warn(`Flow ${flow.id}: saveContact failed: ${e}`);
          return 'error';
        });
        rec.steps.push({ nodeId: node.id, type: node.type, note });
        return this.follow(graph, node, 'out');
      }

      default:
        return undefined;
    }
  }

  /** Hand the conversation to a human agent through the mirror machinery. */
  /**
   * Simulated handoff: record who would receive it and end the walk, exactly
   * where the real assign nodes are terminal.
   */
  private dryAssign(node: FlowNode, rec: RunRecorder): undefined {
    const ids = (node.data.humanAgentIds as string[]) ?? [
      node.data.humanAgentId as string,
    ];
    rec.steps.push({
      nodeId: node.id,
      type: node.type,
      note: `would hand off to ${ids.filter(Boolean).length} agent(s) (no group created)`,
    });
    rec.outcome = 'handed_off';
    return undefined;
  }

  private async assign(
    flow: { id: string },
    sessionId: string,
    ctx: InboundAutomationCtx,
    manager: ConnectionManagerService,
    node: FlowNode,
    candidateIds: string[],
    /** true (assignGroup): every candidate joins one shared group. */
    all = false,
  ): Promise<string | null> {
    if (candidateIds.length === 0) return null;
    let ids = candidateIds;
    if (!all && candidateIds.length > 1) {
      const counter = await this.prisma.flowCounter.upsert({
        where: { flowId_nodeId: { flowId: flow.id, nodeId: node.id } },
        create: { flowId: flow.id, nodeId: node.id, value: 1 },
        update: { value: { increment: 1 } },
      });
      ids = [candidateIds[(counter.value - 1) % candidateIds.length]];
    } else if (!all) {
      ids = [candidateIds[0]];
    }
    const humans = (
      await Promise.all(
        ids.map((id) => this.prisma.humanAgent.findUnique({ where: { id } })),
      )
    ).filter((h): h is NonNullable<typeof h> => h !== null);
    if (humans.length === 0) {
      this.log.warn(
        `Flow ${flow.id}: human agent(s) ${ids.join(', ')} missing`,
      );
      return null;
    }
    const showLeadName = (node.data.showLeadName as boolean) ?? true;
    const thread = await manager.createMirrorThread(
      sessionId,
      ctx.remoteJid,
      humans.map((h) => ({ id: h.id, number: h.phoneNumber })),
      {
        prefix: (node.data.groupPrefix as string) || DEFAULT_GROUP_PREFIX,
        showLeadName,
      },
    );
    // Optionally seed the group with the conversation so far, so the human
    // has context before the triggering message arrives. Best-effort.
    if ((node.data.copyHistory as boolean) ?? false) {
      const transcript = await this.historyTranscript(
        ctx.conversationId,
        showLeadName ? ctx.pushName : null,
      );
      if (transcript) {
        await manager
          .sendText(sessionId, thread.groupJid, transcript, {
            source: MessageSource.MIRROR,
          })
          .catch((e) =>
            this.log.warn(`Flow ${flow.id}: history copy failed: ${e}`),
          );
      }
    }
    await manager.forwardLeadToGroup(sessionId, thread, ctx);
    const farewell = (node.data.farewellText as string) ?? '';
    if (farewell.trim()) {
      await manager.sendText(sessionId, ctx.remoteJid, farewell.trim(), {
        source: MessageSource.API,
      });
    }
    await this.prisma.flowConversationState.upsert({
      where: { conversationId: ctx.conversationId },
      create: {
        flowId: flow.id,
        conversationId: ctx.conversationId,
        status: 'HANDED_OFF',
        humanAgentId: humans[0].id,
      },
      update: { status: 'HANDED_OFF', humanAgentId: humans[0].id },
    });
    // Linked agents bridge into inbox assignment: the conversation shows up
    // as theirs in the dashboard too (first linked agent wins). Best-effort.
    const linked = humans.find((h) => h.userId);
    if (linked?.userId) {
      await this.prisma.conversation
        .update({
          where: { id: ctx.conversationId },
          data: { assignedToUserId: linked.userId },
        })
        .catch((e) =>
          this.log.warn(`Flow ${flow.id}: handoff assignment failed: ${e}`),
        );
    }
    const names = humans.map((h) => h.name).join(', ');
    this.log.log(`Flow ${flow.id}: handed ${ctx.conversationId} to ${names}`);
    return names;
  }

  /**
   * Upsert the lead into the org's contact book, remembering which session
   * they wrote to. First contact creates the record (dispatching
   * contact.created); later runs only fill a missing name or link a new
   * session (dispatching contact.updated). Used by the saveContact flow
   * node and by sessions with the auto-save setting on.
   */
  async saveContact(
    sessionId: string,
    ctx: InboundAutomationCtx,
  ): Promise<string> {
    return this.saveContactFor(sessionId, {
      remoteJid: ctx.remoteJid,
      phoneNumber: ctx.phoneNumber ?? null,
      name: ctx.pushName,
    });
  }

  /**
   * Save (or top up) the contact behind one WhatsApp identity. Shared by the
   * flow node, the session's auto-save and the inbox button, so all three
   * agree on identity matching and on what counts as an update.
   */
  async saveContactFor(
    sessionId: string,
    who: { remoteJid: string; phoneNumber: string | null; name: string | null },
  ): Promise<string> {
    const ctx = { ...who, pushName: who.name };
    const session = await this.prisma.waSession.findUnique({
      where: { id: sessionId },
      select: { organizationId: true },
    });
    if (!session) return 'error';
    const organizationId = session.organizationId;
    // DMs arrive from a phone jid or (phone hidden) a LID jid. When it is a
    // LID we may also know the number behind it, so both identities are kept
    // and either one matches an existing contact.
    const [num, host] = ctx.remoteJid.split('@');
    const lid = host === 'lid' ? num : null;
    const phoneNumber = host === 'lid' ? (ctx.phoneNumber ?? null) : num;
    const identities = [
      ...(lid ? [{ lid }] : []),
      ...(phoneNumber ? [{ phoneNumber }] : []),
    ];
    if (identities.length === 0) return 'error';
    const existing = await this.prisma.contact.findFirst({
      where: { organizationId, OR: identities },
      include: {
        sessions: { where: { id: sessionId }, select: { id: true } },
      },
    });
    if (existing) {
      const fillName = !existing.name && ctx.pushName;
      const linkSession = existing.sessions.length === 0;
      // Identities are unique per org, so only adopt one nobody else holds.
      const addLid =
        lid &&
        !existing.lid &&
        (await this.identityFree(organizationId, { lid }, existing.id));
      const addPhone =
        phoneNumber &&
        !existing.phoneNumber &&
        (await this.identityFree(organizationId, { phoneNumber }, existing.id));
      if (!fillName && !linkSession && !addLid && !addPhone) return 'exists';
      const updated = await this.prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...(fillName ? { name: ctx.pushName } : {}),
          ...(addLid ? { lid } : {}),
          ...(addPhone ? { phoneNumber } : {}),
          ...(linkSession ? { sessions: { connect: { id: sessionId } } } : {}),
        },
      });
      void this.webhooks.dispatch({
        organizationId,
        sessionId,
        event: 'contact.updated',
        payload: updated,
      });
      return 'updated';
    }
    const created = await this.prisma.contact.create({
      data: {
        organizationId,
        name: ctx.pushName ?? null,
        lid,
        phoneNumber,
        sessions: { connect: { id: sessionId } },
      },
    });
    void this.webhooks.dispatch({
      organizationId,
      sessionId,
      event: 'contact.created',
      payload: created,
    });
    return 'created';
  }

  /** True when no other contact in the org already holds this identity. */
  private async identityFree(
    organizationId: string,
    identity: { lid: string } | { phoneNumber: string },
    exceptId: string,
  ): Promise<boolean> {
    const taken = await this.prisma.contact.findFirst({
      where: { organizationId, ...identity, id: { not: exceptId } },
      select: { id: true },
    });
    return taken === null;
  }

  /**
   * Compact one-message transcript of the conversation so far. During a flow
   * handoff the newest inbound row (the message that triggered the run) is
   * left out — it is forwarded to the group separately, right after this.
   * Mirrors opened from the inbox have no triggering message, so they keep
   * it (`dropTriggering: false`). Null when there is no history worth copying.
   */
  async historyTranscript(
    conversationId: string,
    leadName: string | null,
    dropTriggering = true,
  ): Promise<string | null> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, source: { not: MessageSource.NOTE } },
      orderBy: { timestamp: 'desc' },
      take: HISTORY_COPY_LIMIT + 1,
      select: { direction: true, source: true, type: true, text: true },
    });
    rows.reverse();
    if (dropTriggering && rows.length && rows.at(-1)!.direction === 'INBOUND') {
      rows.pop();
    }
    const lines = rows.slice(-HISTORY_COPY_LIMIT).map((m) => {
      const text = (m.text ?? `[${m.type.toLowerCase()}]`).slice(0, 300);
      const who =
        m.direction === 'INBOUND'
          ? (leadName ?? 'Lead')
          : m.source === MessageSource.AGENT
            ? 'Bot'
            : 'Equipo';
      return `*${who}:* ${text}`;
    });
    if (lines.length === 0) return null;
    return `📋 *Historial:*\n\n${lines.join('\n')}`;
  }

  private follow(
    graph: FlowGraph,
    node: FlowNode,
    handle: string,
  ): FlowNode | undefined {
    const edge = edgeFrom(graph, node.id, handle);
    if (!edge) return undefined;
    return graph.nodes.find((n) => n.id === edge.target);
  }
}

/** Lowercase + strip diacritics so "camión" matches "camion". */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
