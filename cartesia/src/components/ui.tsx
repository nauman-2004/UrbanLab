import type { ReactNode } from "react";
import type { EvidenceValue, VoiceMode } from "../types";

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel/90 ${className}`}>
      {title !== undefined && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function ModeBadge({ mode }: { mode: VoiceMode }) {
  return mode === "live" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-voice/40 bg-voice/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-voice">
      <span className="relative flex size-1.5">
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-voice" />
        <span className="relative size-1.5 rounded-full bg-voice" />
      </span>
      LIVE
    </span>
  ) : (
    <span className="rounded-full border border-unverified/40 bg-unverified/10 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-unverified">
      MOCK
    </span>
  );
}

/** Provenance chip for interview evidence: always "unverified". */
export function CartesiaTag({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-voice/40 bg-voice/10 px-1.5 py-px font-mono text-[10px] text-voice">
      <span aria-hidden className="size-1.5 rounded-full bg-voice" />
      Cartesia
      {!compact && <span className="text-unverified">· interview · ⚠ unverified</span>}
    </span>
  );
}

export function MissingTag({ label = "Missing" }: { label?: string }) {
  return (
    <span className="hatch-gap inline-flex items-center gap-1 rounded border border-gap/40 px-1.5 py-px font-mono text-[10px] text-gap">
      ? {label}
    </span>
  );
}

export function formatValue(v: EvidenceValue["value"] | null): string {
  if (v === null) return "?";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Level-driven audio activity bars (input = participant, output = agent). */
export function Waveform({ level, active, tone = "voice", bars = 28 }: { level: number; active: boolean; tone?: "voice" | "accent"; bars?: number }) {
  const shape = [0.35, 0.6, 0.85, 0.5, 1, 0.7, 0.4, 0.75, 0.95, 0.55, 0.3, 0.65, 0.9, 0.45];
  const color = tone === "voice" ? "bg-voice" : "bg-accent2";
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const h = active ? Math.max(0.08, Math.min(1, level * 1.4) * shape[(i * 5) % shape.length]) : 0.08;
        return <i key={i} className={`w-[3px] rounded-full transition-[height] duration-100 ${color} ${active ? "" : "opacity-30"}`} style={{ height: `${h * 100}%` }} />;
      })}
    </div>
  );
}
