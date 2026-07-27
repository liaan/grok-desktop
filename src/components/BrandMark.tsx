import { useId } from "react";

/** App mark: Grok / xAI desktop shell — window chrome + spark constellation. */
export function BrandMark({
  size = 32,
  className = "brand-mark",
  title = "Grok Desktop",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const shellId = `gd-shell-${uid}`;
  const glowId = `gd-glow-${uid}`;
  const softId = `gd-soft-${uid}`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={shellId} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C4B5FD" />
          <stop offset="0.45" stopColor="#7C3AED" />
          <stop offset="1" stopColor="#1E1B4B" />
        </linearGradient>
        <linearGradient id={glowId} x1="16" y1="10" x2="16" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E9D5FF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#A78BFA" stopOpacity="0.55" />
        </linearGradient>
        <filter id={softId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Desktop app shell */}
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill={`url(#${shellId})`} />
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
      />

      {/* Title-bar chrome (GUI cue) */}
      <rect x="5" y="5.5" width="22" height="6" rx="2" fill="rgba(12,12,18,0.45)" />
      <circle cx="8.2" cy="8.5" r="1.05" fill="#F87171" opacity="0.9" />
      <circle cx="11.4" cy="8.5" r="1.05" fill="#FBBF24" opacity="0.9" />
      <circle cx="14.6" cy="8.5" r="1.05" fill="#34D399" opacity="0.9" />

      {/* Content pane */}
      <rect
        x="5"
        y="13"
        width="22"
        height="13.5"
        rx="2.5"
        fill="rgba(12,12,18,0.5)"
        stroke="rgba(255,255,255,0.08)"
      />

      {/* Grok spark / constellation (xAI geometric feel) */}
      <g filter={`url(#${softId})`} transform="translate(16 19.5)">
        <path
          d="M0 -5.2 L1.15 -1.15 L5.2 0 L1.15 1.15 L0 5.2 L-1.15 1.15 L-5.2 0 L-1.15 -1.15 Z"
          fill={`url(#${glowId})`}
        />
        <circle cx="0" cy="0" r="1.35" fill="#F8FAFC" />
        <circle cx="4.2" cy="-3.1" r="0.7" fill="#E9D5FF" opacity="0.85" />
        <circle cx="-3.8" cy="3.2" r="0.55" fill="#C4B5FD" opacity="0.8" />
      </g>
    </svg>
  );
}

export function Spinner({ size = 18, className = "spinner" }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
