import type { ReactNode } from "react";

/**
 * Small stroke glyphs for navigation affordances (chevrons, panel toggles),
 * drawn in the same style as the sidebar icons (currentColor, 1.8 stroke).
 * Use these instead of text arrows ("→", "«") in app chrome.
 */
export type GlyphName =
  | "chevronRight"
  | "chevronLeft"
  | "panelCollapse"
  | "panelExpand"
  | "trash";

const PATHS: Record<GlyphName, ReactNode> = {
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  panelCollapse: <path d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />,
  panelExpand: <path d="M13 7l5 5-5 5M6 7l5 5-5 5" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
};

export function Glyph({
  name,
  size = 16,
  className,
}: {
  name: GlyphName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
