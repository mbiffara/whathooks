# whathooks conventions

whathooks is a **dark-first** product: every screen sits on `--color-bg` (#0b0f0e) with light foreground text and WhatsApp-green brand accents. No provider or wrapper is needed — `styles.css` styles `body` (dark background, `--color-fg` text, Geist font). Keep that dark ground; never design on white.

## Styling idiom

Tailwind-compiled CSS **with a fixed vocabulary**. Important constraint: the stylesheet ships only the utility classes the whathooks app actually uses — arbitrary Tailwind classes you invent (e.g. `bg-teal-300`, `p-7`) will NOT resolve. Style with, in order of preference:

1. **The component classes** (always available): `btn` + `btn-primary` (green fill, black text) / `btn-ghost` (bordered) / `btn-danger` (red outline); `card` (rounded-xl, `--color-surface`, bordered, padded); `input`; `label`; `badge` (rounded-full pill, pair with a color like `bg-[var(--color-brand)]/15 text-[var(--color-brand)]`); `pill` (mono code chip in `--color-accent`).
2. **CSS variables** via inline style or `var()` in arbitrary-value classes: `--color-bg`, `--color-surface`, `--color-surface-2` (inputs, nested surfaces), `--color-border`, `--color-muted` (secondary text), `--color-fg`, `--color-brand` (#25d366), `--color-brand-dark`, `--color-accent` (#34e07e). Semantic states use Tailwind palette vars that ship: amber (pending/warning), red (danger), emerald (success), orange, sky.
3. **Common layout utilities** (these ship): `flex`, `grid`, `items-center`, `justify-between`, `justify-center`, `gap-1`–`gap-8`, `p-2`–`p-6`, `px-1`–`px-8`, `mt-1`–`mt-12`, `rounded-md/lg/xl/full`, `text-xs/sm/lg/xl/2xl`, `font-medium/semibold/bold/mono`, `w-full`, `border`. For anything else use inline styles — never invent utility names.

Typography: Geist (sans) and Geist Mono, loaded by `styles.css`. Code-ish identifiers (IDs, API keys, URLs) render in `pill` or `font-mono` with `--color-accent`.

## Components

- `StatusBadge` — WhatsApp session state pill; `status` is one of `CONNECTED | QR | CONNECTING | PENDING | DISCONNECTED | LOGGED_OUT`.
- `UpgradeModal` — "paid plan required" dialog: `open`, `onClose`, optional `action` ("Connecting a WhatsApp number").
- `Logo` — avoid: its image asset doesn't ship (renders a broken image). For the brand mark, use the text wordmark instead: `<span style={{fontWeight:600}}><span style={{color:"var(--color-brand)"}}>●</span> whathooks</span>`.

## Where the truth lives

Read `styles.css` and its `_ds_bundle.css` import before styling — it defines every class and token named above. Per-component API/usage: `components/general/<Name>/<Name>.d.ts` and `.prompt.md`.

## Idiomatic snippet

```jsx
<div style={{ background: "var(--color-bg)", minHeight: "100vh", padding: 24 }}>
  <div className="card" style={{ maxWidth: 420 }}>
    <div className="flex items-center justify-between">
      <div>
        <div className="font-medium">Support line</div>
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>+56 9 5555 0134</div>
      </div>
      <StatusBadge status="CONNECTED" />
    </div>
    <button className="btn btn-primary mt-4 w-full">Open conversation</button>
  </div>
</div>
```
