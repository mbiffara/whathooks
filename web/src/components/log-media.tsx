import type { MessageLog } from "@/lib/types";

/**
 * Compact media preview for the message log: image thumbnail (opens the
 * full file in a new tab), inline audio player, or a typed file link.
 */
export function LogMedia({
  media,
}: {
  media: NonNullable<MessageLog["media"]>;
}) {
  if (media.mimeType.startsWith("image/")) {
    return (
      <a href={media.url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.fileName ?? "image"}
          className="h-10 w-10 rounded-md object-cover"
        />
      </a>
    );
  }
  if (media.mimeType.startsWith("audio/")) {
    return <audio src={media.url} controls className="h-8 max-w-45" />;
  }
  const icon = media.mimeType.startsWith("video/") ? "🎥" : "📄";
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"
    >
      {icon} {media.fileName ?? media.mimeType}
    </a>
  );
}
