import type { ReactNode } from "react";

// Only http(s) and www. are matched, so a message can never produce a
// javascript: or data: href. Everything else stays plain text.
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Drop trailing characters that belong to the sentence, not the URL:
 * "see https://a.com/x." or "(https://a.com/x)". A closing bracket is kept
 * when the URL opened it itself, e.g. a Wikipedia link ending in "_(band)".
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (".,;:!?".includes(ch)) {
      end--;
      continue;
    }
    if (ch === ")" || ch === "]") {
      const open = ch === ")" ? "(" : "[";
      const slice = url.slice(0, end);
      const opened = slice.split(open).length - 1;
      const closed = slice.split(ch).length - 1;
      if (closed > opened) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Message text with bare URLs turned into links, always opening in a new tab
 * so the inbox is never navigated away from. Returns nodes rather than HTML:
 * message bodies are attacker-controlled, so they are never parsed as markup.
 */
export function Linkify({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index;
    const url = trimTrailing(match[0]);
    if (!url) continue;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(
      <a
        key={start}
        href={url.toLowerCase().startsWith("www.") ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        // Stop the click from reaching bubble-level handlers.
        onClick={(e) => e.stopPropagation()}
        className="underline underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (nodes.length === 0) return <>{text}</>;
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}
