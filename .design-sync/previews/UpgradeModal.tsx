import { UpgradeModal } from "web";

/** The paid-plan-required dialog, open, over the app's dark ground. */
export const Open = () => (
  <div style={{ background: "var(--color-bg)", minHeight: 480 }}>
    <UpgradeModal open onClose={() => {}} action="Connecting a WhatsApp number" />
  </div>
);
