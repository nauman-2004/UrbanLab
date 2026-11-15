import type { Source } from "@/lib/types";

export const SOURCE_META: Record<Source, { label: string; color: string; text: string; bg: string }> = {
  costar: { label: "CoStar", color: "var(--color-costar)", text: "text-costar", bg: "bg-costar" },
  vexcel: { label: "Vexcel", color: "var(--color-vexcel)", text: "text-vexcel", bg: "bg-vexcel" },
};

const meta = (source: string) => SOURCE_META[source as Source] ?? { label: source, color: "var(--color-derived)", text: "text-derived", bg: "bg-derived" };

export function SourceDot({ source, className = "" }: { source: string; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 rounded-[2px] ${meta(source).bg} ${className}`} />;
}

export function SourceTag({ source, children }: { source: string; children?: string }) {
  return (
    <span className={`rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold tracking-[0.07em] text-[#0b0f1e] ${meta(source).bg}`}>
      {(children ?? meta(source).label).toUpperCase()}
    </span>
  );
}

/** Chip used for variable names; colored by the source expected to provide it. */
export function VarChip({ source, children, title }: { source: string; children: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-md border border-line2 bg-[#0c1023] px-1.5 py-0.5 font-mono text-[10.5px] text-soft">
      <SourceDot source={source} />
      {children}
    </span>
  );
}

export function StubBadge({ children = "STUB" }: { children?: string }) {
  return (
    <span
      title="Placeholder integration: this value comes from sample data or a scripted stub, not the real service"
      className="inline-flex items-center rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] font-bold tracking-wide text-amber-300"
    >
      {children}
    </span>
  );
}
