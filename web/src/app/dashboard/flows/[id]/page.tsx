"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiClient } from "@/lib/client-api";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import {
  FlowIntent,
  FlowNodeType,
  FlowRefs,
  NODE_ICONS,
  PALETTE,
  defaultDataFor,
  handlesFor,
  summarize,
} from "../flow-defs";

type FlowNodeData = Record<string, unknown>;
type EditorNode = Node<FlowNodeData>;

const RefsContext = createContext<FlowRefs | null>(null);
const HighlightContext = createContext<Set<string>>(new Set());

/** Generic node card: title, summary, one target handle, labeled sources. */
function FlowNodeCard({ id, type, data, selected }: NodeProps) {
  const t = useTranslations("dash.flows");
  const refs = useContext(RefsContext);
  const highlighted = useContext(HighlightContext).has(id);
  const nt = type as FlowNodeType;
  const handles = handlesFor(nt, data as FlowNodeData);
  return (
    <div
      className={`w-52 rounded-xl border bg-[var(--color-surface)] px-3 py-2 shadow-sm ${
        selected
          ? "border-[var(--color-brand)]"
          : "border-[var(--color-border)]"
      } ${highlighted ? "ring-2 ring-[var(--color-warning)]" : ""}`}
    >
      {nt !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !bg-[var(--color-muted)]"
        />
      )}
      <div className="text-sm font-medium">
        {NODE_ICONS[nt]} {t(`nodes.${nt}.title`)}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
        {summarize(nt, data as FlowNodeData, refs, t)}
      </div>
      {handles.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {handles.map((h) => (
            <div key={h} className="relative pr-1 text-right">
              {h !== "out" && (
                <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                  {h}
                </span>
              )}
              <Handle
                id={h}
                type="source"
                position={Position.Right}
                style={{ position: "absolute", top: "50%", right: -17 }}
                className="!h-2.5 !w-2.5 !bg-[var(--color-brand)]"
              />
            </div>
          ))}
        </div>
      )}
      {id === "trigger" && handles.length === 0 && null}
    </div>
  );
}

const nodeTypes = Object.fromEntries(
  Object.keys(NODE_ICONS).map((t) => [t, FlowNodeCard]),
);

export default function FlowEditorPage() {
  const t = useTranslations("dash.flows");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { data: auth } = useSession();
  const token = auth?.accessToken;
  const router = useRouter();

  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [refs, setRefs] = useState<FlowRefs | null>(null);
  const [flowName, setFlowName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [sessionLabel, setSessionLabel] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runs, setRuns] = useState<FlowRun[] | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [flow, references] = await Promise.all([
          apiClient<{
            name: string;
            enabled: boolean;
            graph: { nodes: EditorNode[]; edges: Edge[] };
            session: { label: string };
          }>(`/flows/${id}`, token),
          apiClient<FlowRefs>("/flows/references", token),
        ]);
        setFlowName(flow.name);
        setEnabled(flow.enabled);
        setSessionLabel(flow.session.label);
        setNodes(flow.graph.nodes ?? []);
        setEdges((flow.graph.edges ?? []).map((e) => ({ ...e })));
        setRefs(references);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : tc("failedToLoad"));
      }
    })();
  }, [token, id, setNodes, setEdges]);

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) =>
        addEdge(
          conn,
          // One edge per source handle: replace any existing.
          eds.filter(
            (e) =>
              !(
                e.source === conn.source &&
                (e.sourceHandle ?? "out") === (conn.sourceHandle ?? "out")
              ),
          ),
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  function addNode(type: FlowNodeType) {
    const nid = `${type}_${Math.random().toString(36).slice(2, 8)}`;
    setNodes((ns) => [
      ...ns,
      {
        id: nid,
        type,
        position: { x: 320 + Math.random() * 120, y: 80 + ns.length * 60 },
        data: defaultDataFor(type),
      },
    ]);
    setSelectedId(nid);
    setDirty(true);
  }

  function patchSelected(patch: FlowNodeData) {
    if (!selectedId) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
    setDirty(true);
  }

  function deleteSelected() {
    if (!selectedId || selectedId === "trigger") return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) =>
      es.filter((e) => e.source !== selectedId && e.target !== selectedId),
    );
    setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/flows/${id}/graph`, token, {
        method: "PUT",
        body: JSON.stringify({
          graph: {
            nodes: nodes.map((n) => ({
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data,
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              sourceHandle: e.sourceHandle ?? null,
              target: e.target,
            })),
          },
        }),
      });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient<{ enabled: boolean }>(
        `/flows/${id}`,
        token,
        { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) },
      );
      setEnabled(updated.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
    } finally {
      setBusy(false);
    }
  }

  async function removeFlow() {
    if (!token || busy) return;
    setBusy(true);
    try {
      await apiClient(`/flows/${id}`, token, { method: "DELETE" });
      router.push("/dashboard/flows");
    } catch (e) {
      setError(e instanceof Error ? e.message : tc("somethingWentWrong"));
      setBusy(false);
    }
  }

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const loadRuns = useCallback(async () => {
    if (!token) return;
    try {
      setRuns(await apiClient<FlowRun[]>(`/flows/${id}/runs`, token));
    } catch {
      setRuns([]);
    }
  }, [token, id]);

  useEffect(() => {
    if (runsOpen) void loadRuns();
  }, [runsOpen, loadRuns]);

  return (
    <RefsContext.Provider value={refs}>
      <HighlightContext.Provider value={highlight}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <button
            onClick={() => router.push("/dashboard/flows")}
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            ← {t("backToFlows")}
          </button>
          <div className="font-semibold">{flowName}</div>
          <span className="text-xs text-[var(--color-muted)]">
            {sessionLabel}
          </span>
          {error && (
            <span className="max-w-md truncate text-xs text-[var(--color-danger)]">
              {error}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <span className="text-xs text-[var(--color-warning)]">
                {t("unsaved")}
              </span>
            )}
            <button
              onClick={() => {
                setRunsOpen((v) => !v);
                setSelectedId(null);
                if (runsOpen) setHighlight(new Set());
              }}
              className={`btn-ghost text-xs ${runsOpen ? "text-[var(--color-brand)]" : ""}`}
            >
              {t("runs")}
            </button>
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? "…" : tc("save")}
            </button>
            <button
              onClick={toggleEnabled}
              disabled={busy || dirty}
              title={dirty ? t("saveFirst") : undefined}
              className={`badge ${
                enabled
                  ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                  : "bg-[var(--color-chip)] text-[var(--color-muted)]"
              } disabled:opacity-50`}
            >
              {enabled ? tc("enabled") : tc("disabled")}
            </button>
            <button
              onClick={removeFlow}
              disabled={busy}
              className="btn-danger text-xs"
            >
              {tc("delete")}
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-[var(--color-border)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              {t("addNode")}
            </div>
            {PALETTE.map((pt) => (
              <button
                key={pt}
                onClick={() => addNode(pt)}
                className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-left text-xs hover:border-[var(--color-brand)]/50"
              >
                {NODE_ICONS[pt]} {t(`nodes.${pt}.title`)}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {loaded ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(c) => {
                  onNodesChange(c);
                  if (c.some((ch) => ch.type === "position")) setDirty(true);
                }}
                onEdgesChange={(c) => {
                  onEdgesChange(c);
                  if (c.some((ch) => ch.type === "remove")) setDirty(true);
                }}
                onConnect={onConnect}
                onNodeClick={(_, n) => {
                  setSelectedId(n.id);
                  setRunsOpen(false);
                }}
                onPaneClick={() => setSelectedId(null)}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={18} />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : (
              <p className="p-6 text-sm text-[var(--color-muted)]">
                {error ?? tc("loading")}
              </p>
            )}
          </div>

          {selected && refs && !runsOpen && (
            <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] p-4">
              <NodePanel
                node={selected}
                refs={refs}
                onPatch={patchSelected}
                onDelete={deleteSelected}
              />
            </div>
          )}
          {runsOpen && (
            <div className="w-96 shrink-0 overflow-y-auto border-l border-[var(--color-border)] p-4">
              <RunsPanel
                runs={runs}
                onRefresh={loadRuns}
                onHighlight={(ids) => setHighlight(new Set(ids))}
              />
            </div>
          )}
        </div>
      </div>
      </HighlightContext.Provider>
    </RefsContext.Provider>
  );
}

// ---- side panel ------------------------------------------------------------

function NodePanel({
  node,
  refs,
  onPatch,
  onDelete,
}: {
  node: EditorNode;
  refs: FlowRefs;
  onPatch: (patch: FlowNodeData) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("dash.flows");
  const nt = node.type as FlowNodeType;
  const d = node.data;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-semibold">
          {NODE_ICONS[nt]} {t(`nodes.${nt}.title`)}
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {t(`nodes.${nt}.hint`)}
        </p>
      </div>

      {nt === "keyword" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("keywordsLabel")}
          <textarea
            className="input min-h-24 text-xs"
            value={((d.keywords as string[]) ?? []).join("\n")}
            onChange={(e) =>
              onPatch({
                keywords: e.target.value
                  .split("\n")
                  .map((k) => k.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      )}

      {(nt === "intent" || nt === "agentReply") && (
        <label className="flex flex-col gap-1 text-sm">
          {t("aiAgent")}
          <select
            className="input"
            value={(d.agentId as string) ?? ""}
            onChange={(e) => onPatch({ agentId: e.target.value })}
          >
            <option value="">{t("select")}</option>
            {refs.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.enabled ? "" : ` ${t("agentDisabledSuffix")}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {nt === "intent" && (
        <IntentListEditor
          intents={(d.intents as FlowIntent[]) ?? []}
          onChange={(intents) => onPatch({ intents })}
        />
      )}

      {nt === "assignHuman" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("humanAgent")}
          <select
            className="input"
            value={(d.humanAgentId as string) ?? ""}
            onChange={(e) => onPatch({ humanAgentId: e.target.value })}
          >
            <option value="">{t("select")}</option>
            {refs.humanAgents.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} (+{h.phoneNumber})
              </option>
            ))}
          </select>
        </label>
      )}

      {nt === "roundRobin" && (
        <div className="flex flex-col gap-1 text-sm">
          {t("rotationLabel")}
          {refs.humanAgents.map((h) => {
            const list = (d.humanAgentIds as string[]) ?? [];
            const checked = list.includes(h.id);
            return (
              <label key={h.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    onPatch({
                      humanAgentIds: e.target.checked
                        ? [...list, h.id]
                        : list.filter((x) => x !== h.id),
                    })
                  }
                />
                {h.name} (+{h.phoneNumber})
              </label>
            );
          })}
        </div>
      )}

      {(nt === "assignHuman" || nt === "roundRobin") && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t("groupPrefix")}
            <input
              className="input"
              placeholder="🔒 Lead"
              maxLength={40}
              value={(d.groupPrefix as string) ?? ""}
              onChange={(e) => onPatch({ groupPrefix: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={(d.showLeadName as boolean) ?? true}
              onChange={(e) => onPatch({ showLeadName: e.target.checked })}
            />
            {t("showLeadName")}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("farewell")}
            <textarea
              className="input min-h-16 text-xs"
              maxLength={500}
              placeholder={t("farewellPlaceholder")}
              value={(d.farewellText as string) ?? ""}
              onChange={(e) => onPatch({ farewellText: e.target.value })}
            />
          </label>
        </>
      )}

      {nt === "webhook" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            {t("webhookLabel")}
            <select
              className="input"
              value={(d.webhookId as string) ?? ""}
              onChange={(e) => onPatch({ webhookId: e.target.value })}
            >
              <option value="">{t("select")}</option>
              {refs.webhooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.url}
                  {w.active ? "" : ` ${t("agentDisabledSuffix")}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("noteLabel")}
            <input
              className="input"
              maxLength={200}
              value={(d.note as string) ?? ""}
              onChange={(e) => onPatch({ note: e.target.value })}
            />
          </label>
        </>
      )}

      {nt === "tagConversation" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("tagLabel")}
          <select
            className="input"
            value={(d.tagId as string) ?? ""}
            onChange={(e) => onPatch({ tagId: e.target.value })}
          >
            <option value="">{t("select")}</option>
            {refs.tags.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {nt === "assignTeammate" && (
        <label className="flex flex-col gap-1 text-sm">
          {t("teammateLabel")}
          <select
            className="input"
            value={(d.userId as string) ?? ""}
            onChange={(e) => onPatch({ userId: e.target.value })}
          >
            <option value="">{t("select")}</option>
            {refs.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {nt !== "trigger" && (
        <button onClick={onDelete} className="btn-danger self-start text-xs">
          {t("deleteNode")}
        </button>
      )}
    </div>
  );
}

function IntentListEditor({
  intents,
  onChange,
}: {
  intents: FlowIntent[];
  onChange: (intents: FlowIntent[]) => void;
}) {
  const t = useTranslations("dash.flows");
  function patch(i: number, changes: Partial<FlowIntent>) {
    onChange(intents.map((it, j) => (j === i ? { ...it, ...changes } : it)));
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {t("intentsLabel")}
      {intents.map((it, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] p-2"
        >
          <div className="flex gap-2">
            <input
              className="input h-8 w-28 px-2 py-0 font-mono text-xs"
              placeholder={t("intentKeyPlaceholder")}
              value={it.key}
              onChange={(e) =>
                patch(i, {
                  key: e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "")
                    .slice(0, 24),
                })
              }
            />
            <input
              className="input h-8 flex-1 px-2 py-0 text-xs"
              placeholder={t("intentLabelPlaceholder")}
              value={it.label}
              onChange={(e) => patch(i, { label: e.target.value })}
            />
            <button
              type="button"
              onClick={() => onChange(intents.filter((_, j) => j !== i))}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-danger)]"
            >
              ✕
            </button>
          </div>
          <input
            className="input h-8 px-2 py-0 text-xs"
            placeholder={t("intentDescPlaceholder")}
            value={it.description ?? ""}
            onChange={(e) => patch(i, { description: e.target.value })}
          />
        </div>
      ))}
      {intents.length < 8 && (
        <button
          type="button"
          onClick={() => onChange([...intents, { key: "", label: "" }])}
          className="btn-ghost self-start text-xs"
        >
          + {t("addIntent")}
        </button>
      )}
    </div>
  );
}

// ---- runs panel ------------------------------------------------------------

interface FlowRun {
  id: string;
  leadJid: string;
  steps: { nodeId: string; type: string; note?: string }[];
  outcome: string;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

const OUTCOME_STYLE: Record<string, string> = {
  handed_off: "bg-[var(--color-brand)]/15 text-[var(--color-brand)]",
  agent_replied: "bg-[var(--color-success-bg)] text-[var(--color-success)]",
  completed: "bg-[var(--color-chip)] text-[var(--color-muted)]",
  agent_skipped: "bg-[var(--color-warning-bg)] text-[var(--color-warning)]",
  error: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
  step_limit: "bg-[var(--color-danger-bg)] text-[var(--color-danger)]",
};

function RunsPanel({
  runs,
  onRefresh,
  onHighlight,
}: {
  runs: FlowRun[] | null;
  onRefresh: () => void;
  onHighlight: (ids: string[]) => void;
}) {
  const t = useTranslations("dash.flows");
  const tc = useTranslations("common");
  const tw = useTranslations("dash.webhooks");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{t("runs")}</div>
        <button onClick={onRefresh} className="btn-ghost text-xs">
          {tw("refresh")}
        </button>
      </div>
      <p className="text-xs text-[var(--color-muted)]">{t("runsHint")}</p>
      {runs === null ? (
        <p className="text-sm text-[var(--color-muted)]">{tc("loading")}</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">{t("noRuns")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                const next = openId === r.id ? null : r.id;
                setOpenId(next);
                onHighlight(next ? r.steps.map((s) => s.nodeId) : []);
              }}
              className={`rounded-lg border p-2 text-left text-xs ${
                openId === r.id
                  ? "border-[var(--color-warning)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-brand)]/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono">
                  +{r.leadJid.split("@")[0]}
                </span>
                <span
                  className={`badge text-[10px] ${OUTCOME_STYLE[r.outcome] ?? OUTCOME_STYLE.completed}`}
                >
                  {r.outcome.replace(/_/g, " ")}
                </span>
                <span className="ml-auto text-[var(--color-muted)]">
                  {new Date(r.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-1 text-[var(--color-muted)]">
                {r.steps.length === 0
                  ? t("noSteps")
                  : r.steps
                      .map(
                        (s) =>
                          `${NODE_ICONS[s.type as FlowNodeType] ?? "•"}${s.note ? ` ${s.note}` : ""}`,
                      )
                      .join(" → ")}
                {" · "}
                {r.durationMs}ms
              </div>
              {r.error && (
                <div className="mt-1 text-[var(--color-danger)]">{r.error}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
