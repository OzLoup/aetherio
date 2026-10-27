export const APP_NAME = "AetherIO";

interface BrandLogoProps {
  size?: "sm" | "lg";
  /** "row" (icon beside wordmark, header) or "col" (icon above, centered hero). */
  layout?: "row" | "col";
  className?: string;
}

const SIZES = {
  sm: { mark: "size-8", text: "text-lg" },
  lg: { mark: "size-16", text: "text-3xl" },
} as const;

/** The AetherIO mark: a play button inside an orbit (same art as the app
 * icon, desktop/build/icon.svg, and public/favicon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aio-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#241a46" />
          <stop offset="1" stopColor="#0c0a19" />
        </linearGradient>
        <linearGradient id="aio-fg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a98bff" />
          <stop offset="1" stopColor="#4f8dfb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#aio-bg)" />
      <ellipse cx="32" cy="32" rx="25" ry="10.5" fill="none" stroke="url(#aio-fg)" strokeWidth="2.6" opacity=".55" transform="rotate(-24 32 32)" />
      <path d="M26 21.5v21a1.6 1.6 0 0 0 2.4 1.4l17-10.5a1.6 1.6 0 0 0 0-2.8l-17-10.5A1.6 1.6 0 0 0 26 21.5Z" fill="url(#aio-fg)" />
      <circle cx="51.5" cy="21" r="2.6" fill="#c9b8ff" />
    </svg>
  );
}

export function BrandLogo({ size = "sm", layout = "row", className }: BrandLogoProps) {
  const s = SIZES[size];
  const layoutClass = layout === "col" ? "flex-col gap-3" : "flex-row gap-2";
  return (
    <div className={`flex items-center ${layoutClass} ${className ?? ""}`}>
      <BrandMark className={`${s.mark} shrink-0 drop-shadow-sm`} />
      <span className={`brand-wordmark ${s.text}`}>{APP_NAME}</span>
    </div>
  );
}
