"use client";

import { deriveRow, fmt, type DerivedRow } from "@/lib/analysis";
import { toCsv } from "@/lib/csv";
import { useStudy } from "@/lib/state/StudyProvider";
import { varLabel } from "@/lib/state/reducer";
import type { Cell, CellScalar, Gap, PropertyRow, Source, VariableKey } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { formatValue, methodOf, SourceDot, SOURCE_META } from "../ui/Provenance";

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

function ValueCell({ cell, clock, format, gap }: { cell?: Cell<CellScalar>; clock: number; format?: (n: number) => string; gap?: Gap }) {
  if (!cell && gap) return <GapCell gap={gap} />;
  if (!cell) return <td className="px-3 py-1 font-mono text-dim">—</td>;
  const method = methodOf(cell);
  const fresh = clock - cell.at < FRESH_MS && clock >= cell.at;
  const self = cell.source === "interview";
  return (
    <td
      className={`px-3 py-1 font-mono whitespace-nowrap ${fresh ? "animate-flash" : ""} ${self ? (cell.verification === "unverified" ? "unverified-ring bg-voice/[0.07]" : "bg-voice/[0.1]") : ""}`}
      title={`${cell.evidence.ref}${cell.evidence.note ? ` — ${cell.evidence.note}` : ""}${self ? ` — ${cell.verification}` : ""}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <SourceDot source={cell.source} />
        {typeof cell.value === "number" ? (format ? format(cell.value) : fmt.int(cell.value)) : formatValue(cell.value)}
        {method === "model_estimate" && <span className="font-sans text-[9px] font-bold text-vexcel" title="Model estimate, not a survey measurement">EST</span>}
        {self && cell.verification === "unverified" && <span className="font-sans text-[9px] font-bold text-unverified">⚠ UNVERIFIED</span>}
        {self && cell.verification === "verified" && <span className="font-sans text-[9px] font-bold text-voice">✓</span>}
      </span>
    </td>
  );
}

function GapCell({ gap }: { gap: Gap }) {
  const label = { open: "MISSING", queued: "MISSING · queued", collecting: "calling…", filled: "", declined: "MISSING · declined" }[gap.status];
  return <td title={gap.reason} className="hatch-gap px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-gap shadow-[inset_0_0_0_1px_#f8717166]">▨ {label}</td>;
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

type GapLookup = (variable: string) => Gap | undefined;

function Row({ row, d, gapOf, selected, onSelect, clock }: { row: PropertyRow; d: DerivedRow; gapOf: GapLookup; selected: boolean; onSelect: () => void; clock: number }) {
  const c = row.cells;
  return (
    <tr onClick={onSelect} className={`cursor-pointer border-b border-[#1b2040] transition hover:bg-white/[0.03] ${selected ? "bg-accent/[0.08]" : ""}`}>
      <th scope="row" className="px-3 py-1 text-left font-medium whitespace-nowrap">
        <button type="button" onClick={onSelect} className="text-left hover:text-accent2">
          {row.info.name}
        </button>
      </th>
      <td className="px-2 py-1 text-[11px] text-muted">{d.era === "pre" ? "pre-1980" : d.era === "post" ? "post-2000" : "—"}</td>
      <ValueCell cell={c.yearBuilt} clock={clock} format={String} gap={gapOf("yearBuilt")} />
      <ValueCell cell={c.lotSf} clock={clock} gap={gapOf("lotSf")} />
      <ValueCell cell={c.surfaceSf} clock={clock} gap={gapOf("surfaceSf")} />
      <DerivedCell value={d.surfaceRatio} format={(n) => fmt.dec(n)} />
      <ValueCell cell={c.garageStalls} clock={clock} gap={gapOf("garageStalls")} />
      <ValueCell cell={c.offsiteSpaces} clock={clock} gap={gapOf("offsiteSpaces")} />
      <DerivedCell value={d.stallsPer1k} format={(n) => fmt.dec(n)} warn={d.unverified} />
    </tr>
  );
}

/** Generic row for any research question: one column per study variable. */
function GenericRow({ row, cols, gapOf, selected, onSelect, clock }: { row: PropertyRow; cols: Col[]; gapOf: GapLookup; selected: boolean; onSelect: () => void; clock: number }) {
  return (
    <tr onClick={onSelect} className={`cursor-pointer border-b border-[#1b2040] transition hover:bg-white/[0.03] ${selected ? "bg-accent/[0.08]" : ""}`}>
      <th scope="row" className="px-3 py-1 text-left font-medium whitespace-nowrap">
        <button type="button" onClick={onSelect} className="text-left hover:text-accent2">
          {row.info.name}
        </button>
      </th>
      <td className="px-2 py-1 text-[11px] whitespace-nowrap text-muted">{row.info.city ?? "—"}</td>
      {cols.map((col) => (
        <ValueCell key={col.key} cell={row.cells[col.key]} clock={clock} gap={gapOf(col.key)} format={col.key === "yearBuilt" || col.key.startsWith("year_") ? String : (n) => formatValue(n)} />
      ))}
    </tr>
  );
}

interface Col {
  key: VariableKey;
  label: string;
  source: Source;
}

const PARKING_KEYS = ["yearBuilt", "surfaceSf"];

/** The parking template layout applies when the plan is the parking study; otherwise columns come from the plan. */
function studyColumns(plan: { variables: { key: VariableKey; label: string; source: Source }[] } | null, rows: PropertyRow[]): Col[] | null {
  const keys = plan?.variables.map((v) => v.key) ?? [];
  if (!plan || PARKING_KEYS.every((k) => keys.includes(k))) return null;
  const cols: Col[] = plan.variables.map((v) => ({ key: v.key, label: v.label, source: v.source }));
  for (const r of rows)
    for (const [k, cell] of Object.entries(r.cells))
      if (cell && !cols.some((c) => c.key === k)) cols.push({ key: k, label: varLabel(k), source: cell.source });
  return cols;
}

export function DatasetTable({ activeId }: { activeId: string | null }) {
  const { state, select, clock } = useStudy();
  const rows = state.order.map((id) => state.rows[id]);
  const open = state.gaps.filter((g) => g.status !== "filled");
  const declined = open.some((g) => g.status === "declined");
  const unverified = rows.filter((r) => Object.values(r.cells).some((c) => c?.verification === "unverified")).length;
  const generic = studyColumns(state.plan, rows);
  const nVars = generic ? generic.length : COLS.length;
  const gapsBy = (propertyId: string): GapLookup => (variable) =>
    state.gaps.find((g) => g.propertyId === propertyId && g.variable === variable && g.status !== "filled");
  const openVars = [...new Set(open.map((g) => varLabel(g.variable)))];
  const planSource = (key: string, fallback: Source) => state.plan?.variables.find((v) => v.key === key)?.source ?? fallback;

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
              {rows.length} rows · {nVars} variables · every value traceable to its source
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
            {openVars.length === 1 && open.length <= 6
              ? `${openVars[0]} unknown for ${open.map((g) => state.rows[g.propertyId]?.info.name).join(", ")}. `
              : `Missing: ${openVars.slice(0, 6).join(", ")}${openVars.length > 6 ? "…" : ""} (hover a cell for the reason). `}
            {declined ? "Interviews declined: these rows are excluded from the supply comparison." : "Gaps are shown, never filled with placeholders."}
          </span>
        </div>
      )}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-semibold">Property</th>
              <th scope="col" className="px-2 py-1.5 font-semibold">{generic ? "City" : "Era"}</th>
              {generic?.map((col) => (
                <th key={col.key} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  {col.label}
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-dim">
                    <SourceDot source={col.source} />
                    {SOURCE_META[col.source].label}
                  </span>
                </th>
              ))}
              {!generic && COLS.map((col) => (
                <th key={col.key} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  {col.label}
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-dim">
                    <SourceDot source={planSource(col.key, col.source)} />
                    {SOURCE_META[planSource(col.key, col.source)].label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              generic ? (
                <GenericRow
                  key={row.info.id}
                  row={row}
                  cols={generic}
                  gapOf={gapsBy(row.info.id)}
                  selected={row.info.id === activeId}
                  onSelect={() => select(row.info.id)}
                  clock={clock}
                />
              ) : (
                <Row
                  key={row.info.id}
                  row={row}
                  d={deriveRow(row)}
                  gapOf={gapsBy(row.info.id)}
                  selected={row.info.id === activeId}
                  onSelect={() => select(row.info.id)}
                  clock={clock}
                />
              ),
            )}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3.5 py-6 text-center text-xs text-dim">Rows fill in as the agent collects and measures each building.</p>}
      </div>
    </Card>
  );
}
