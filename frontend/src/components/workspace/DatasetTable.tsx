"use client";

import { downloadCsv } from "@/lib/csv";
import { formatValue } from "@/lib/format";
import { cellKey } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, PlanVariable } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { SOURCE_META, SourceDot } from "../ui/Provenance";

const FRESH_MS = 1600;
const isPlaceholder = (reason: string | null) => !reason || /^Not (yet )?collected\.$/.test(reason);

function ValueCell({ v, cell, at, clock }: { v: PlanVariable; cell?: Cell; at?: number; clock: number }) {
  if (!cell || (cell.status === "missing" && isPlaceholder(cell.reason))) return <td className="px-3 py-1 font-mono text-dim">—</td>;
  if (cell.status === "missing") {
    return (
      <td className="hatch-gap px-3 py-1 text-[11px] font-semibold whitespace-nowrap text-gap shadow-[inset_0_0_0_1px_#f8717166]" title={cell.reason ?? undefined}>
        ▨ MISSING
      </td>
    );
  }
  const fresh = at != null && clock >= at && clock - at < FRESH_MS;
  return (
    <td
      className={`px-3 py-1 font-mono whitespace-nowrap ${fresh ? "animate-flash" : ""}`}
      title={`${cell.evidence_ref ?? ""}${cell.confidence != null && cell.confidence < 1 ? ` — conf ${cell.confidence.toFixed(2)}` : ""}${cell.note ? ` — ${cell.note}` : ""}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <SourceDot source={cell.source} />
        {formatValue(cell.value, v.type, v.name)}
      </span>
    </td>
  );
}

export function DatasetTable({ activeId }: { activeId: string | null }) {
  const { state, select, clock } = useStudy();
  const vars = state.plan?.variables ?? [];
  const cells = Object.values(state.cells);
  const filled = cells.filter((c) => c.status === "filled").length;
  const missing = cells.filter((c) => c.status === "missing" && !isPlaceholder(c.reason)).length;
  const openGaps = state.gaps.filter((g) => state.cells[cellKey(g.building_id, g.variable)]?.status !== "filled");

  return (
    <Card className="h-full">
      <CardHeader
        icon="grid"
        title="Dataset"
        aside={
          <span className="flex items-center gap-3">
            <span className="hidden sm:inline">
              {state.order.length} rows · {vars.length} variables · {filled} filled · <span className={missing ? "text-gap" : ""}>{missing} missing</span> · every value traceable
            </span>
            <button type="button" onClick={() => downloadCsv(state)} disabled={!state.order.length} className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-40">
              <Icon name="download" className="size-3" /> CSV
            </button>
          </span>
        }
      />
      {openGaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-gradient-to-r from-gap/10 to-transparent px-3.5 py-1.5 text-xs text-soft">
          <b className="text-gap">⚠ {openGaps.length} evidence gap{openGaps.length > 1 ? "s" : ""}</b>
          <span>
            across {new Set(openGaps.map((g) => g.building_id)).size} buildings. {openGaps[0].reason}
          </span>
        </div>
      )}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th scope="col" className="px-3 py-1.5 font-semibold">Building</th>
              {vars.map((v) => (
                <th key={v.name} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap" title={v.label}>
                  {v.name}
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-dim">
                    <SourceDot source={v.source} />
                    {SOURCE_META[v.source]?.label ?? v.source}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.order.map((id) => {
              const b = state.buildings[id];
              const selected = id === activeId;
              return (
                <tr key={id} onClick={() => select(id)} className={`cursor-pointer border-b border-[#1b2040] transition hover:bg-white/[0.03] ${selected ? "bg-accent/[0.08]" : ""}`}>
                  <th scope="row" className="px-3 py-1 text-left font-medium whitespace-nowrap">
                    <button type="button" onClick={() => select(id)} className="text-left hover:text-accent2">
                      <span className="mr-1.5 font-mono text-[10.5px] text-dim">{id}</span>
                      {b.name}
                    </button>
                  </th>
                  {vars.map((v) => (
                    <ValueCell key={v.name} v={v} cell={state.cells[cellKey(id, v.name)]} at={state.cellAt[cellKey(id, v.name)]} clock={clock} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {state.order.length === 0 && <p className="px-3.5 py-6 text-center text-xs text-dim">Rows fill in as the agent collects and measures each building.</p>}
      </div>
    </Card>
  );
}
