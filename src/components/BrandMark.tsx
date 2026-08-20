/** App mark: monochrome Grok / AI spark (black + white). */
export function BrandMark({
  size = 32,
  className = "brand-mark",
  title = "Grok Desktop",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
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
      {/* Plate */}
      <rect width="32" height="32" rx="7.5" fill="#0A0A0A" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="7.25"
        stroke="#FFFFFF"
        strokeOpacity="0.14"
        strokeWidth="1"
      />

      {/* Outer orbit */}
      <circle
        cx="16"
        cy="16"
        r="10"
        stroke="#FFFFFF"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
      {/* Arc highlight */}
      <path
        d="M16 6 A10 10 0 0 1 26 16"
        stroke="#FFFFFF"
        strokeOpacity="0.85"
        strokeWidth="1.35"
        strokeLinecap="round"
      />

      {/* Grok spark */}
      <path
        d="M16 8.2 L17.35 13.65 L22.8 15 L17.35 16.35 L16 21.8 L14.65 16.35 L9.2 15 L14.65 13.65 Z"
        fill="#FFFFFF"
      />
      {/* Core node */}
      <circle cx="16" cy="15" r="1.55" fill="#0A0A0A" />
      <circle cx="16" cy="15" r="0.85" fill="#FFFFFF" />

      {/* Constellation nodes */}
      <circle cx="26" cy="16" r="1.15" fill="#FFFFFF" />
      <circle cx="9.5" cy="23.2" r="0.85" fill="#FFFFFF" fillOpacity="0.9" />
      <circle cx="11.2" cy="8.6" r="0.7" fill="#FFFFFF" fillOpacity="0.75" />
    </svg>
  );
}

/** Circular arrows — refresh a listing. */
export function RefreshIcon({
  size = 14,
  className = "refresh-icon",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M13.25 6.1A5.25 5.25 0 0 0 4.2 5.15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13.25 3.15v2.95h-2.95"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.75 9.9A5.25 5.25 0 0 0 11.8 10.85"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M2.75 12.85V9.9h2.95"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
