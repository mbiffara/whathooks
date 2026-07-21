import { StatusBadge } from "web";

const ground: React.CSSProperties = {
  background: "var(--color-bg)",
  padding: 24,
  borderRadius: 12,
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  alignItems: "center",
};

/** Every WhatsApp session state, on the app's dark ground. */
export const AllStatuses = () => (
  <div style={ground}>
    <StatusBadge status="CONNECTED" />
    <StatusBadge status="QR" />
    <StatusBadge status="CONNECTING" />
    <StatusBadge status="PENDING" />
    <StatusBadge status="DISCONNECTED" />
    <StatusBadge status="LOGGED_OUT" />
  </div>
);

/** As used on the sessions page — inside a card row. */
export const InSessionCard = () => (
  <div style={{ background: "var(--color-bg)", padding: 24, borderRadius: 12 }}>
    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 420 }}>
      <div>
        <div style={{ fontWeight: 500 }}>Support line</div>
        <div style={{ fontSize: 14, color: "var(--color-muted)" }}>+56 9 5555 0134</div>
      </div>
      <StatusBadge status="CONNECTED" />
    </div>
  </div>
);
