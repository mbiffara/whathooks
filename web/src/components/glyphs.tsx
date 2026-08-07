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
  | "trash"
  | "link"
  | "unlink";

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
  link: (
    <>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <path d="M8 12h8" />
    </>
  ),
  unlink: (
    <>
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M8 2v3M2 8h3M16 19v3M19 16h3" />
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
