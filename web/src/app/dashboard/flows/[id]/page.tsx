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
import {
  FlowIntent,
  FlowNodeType,
  FlowRefs,
  NODE_META,
  PALETTE,
  defaultDataFor,
  handlesFor,
  summarize,
} from "../flow-defs";

type FlowNodeData = Record<string, unknown>;
type EditorNode = Node<FlowNodeData>;

const RefsContext = createContext<FlowRefs | null>(null);

/** Generic node card: title, summary, one target handle, labeled sources. */
function FlowNodeCard({ id, type, data, selected }: NodeProps) {
  const refs = useContext(RefsContext);
  const t = type as FlowNodeType;
  const meta = NODE_META[t];
  const handles = handlesFor(t, data as FlowNodeData);
  return (
    <div
      className={`w-52 rounded-xl border bg-[var(--color-surface)] px-3 py-2 shadow-sm ${
        selected
          ? "border-[var(--color-brand)]"
          : "border-[var(--color-border)]"
      }`}
    >
      {t !== "trigger" && (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-2.5 !w-2.5 !bg-[var(--color-muted)]"
        />
      )}
      <div className="text-sm font-medium">
        {meta.icon} {meta.title}
      </div>
      <div className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
        {summarize(t, data as FlowNodeData, refs)}
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
  Object.keys(NODE_META).map((t) => [t, FlowNodeCard]),
);

export default function FlowEditorPage() {
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
        setError(e instanceof Error ? e.message : "Failed to load");
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
      setError(e instanceof Error ? e.message : "Save failed");
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
      setError(e instanceof Error ? e.message : "Toggle failed");
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
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  return (
    <RefsContext.Provider value={refs}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <button
            onClick={() => router.push("/dashboard/flows")}
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            ← Flows
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
                unsaved changes
              </span>
            )}
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
            <button
              onClick={toggleEnabled}
              disabled={busy || dirty}
              title={dirty ? "Save first" : undefined}
              className={`badge ${
                enabled
                  ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
                  : "bg-[var(--color-chip)] text-[var(--color-muted)]"
              } disabled:opacity-50`}
            >
              {enabled ? "enabled" : "disabled"}
            </button>
            <button
              onClick={removeFlow}
              disabled={busy}
              className="btn-danger text-xs"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex w-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-[var(--color-border)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Add node
            </div>
            {PALETTE.map((t) => (
              <button
                key={t}
                onClick={() => addNode(t)}
                className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-left text-xs hover:border-[var(--color-brand)]/50"
              >
                {NODE_META[t].icon} {NODE_META[t].title}
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
                onNodeClick={(_, n) => setSelectedId(n.id)}
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
                {error ?? "Loading…"}
              </p>
            )}
          </div>

          {selected && refs && (
            <div className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] p-4">
              <NodePanel
                node={selected}
                refs={refs}
                onPatch={patchSelected}
                onDelete={deleteSelected}
              />
            </div>
          )}
        </div>
      </div>
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
  const t = node.type as FlowNodeType;
  const meta = NODE_META[t];
  const d = node.data;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-semibold">
          {meta.icon} {meta.title}
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{meta.hint}</p>
      </div>

      {t === "keyword" && (
        <label className="flex flex-col gap-1 text-sm">
          Keywords (one per line)
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

      {(t === "intent" || t === "agentReply") && (
        <label className="flex flex-col gap-1 text-sm">
          AI agent
          <select
            className="input"
            value={(d.agentId as string) ?? ""}
            onChange={(e) => onPatch({ agentId: e.target.value })}
          >
            <option value="">Select…</option>
            {refs.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>
      )}

      {t === "intent" && (
        <IntentListEditor
          intents={(d.intents as FlowIntent[]) ?? []}
          onChange={(intents) => onPatch({ intents })}
        />
      )}

      {t === "assignHuman" && (
        <label className="flex flex-col gap-1 text-sm">
          Human agent
          <select
            className="input"
            value={(d.humanAgentId as string) ?? ""}
            onChange={(e) => onPatch({ humanAgentId: e.target.value })}
          >
            <option value="">Select…</option>
            {refs.humanAgents.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} (+{h.phoneNumber})
              </option>
            ))}
          </select>
        </label>
      )}

      {t === "roundRobin" && (
        <div className="flex flex-col gap-1 text-sm">
          Human agents (in rotation)
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

      {(t === "assignHuman" || t === "roundRobin") && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Group name prefix
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
            Show the lead&apos;s name in the group
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Farewell message to the lead (optional)
            <textarea
              className="input min-h-16 text-xs"
              maxLength={500}
              placeholder="Te conectamos con un asesor…"
              value={(d.farewellText as string) ?? ""}
              onChange={(e) => onPatch({ farewellText: e.target.value })}
            />
          </label>
        </>
      )}

      {t === "webhook" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Webhook
            <select
              className="input"
              value={(d.webhookId as string) ?? ""}
              onChange={(e) => onPatch({ webhookId: e.target.value })}
            >
              <option value="">Select…</option>
              {refs.webhooks.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.url}
                  {w.active ? "" : " (disabled)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note (sent in the payload)
            <input
              className="input"
              maxLength={200}
              value={(d.note as string) ?? ""}
              onChange={(e) => onPatch({ note: e.target.value })}
            />
          </label>
        </>
      )}

      {t === "tagConversation" && (
        <label className="flex flex-col gap-1 text-sm">
          Tag
          <select
            className="input"
            value={(d.tagId as string) ?? ""}
            onChange={(e) => onPatch({ tagId: e.target.value })}
          >
            <option value="">Select…</option>
            {refs.tags.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {t === "assignTeammate" && (
        <label className="flex flex-col gap-1 text-sm">
          Team member
          <select
            className="input"
            value={(d.userId as string) ?? ""}
            onChange={(e) => onPatch({ userId: e.target.value })}
          >
            <option value="">Select…</option>
            {refs.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {t !== "trigger" && (
        <button onClick={onDelete} className="btn-danger self-start text-xs">
          Delete node
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
  function patch(i: number, changes: Partial<FlowIntent>) {
    onChange(intents.map((it, j) => (j === i ? { ...it, ...changes } : it)));
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      Intents (each becomes an output)
      {intents.map((it, i) => (
        <div
          key={i}
          className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] p-2"
        >
          <div className="flex gap-2">
            <input
              className="input h-8 w-28 px-2 py-0 font-mono text-xs"
              placeholder="key"
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
              placeholder="Label"
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
            placeholder="Description for the classifier (optional)"
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
          + Add intent
        </button>
      )}
    </div>
  );
}
