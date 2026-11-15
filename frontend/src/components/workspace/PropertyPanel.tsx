"use client";

import { formatValue, parseSurveyEvidence } from "@/lib/format";
import { cellKey } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, PlanVariable, Source } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { SelfReportedBadge, SourceTag, StubBadge } from "../ui/Provenance";
import { AerialTile } from "./AerialTile";

const SOURCES: Source[] = ["costar", "vexcel", "survey"];
const LAYER_META: Record<Source, string> = { costar: "property record", vexcel: "aerial imagery", survey: "property manager" };

function VarRow({ v, cell }: { v: PlanVariable; cell?: Cell }) {
  const filled = cell?.status === "filled";
  const ev = v.source === "survey" ? parseSurveyEvidence(cell?.evidence_ref ?? null) : null;
  return (
    <div className="py-1 text-[11.5px]" title={cell?.evidence_ref ?? undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted">{v.label}</span>
        {filled ? (
          <span className="font-mono font-semibold">{formatValue(cell!.value, v.type, v.name)}</span>
        ) : cell && cell.reason && !/^Not (yet )?collected\.$/.test(cell.reason) ? (
          <span className="font-semibold text-gap">MISSING</span>
        ) : (
          <span className="font-mono text-xs text-dim">pending…</span>
        )}
      </div>
      {filled && v.source === "vexcel" && cell!.note && <p className="mt-0.5 text-[10.5px] text-dim">{cell!.note}</p>}
      {filled && ev?.quote && (
        <p className="mt-0.5 text-[10.5px] text-muted italic">
          “{ev.quote}” <span className="font-mono not-italic text-dim">{ev.callId} @ {ev.at}</span>
        </p>
      )}
      {!filled && cell?.reason && !/^Not (yet )?collected\.$/.test(cell.reason) && <p className="mt-0.5 text-[10.5px] text-muted">{cell.reason}</p>}
    </div>
  );
}

/** Every layer of evidence for one building: CoStar record, Vexcel aerial, phone survey. */
export function PropertyPanel({ buildingId }: { buildingId: string | null }) {
  const { state, openCall } = useStudy();
  const b = buildingId ? state.buildings[buildingId] : null;
  if (!b) {
    return (
      <div className="grid w-full shrink-0 place-items-center border-line p-6 text-center text-xs text-dim xl:w-[340px] xl:border-l">
        Select a building to inspect its CoStar record, aerial measurement and survey answers.
      </div>
    );
  }
  const vars = state.plan?.variables ?? [];
  const cell = (name: string) => state.cells[cellKey(b.building_id, name)];
  const vexcelCell = vars.filter((v) => v.source === "vexcel").map((v) => cell(v.name)).find(Boolean);
  const call = state.callOrder.map((id) => state.calls[id]).find((c) => c.building_id === b.building_id);
  const sample = String(b.costar_id ?? "").startsWith("SAMPLE");

  return (
    <aside className="scrollbar-thin flex w-full shrink-0 flex-col overflow-y-auto border-line bg-[#121734] xl:w-[340px] xl:border-l" aria-label={`${b.name ?? b.building_id} details`}>
      <AerialTile building={b} measured={vexcelCell} />
      <div className="px-3 pt-2 pb-1.5">
        <b className="text-[15px]">{b.name ?? b.building_id}</b>
        <div className="text-[11.5px] text-muted">
          {[b.address, b.city, b.property_type, b.building_id].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
        {SOURCES.map((src) => {
          const vs = vars.filter((v) => v.source === src);
          if (!vs.length) return null;
          const tone = src === "survey" ? "border-voice/40 bg-voice/[0.05]" : "border-line bg-[#0e1229]";
          const anyFilled = vs.some((v) => cell(v.name)?.status === "filled");
          return (
            <div key={src} className={`rounded-[10px] border px-2.5 py-2 ${tone}`}>
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <SourceTag source={src} />
                  {src === "costar" && sample && <StubBadge>SAMPLE</StubBadge>}
                  {src === "survey" && call?.stub && <StubBadge />}
                </span>
                <span className="truncate font-mono text-[10px] text-dim">{src === "costar" && b.costar_id ? `#${b.costar_id}` : LAYER_META[src]}</span>
              </div>
              <div className="divide-y divide-line/60">
                {vs.map((v) => (
                  <VarRow key={v.name} v={v} cell={cell(v.name)} />
                ))}
              </div>
              {src === "survey" && anyFilled && (
                <div className="mt-1">
                  <SelfReportedBadge />
                </div>
              )}
              {src === "survey" && call && (
                <button type="button" onClick={() => openCall(call.call_id)} className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-voice hover:underline">
                  View call transcript ({call.call_id}) <Icon name="expand" className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        {!vars.length && <p className="px-1 text-[11.5px] text-dim">Variables appear once the plan is approved.</p>}
      </div>
    </aside>
  );
}
