"use client";

import { useEffect, useState } from "react";

/**
 * The landing's flow strip: highlights one node at a time, left to right,
 * like a message travelling through the flow. Purely decorative motion;
 * static (no stepping) when the user prefers reduced motion.
 */
export function FlowPipeline({ nodes }: { nodes: string[] }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setActive((a) => (a + 1) % nodes.length),
      1600,
    );
    return () => clearInterval(id);
  }, [nodes.length]);

  return (
    <div className="flex min-w-[640px] items-center gap-3">
      {nodes.map((label, i) => (
        <div key={label} className="flex flex-1 items-center gap-3">
          {i > 0 && (
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              className={`shrink-0 transition-colors duration-500 ${
                active === i
                  ? "text-[var(--color-brand)]"
                  : "text-[var(--color-muted)]"
              }`}
            >
              <path
                d="M4 12h16m0 0l-5-5m5 5l-5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <div
            className={`flex-1 rounded-xl border px-4 py-3 text-center text-sm font-medium transition-[transform,box-shadow,border-color,background-color] duration-500 ${
              active === i
                ? "scale-[1.04] border-[var(--color-brand)] bg-[var(--color-brand)]/10 shadow-[0_0_24px_-8px_var(--color-brand)]"
                : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
            }`}
          >
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}
