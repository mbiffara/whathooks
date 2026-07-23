import { useTranslations } from "next-intl";
import type { ChatMessage } from "./types";
import { clockTime, formatBytes } from "./utils";

/** Internal note: amber sticky-note style, clearly not a WhatsApp message. */
function NoteBubble({
  message,
  label,
}: {
  message: ChatMessage;
  label: string;
}) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] px-3 py-2">
        <div className="mb-0.5 text-[10px] font-semibold text-[var(--color-warning)]">
          🗒 {label}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
          {message.text}
        </p>
        <div className="mt-1 text-right text-[10px] text-[var(--color-muted)]">
          {clockTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function senderLabel(
  message: ChatMessage,
  t: (key: string) => string,
): string | null {
  switch (message.source) {
    case "AGENT":
      return `🤖 ${message.agentName ?? t("agent")}`;
    case "API":
      return "⚙ API";
    case "HUMAN":
      // Attribution: which teammate replied (older rows predate tracking).
      return message.sentByName ?? null;
    default:
      return null;
  }
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const t = useTranslations("dash.messages.bubble");
  const outbound = message.fromMe || message.direction === "OUTBOUND";
  const media = message.media;

  if (message.source === "NOTE") {
    return (
      <NoteBubble message={message} label={message.sentByName ?? t("note")} />
    );
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 ${
          outbound
            ? "border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/15"
            : "border border-[var(--color-border)] bg-[var(--color-surface-2)]"
        }`}
      >
        {outbound && senderLabel(message, t) && (
          <div className="mb-0.5 text-[10px] font-semibold text-[var(--color-brand)]">
            {senderLabel(message, t)}
          </div>
        )}
        <MessageBody message={message} />
        <div className="mt-1 flex items-center justify-end gap-2">
          {(message.reactions?.length ?? 0) > 0 && (
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] leading-none">
              {message.reactions!.map((r) => (
                <span key={`${r.by}-${r.emoji}`} title={r.by}>
                  {r.emoji}
                </span>
              ))}
              {message.reactions!.length > 1 && (
                <span className="ml-0.5 text-[9px] text-[var(--color-muted)]">
                  {message.reactions!.length}
                </span>
              )}
            </span>
          )}
          <span className="text-right text-[10px] text-[var(--color-muted)]">
            {clockTime(message.timestamp)}
            {outbound && message.status === "DELIVERED" && " ✓✓"}
            {outbound && message.status === "READ" && " ✓✓"}
          </span>
        </div>
        {outbound && message.status === "FAILED" && (
          <div className="mt-1 text-right text-[10px] font-medium text-[var(--color-danger)]">
            ⚠ {t("notDelivered")}
          </div>
        )}
      </div>
    </div>
  );

  function MessageBody({ message }: { message: ChatMessage }) {
    if (
      (message.type === "IMAGE" || message.type === "STICKER") &&
      media?.url
    ) {
      return (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={media.url}
            alt={media.fileName ?? t("image")}
            className="max-w-xs rounded-lg"
          />
          {message.text ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
              {message.text}
            </p>
          ) : null}
        </div>
      );
    }

    if (message.type === "VIDEO" && media?.url) {
      return (
        <div>
          <video src={media.url} controls className="max-w-xs rounded-lg" />
          {message.text ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
              {message.text}
            </p>
          ) : null}
        </div>
      );
    }

    if (message.type === "AUDIO" && media?.url) {
      return <audio src={media.url} controls className="max-w-xs" />;
    }

    if (message.type === "DOCUMENT" && media?.url) {
      return (
        <a
          href={media.url}
          download={media.fileName ?? true}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 hover:bg-[var(--color-surface-2)]"
        >
          <span className="text-xl">📄</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-[var(--color-fg)]">
              {media.fileName ?? t("document")}
            </span>
            {media.size ? (
              <span className="block text-xs text-[var(--color-muted)]">
                {formatBytes(media.size)}
              </span>
            ) : null}
          </span>
        </a>
      );
    }

    if (message.type === "TEXT") {
      return (
        <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-fg)]">
          {message.text}
        </p>
      );
    }

    const labelMap: Record<string, string> = {
      LOCATION: t("location"),
      CONTACT: t("contact"),
      UNKNOWN: t("unsupported"),
    };
    return (
      <p className="text-sm italic text-[var(--color-muted)]">
        {labelMap[message.type] ?? message.text ?? t("unsupported")}
      </p>
    );
  }
}
