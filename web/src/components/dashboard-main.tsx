"use client";

import { usePathname } from "next/navigation";

/**
 * Dashboard content area. Messages is a full-bleed app surface (uses the whole
 * width/height); every other page renders in a centered, padded column.
 */
export function DashboardMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = pathname.startsWith("/dashboard/messages");

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      {fullBleed ? (
        children
      ) : (
        <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
      )}
    </main>
  );
}
