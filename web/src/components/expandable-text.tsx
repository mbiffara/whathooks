"use client";

import { useState } from "react";

/**
 * One-line truncated text that expands to the full (wrapped) content on
 * click, and collapses again on a second click.
 */
export function ExpandableText({
  text,
  collapsedClassName = "max-w-xs truncate",
}: {
  text: string;
  collapsedClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      title={expanded ? undefined : text}
      className={`block cursor-pointer ${
        expanded
          ? "max-w-md whitespace-pre-wrap break-words"
          : collapsedClassName
      }`}
    >
      {text}
    </span>
  );
}
