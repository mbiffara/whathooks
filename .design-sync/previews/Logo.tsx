import { Logo } from "web";

/** Brand wordmark on the app's dark ground. (The logo image asset lives in
 * the app's public/ dir and does not ship with the bundle.) */
export const Wordmark = () => (
  <div style={{ background: "var(--color-bg)", color: "var(--color-fg)", padding: 24, borderRadius: 12, display: "inline-block" }}>
    <Logo />
  </div>
);
