const HEIGHTS = [0.3, 0.5, 0.8, 0.45, 0.95, 0.6, 0.3, 0.7, 1, 0.5, 0.25, 0.4, 0.85, 0.55, 0.35, 0.75, 0.45, 0.2, 0.55, 0.9, 0.4, 0.65, 0.3, 0.5, 0.8, 0.35, 0.2, 0.45, 0.6, 0.25];

/** Deterministic animated waveform. `active=false` renders a flat, idle line. */
export function Waveform({ bars = 48, height = 24, active = true }: { bars?: number; height?: number; active?: boolean }) {
  return (
    <div className="flex items-center gap-[2px]" style={{ height }} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          className={`w-[3px] origin-center rounded-full bg-gradient-to-b from-accent2 to-voice ${active ? "animate-wave" : "opacity-30"}`}
          style={{
            height: active ? Math.max(3, HEIGHTS[i % HEIGHTS.length] * height) : 3,
            animationDelay: `${(i % 7) * 0.09}s`,
          }}
        />
      ))}
    </div>
  );
}
