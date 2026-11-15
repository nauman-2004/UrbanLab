import type { Cell, CellScalar, Method, Source, Verification } from "@/lib/types";

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
export function CellValue({ cell, format }: { cell?: Cell<CellScalar>; format?: (n: number) => string }) {
  if (!cell) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SourceDot source={cell.source} />
      {formatValue(cell.value, format)}
    </span>
  );
}

/** Display text for a recorded value. Numbers keep their real value (a recorded 0 stays 0). */
export function formatValue(value: CellScalar, format?: (n: number) => string): string {
  if (typeof value === "number") return format ? format(value) : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return value;
}

/** Text shown wherever a value is absent. Never "0", "undefined" or "null". */
export const NOT_AVAILABLE = "Not available";

/**
 * How a value was obtained. Uses the backend's provenance when present, otherwise
 * infers it from the contract: interview => self-reported, "MODEL ESTIMATE" note => estimate,
 * "computed" note or derived source => calculated, else a recorded value.
 */
export function methodOf(cell: Cell<CellScalar>): Method {
  if (cell.provenance?.method) return cell.provenance.method;
  if (cell.source === "interview") return "self_reported";
  const note = cell.evidence.note ?? "";
  if (note.startsWith("MODEL ESTIMATE")) return "model_estimate";
  if (note.startsWith("computed") || cell.source === "derived") return "computed";
  return "observed";
}

const METHOD_META: Record<Method, { label: (s: Source) => string; cls: string; title: string }> = {
  observed: {
    label: (s) => (s === "costar" ? "REPORTED" : "RECORDED"),
    cls: "bg-costar/15 text-costar",
    title: "Recorded by the data provider (e.g. CoStar-reported)",
  },
  computed: { label: () => "CALCULATED", cls: "bg-derived/15 text-derived", title: "Calculated by UrbanLab from recorded inputs" },
  model_estimate: {
    label: () => "ESTIMATE",
    cls: "bg-vexcel/15 text-vexcel",
    title: "Produced by a model (e.g. aerial-image segmentation); not a survey measurement",
  },
  self_reported: { label: () => "INTERVIEW", cls: "bg-voice/15 text-voice", title: "Self-reported in an interview" },
};

/** Small badge distinguishing reported, calculated, estimated and interview-derived values. */
export function MethodBadge({ cell }: { cell: Cell<CellScalar> }) {
  const m = methodOf(cell);
  const meta = METHOD_META[m];
  const conf = cell.provenance?.confidence ?? cell.evidence.confidence;
  return (
    <span title={meta.title} className={`inline-flex items-center rounded-[4px] px-1 py-px text-[9px] font-bold tracking-wide ${meta.cls}`}>
      {meta.label(cell.source)}
      {m === "model_estimate" && conf != null ? ` · ${Math.round(conf * 100)}%` : ""}
    </span>
  );
}
