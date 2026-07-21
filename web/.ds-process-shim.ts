// Browser shim for the design-sync bundle: next/link and next/image reference
// process.env at module scope; define it before they evaluate.
(globalThis as { process?: unknown }).process ??= { env: { NODE_ENV: "production" } };
export {};
