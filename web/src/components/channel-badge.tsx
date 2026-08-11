/**
 * Marks which channel a thread arrived on.
 *
 * Renders nothing for WhatsApp. It is the default and the overwhelming
 * majority of threads, so badging it would put a label on almost every row to
 * convey nothing — the badge is only useful where it says something surprising.
 */
export function ChannelBadge({
  channel,
  className = "",
}: {
  channel: "WHATSAPP" | "INSTAGRAM" | undefined;
  className?: string;
}) {
  if (channel !== "INSTAGRAM") return null;
  return (
    <span
      title="Instagram"
      aria-label="Instagram"
      className={`inline-grid shrink-0 place-items-center rounded-[5px] bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px] ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.6" cy="6.4" r="1.1" fill="#fff" stroke="none" />
      </svg>
    </span>
  );
}
