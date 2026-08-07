export function relativeTime(iso: string | null, nowLabel = "now"): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return nowLabel;
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function typeEmoji(type: string | null): string {
  switch (type) {
    case "IMAGE":
      return "📷";
    case "VIDEO":
      return "🎥";
    case "AUDIO":
      return "🎤";
    case "DOCUMENT":
      return "📄";
    case "STICKER":
      return "🎯";
    case "LOCATION":
      return "📍";
    case "CONTACT":
      return "👤";
    default:
      return "";
  }
}

export function previewText(
  lastMessageText: string | null,
  lastMessageType: string | null,
  labels?: Record<string, string>,
): string {
  const emoji =
    lastMessageType && lastMessageType !== "TEXT"
      ? typeEmoji(lastMessageType)
      : "";
  if (lastMessageText && lastMessageText.trim()) {
    return emoji ? `${emoji} ${lastMessageText}` : lastMessageText;
  }
  if (emoji) {
    const fallback: Record<string, string> = {
      IMAGE: "Photo",
      VIDEO: "Video",
      AUDIO: "Audio",
      DOCUMENT: "Document",
      STICKER: "Sticker",
      LOCATION: "Location",
      CONTACT: "Contact",
    };
    const label =
      labels?.[lastMessageType ?? ""] ??
      fallback[lastMessageType ?? ""] ??
      labels?.DEFAULT ??
      "Message";
    return `${emoji} ${label}`;
  }
  return "";
}

export function formatBytes(size: number | null): string {
  if (!size || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = size;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * The contact's number for display. Prefers the real phone number when
 * WhatsApp addressed the thread by LID; returns null for a LID we could not
 * resolve, since those digits are an internal identity, not a phone number.
 */
export function contactNumber(c: {
  contact: string | null;
  phoneNumber: string | null;
  remoteJid: string | null;
}): string | null {
  if (c.phoneNumber) return `+${c.phoneNumber}`;
  // Redacted for operators, or a LID we could not resolve: no number to show.
  if (!c.contact || c.remoteJid?.endsWith("@lid")) return null;
  return `+${c.contact}`;
}
