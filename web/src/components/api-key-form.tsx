"use client";

import type { WaSession } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useState } from "react";

/** Grouped for the UI; the API stores them flat as "<resource>:<action>". */
const RESOURCES = ["messages", "sessions", "mirror", "instagram"] as const;
const ACTIONS = ["read", "write"] as const;

/**
 * Creating a scoped API key.
 *
 * Scopes are opt-in rather than opt-out: an unticked box means the key cannot
 * do that thing, and a key created with nothing ticked can authenticate and
 * nothing more. That is deliberately the safe direction — the whole point of
 * this feature is that a key handed to a third party should not be able to
 * delete the WhatsApp sessions it was only meant to send from.
 */
export function ApiKeyForm({
  sessions,
  busy,
  onCreate,
}: {
  sessions: WaSession[];
  busy: boolean;
  onCreate: (v: {
    name: string;
    scopes: string[];
    sessionIds: string[];
  }) => void;
}) {
  const t = useTranslations("dash.apiKeys");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || scopes.size === 0) return;
    onCreate({
      name: name.trim(),
      scopes: [...scopes],
      sessionIds: [...sessionIds],
    });
    setName("");
    setScopes(new Set());
    setSessionIds(new Set());
  };

  return (
    <form onSubmit={submit} className="card flex flex-col gap-5">
      <div>
        <label className="label">{t("keyName")}</label>
        <input
          className="input"
          placeholder={t("keyNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <p className="label">{t("scopes")}</p>
        <p className="mb-2 text-xs text-[var(--color-muted)]">
          {t("scopesHint")}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-muted)]">
                <th className="pb-1 font-medium">{t("scopeArea")}</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="w-20 pb-1 font-medium">
                    {t(`scopeAction.${a}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r} className="border-t border-[var(--color-border)]">
                  <td className="py-2">{t(`scopeResource.${r}`)}</td>
                  {ACTIONS.map((a) => {
                    const scope = `${r}:${a}`;
                    return (
                      <td key={a} className="py-2">
                        <input
                          type="checkbox"
                          aria-label={scope}
                          checked={scopes.has(scope)}
                          onChange={() =>
                            setScopes((s) => toggle(s, scope))
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sessions.length > 0 && (
        <div>
          <p className="label">{t("keySessions")}</p>
          <p className="mb-2 text-xs text-[var(--color-muted)]">
            {/* Says what "none ticked" means, because an empty allow-list
                reading as "everything" is the opposite of how the scope
                checkboxes above behave. */}
            {t("keySessionsHint")}
          </p>
          <div className="flex flex-wrap gap-3">
            {sessions.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={sessionIds.has(s.id)}
                  onChange={() => setSessionIds((v) => toggle(v, s.id))}
                />
                {s.channel === "INSTAGRAM" && s.handle
                  ? `@${s.handle}`
                  : s.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="btn-primary"
          // A key with no scopes authenticates and then fails every call, so
          // creating one is never what anyone wants.
          disabled={busy || !name.trim() || scopes.size === 0}
        >
          {t("generateKey")}
        </button>
        {name.trim() && scopes.size === 0 && (
          <span className="text-xs text-[var(--color-muted)]">
            {t("pickAScope")}
          </span>
        )}
      </div>
    </form>
  );
}
