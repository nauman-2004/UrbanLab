"use client";

import { deriveRow, fmt, type DerivedRow } from "@/lib/analysis";
import { toCsv } from "@/lib/csv";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, Gap, PropertyRow, Source, VariableKey } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { SourceDot } from "../ui/Provenance";

const COLS: { key: VariableKey | "ratio" | "per1k"; label: string; source: Source; fmt?: (n: number) => string }[] = [
  { key: "yearBuilt", label: "year_built", source: "costar", fmt: String },
  { key: "lotSf", label: "lot_sf", source: "costar" },
  { key: "surfaceSf", label: "surface_sf", source: "vexcel" },
  { key: "ratio", label: "surface_ratio", source: "derived" },
  { key: "garageStalls", label: "garage_stalls", source: "matterport" },
  { key: "offsiteSpaces", label: "offsite_spaces", source: "interview" },
  { key: "per1k", label: "stalls / 1k sf", source: "derived" },
];

const FRESH_MS = 1600;

function ValueCell({ cell, clock, format }: { cell?: Cell; clock: number; format?: (n: number) => string }) {
  if (!cell) return <td className="px-3 py-1 font-mono text-dim">—</td>;
  const fresh = clock - cell.at < FRESH_MS && clock >= cell.at;
  const self = cell.source === "interview";
  return (
    <td
      className={`px-3 py-1 font-mono whitespace-nowrap ${fresh ? "animate-flash" : ""} ${self ? (cell.verification === "unverified" ? "unverified-ring bg-voice/[0.07]" : "bg-voice/[0.1]") : ""}`}
      title={`${cell.evidence.ref}${cell.evidence.note ? ` — ${cell.evidence.note}` : ""}${self ? ` — ${cell.verification}` : ""}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <SourceDot source={cell.source} />
        {format ? format(cell.value) : fmt.int(cell.value)}
        {self && cell.verification === "unverified" && <span className="font-sans text-[9px] font-bold text-unverified">⚠ UNVERIFIED</span>}
        {self && cell.verification === "verified" && <span className="font-sans text-[9px] font-bold text-voice">✓</span>}
      </span>
    </td>
  );
}

function GapCell({ gap }: { gap: Gap }) {
  const label = { open: "MISSING", queued: "MISSING · queued", collecting: "calling…", filled: "", declined: "MISSING · declined" }[gap.status];
  return <td className="hatch-gap px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-gap shadow-[inset_0_0_0_1px_#f8717166]">▨ {label}</td>;
}

function DerivedCell({ value, format, warn }: { value?: number; format: (n?: number) => string; warn?: boolean }) {
  return (
    <td className="px-3 py-1 font-mono whitespace-nowrap text-soft">
      <span className="inline-flex items-center gap-1.5">
        <SourceDot source="derived" />
        {format(value)}
        {warn && value != null && <span className="text-[10px] text-unverified" title="Depends on an unverified self-reported value">⚠</span>}
      </span>
    </td>
  );
}

function Row({ row, d, gap, selected, onSelect, clock }: { row: PropertyRow; d: DerivedRow; gap?: Gap; selected: boolean; onSelect: () => void; clock: number }) {
  const c = row.cells;
  return (
    <tr onClick={onSelect} className={`cursor-pointer border-b border-[#1b2040] transition hover:bg-white/[0.03] ${selected ? "bg-accent/[0.08]" : ""}`}>
      <th scope="row" className="px-3 py-1 text-left font-medium whitespace-nowrap">
        <button type="button" onClick={onSelect} className="text-left hover:text-accent2">
          {row.info.name}
        </button>
      </th>
      <td className="px-2 py-1 text-[11px] text-muted">{d.era === "pre" ? "pre-1980" : d.era === "post" ? "post-2000" : "—"}</td>
      <ValueCell cell={c.yearBuilt} clock={clock} format={String} />
      <ValueCell cell={c.lotSf} clock={clock} />
      <ValueCell cell={c.surfaceSf} clock={clock} />
      <DerivedCell value={d.surfaceRatio} format={(n) => fmt.dec(n)} />
      <ValueCell cell={c.garageStalls} clock={clock} />
      {!c.offsiteSpaces && gap ? <GapCell gap={gap} /> : <ValueCell cell={c.offsiteSpaces} clock={clock} />}
      <DerivedCell value={d.stallsPer1k} format={(n) => fmt.dec(n)} warn={d.unverified} />
    </tr>
  );
}

export function DatasetTable({ activeId }: { activeId: string | null }) {
  const { state, select, clock } = useStudy();
  const rows = state.order.map((id) => state.rows[id]);
  const open = state.gaps.filter((g) => g.status !== "filled");
  const declined = open.some((g) => g.status === "declined");
  const unverified = rows.filter((r) => r.cells.offsiteSpaces?.verification === "unverified").length;

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `urbanlab-${state.studyId ?? "study"}-dataset.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="h-full">
      <CardHeader
        icon="grid"
        title="Dataset"
        aside={
          <span className="flex items-center gap-3">
            <span className="hidden sm:inline">
              {rows.length} rows · 7 variables · every value traceable to its source
              {unverified > 0 && <span className="text-unverified"> · {unverified} unverified</span>}
            </span>
            <button type="button" onClick={download} disabled={!rows.length} className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-40">
              <Icon name="download" className="size-3" /> CSV
            </button>
          </span>
        }
      />
      {open.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-gradient-to-r from-gap/10 to-transparent px-3.5 py-1.5 text-xs text-soft">
          <b className="text-gap">⚠ {open.length} evidence gap{open.length > 1 ? "s" : ""}</b>
          <span>
            offsite_spaces unknown for {open.map((g) => state.rows[g.propertyId]?.info.name).join(", ")}.{" "}
            {declined ? "Interviews declined: these rows are excluded from the supply comparison." : "Parking contracts aren't visible in records, aerials, or 3D scans."}
          </span>
        </div>
      )}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-semibold">Building</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">Era</th>
              {COLS.map((col) => (
                <th key={col.key} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  {col.label}
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-dim">
                    <SourceDot source={col.source} />
                    {col.key === "garageStalls" ? "Matterport" : col.key === "offsiteSpaces" ? "CoStar / Interview" : col.source === "derived" ? "derived" : col.source === "costar" ? "CoStar" : "Vexcel"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.info.id}
                row={row}
                d={deriveRow(row)}
                gap={state.gaps.find((g) => g.propertyId === row.info.id)}
                selected={row.info.id === activeId}
                onSelect={() => select(row.info.id)}
                clock={clock}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3.5 py-6 text-center text-xs text-dim">Rows fill in as the agent collects and measures each building.</p>}
      </div>
    </Card>
  );
}
