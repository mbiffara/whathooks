// design-sync entry: the components synced to Claude Design (see
// .design-sync/config.json). whathooks has no component package — this barrel
// is the bundle entry for the thin design-system sync.
import "./.ds-process-shim";
export { Logo } from "./src/components/logo";
export { StatusBadge } from "./src/components/status-badge";
export { UpgradeModal } from "./src/components/upgrade-modal";
