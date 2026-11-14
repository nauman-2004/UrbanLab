import type { SVGProps } from "react";

const PATHS = {
  logo: "M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13M14 10h2M14 14h2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  report: "M6 3h9l4 4v14H6zM9 12h7M9 16h7",
  wave: "M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4",
  grid: "M4 4h16v16H4zM4 10h16M10 4v16",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  pin: "M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  sparkle: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z",
  shield: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
  mic: "M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3",
  speaker: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6",
  phoneOff: "M3 15c5-5 13-5 18 0l-3 2-3-2v-2a10 10 0 0 0-6 0v2l-3 2z",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  close: "M6 6l12 12M18 6L6 18",
  play: "M7 4l13 8-13 8z",
  pause: "M7 4h4v16H7zM13 4h4v16h-4z",
  restart: "M4 4v6h6M4.5 14a8 8 0 1 0 1.9-7.9L4 10",
  check: "M5 12l5 5L20 7",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  building: "M4 21V5l8-2v18M12 21V9l8 2v10M3 21h18",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  download: "M12 4v12M6 10l6 6 6-6M4 20h16",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-4", ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const filled = name === "play" || name === "pause" || name === "phoneOff";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
