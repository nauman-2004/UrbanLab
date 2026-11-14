import type { Cell, Source, Verification } from "@/lib/types";

export const SOURCE_META: Record<Source, { label: string; color: string; text: string; bg: string }> = {
  costar: { label: "CoStar", color: "var(--color-costar)", text: "text-costar", bg: "bg-costar" },
  vexcel: { label: "Vexcel", color: "var(--color-vexcel)", text: "text-vexcel", bg: "bg-vexcel" },
  matterport: { label: "Matterport", color: "var(--color-mport)", text: "text-mport", bg: "bg-mport" },
  interview: { label: "Interview", color: "var(--color-voice)", text: "text-voice", bg: "bg-voice" },
  derived: { label: "derived", color: "var(--color-derived)", text: "text-derived", bg: "bg-derived" },
};

export function SourceDot({ source, className = "" }: { source: Source; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-[2px] ${SOURCE_META[source].bg} ${className}`} />;
}

export function SourceTag({ source, children }: { source: Source; children?: string }) {
  return (
    <span className={`rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.07em] text-[#0b0f1e] ${SOURCE_META[source].bg}`}>
      {(children ?? SOURCE_META[source].label).toUpperCase()}
    </span>
  );
}

/** Chip used for variable names; colored by the source expected to provide it. */
export function VarChip({ source, children }: { source: Source; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line2 bg-[#0c1023] px-1.5 py-0.5 font-mono text-[10.5px] text-soft">
      <SourceDot source={source} />
      {children}
    </span>
  );
}

/** The verification state of a self-reported value. Never hidden. */
export function VerificationBadge({ verification, compact }: { verification: Verification; compact?: boolean }) {
  if (verification === "observed") return null;
  if (verification === "verified")
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] bg-voice/15 px-1 py-px text-[9px] font-bold tracking-wide text-voice">
        ✓ {compact ? "VER" : "VERIFIED"}
      </span>
    );
  return (
    <span
      title="Self-reported in an interview — not yet independently confirmed"
      className="inline-flex items-center gap-1 rounded-[4px] bg-unverified/15 px-1 py-px text-[9px] font-bold tracking-wide text-unverified"
    >
      ⚠ {compact ? "UNVERIFIED" : "UNVERIFIED · SELF-REPORTED"}
    </span>
  );
}

/** A value with its provenance dot (used in tables and the property panel). */
export function CellValue({ cell, format }: { cell?: Cell; format?: (n: number) => string }) {
  if (!cell) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SourceDot source={cell.source} />
      {format ? format(cell.value) : cell.value.toLocaleString("en-US")}
    </span>
  );
}
