import { useTranslations } from "next-intl";
import type { ChatMessage } from "./types";
import { clockTime, formatBytes } from "./utils";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const t = useTranslations("dash.messages.bubble");
  const outbound = message.fromMe || message.direction === "OUTBOUND";
  const media = message.media;

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 ${
          outbound
            ? "border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/15"
            : "border border-[var(--color-border)] bg-[var(--color-surface-2)]"
        }`}
      >
        {outbound && message.source && message.source !== "HUMAN" && (
          <div className="mb-0.5 text-[10px] font-semibold text-[var(--color-brand)]">
            {message.source === "AGENT"
              ? `🤖 ${message.agentName ?? t("agent")}`
              : "⚙ API"}
          </div>
        )}
        <MessageBody message={message} />
        <div className="mt-1 text-right text-[10px] text-[var(--color-muted)]">
          {clockTime(message.timestamp)}
        </div>
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
