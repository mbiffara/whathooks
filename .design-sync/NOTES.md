# design-sync notes — whathooks

- whathooks is an app monorepo, NOT a component-library repo: no Storybook, no
  component package, no dist/. Shape is `package`, driven off `web/`.
- User chose a THIN sync (2026-07-21): tokens + fonts + CSS utility vocabulary
  from web/src/app/globals.css, plus only the portable components
  (Logo, StatusBadge, UpgradeModal). App-chrome components (dashboard-nav,
  org-switcher, site-header/footer, dashboard-main, messages/*) are excluded —
  they depend on next-auth/next navigation and aren't design-system parts.
- The real design language is the utility-class vocabulary (btn-primary,
  btn-ghost, btn-danger, card, input, label, pill, badge) + CSS variables
  (--color-brand #25d366 etc.) on a dark ground — conventions.md should carry it.

## Build mechanics (2026-07-21 first sync)
- Entry is a hand-authored barrel `web/.ds-entry.tsx` (no dist; converter's
  node_modules/<pkg> lookup can't work in the app's own repo). It imports
  `web/.ds-process-shim.ts` FIRST — next/link + next/image reference
  `process.env` at module scope and the browser bundle has no `process`.
- CSS must be COMPILED before the converter runs (globals.css is Tailwind v4
  source with @apply): run cfg.buildCmd. Output lands in web/.ds-css/ (gitignored).
- Fonts: Geist via Google Fonts @import in .design-sync/fonts.css (prepended by
  buildCmd) — [FONT_REMOTE] is expected, not a problem.
- next/link renders fine outside Next (UpgradeModal verified) — no router shim needed.
- Playwright: macOS cache at ~/Library/Caches/ms-playwright has chromium-1217
  → playwright 1.59.0 (installed in .ds-sync).

## Known render warns
- Logo/Wordmark: broken <img> (public/logo-mark.png doesn't ship) — user
  explicitly chose to include Logo anyway (2026-07-21). Graded good with note.

## Re-sync risks
- The compiled CSS only contains utility classes used in web/src at compile
  time — new app classes appear on rebuild, but conventions.md's "available
  utilities" list can drift; re-validate it against _ds_bundle.css each sync.
- fonts.css fetches Geist from Google Fonts at runtime — network-dependent.
- The barrel entry must be kept in sync with the scoped component set by hand;
  adding a component = add to .ds-entry.tsx + componentSrcMap + author preview.
- StatusBadge imports WaStatus from @/lib/types — if that union changes, the
  preview's status sweep and the .d.ts drift together; re-check on type edits.
