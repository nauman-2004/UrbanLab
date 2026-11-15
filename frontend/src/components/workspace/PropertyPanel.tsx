"use client";

import { formatValue } from "@/lib/format";
import { cellKey } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Cell, PlanVariable, Source } from "@/lib/types";
import { Icon } from "../ui/Icon";
import { SourceTag, StubBadge } from "../ui/Provenance";
import { AerialTile } from "./AerialTile";

const SOURCES: Source[] = ["costar", "vexcel"];
const LAYER_META: Record<Source, string> = { costar: "property record", vexcel: "aerial imagery" };

function VarRow({ v, cell }: { v: PlanVariable; cell?: Cell }) {
  const filled = cell?.status === "filled";
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
      {!filled && cell?.reason && !/^Not (yet )?collected\.$/.test(cell.reason) && <p className="mt-0.5 text-[10.5px] text-muted">{cell.reason}</p>}
    </div>
  );
}

/** Every layer of evidence for one building: CoStar record and Vexcel aerial. */
export function PropertyPanel({ buildingId }: { buildingId: string | null }) {
  const { state } = useStudy();
  const b = buildingId ? state.buildings[buildingId] : null;
  if (!b) {
    return (
      <div className="grid w-full shrink-0 place-items-center border-line p-6 text-center text-xs text-dim xl:w-[340px] xl:border-l">
        Select a building to inspect its CoStar record and aerial measurement.
      </div>
    );
  }
  const vars = state.plan?.variables ?? [];
  const cell = (name: string) => state.cells[cellKey(b.building_id, name)];
  const vexcelCell = vars.filter((v) => v.source === "vexcel").map((v) => cell(v.name)).find(Boolean);
  const costarBadge =
    b.costar_source === "synthetic" ? "SYNTHETIC" : b.costar_source === "sample" || String(b.costar_id ?? "").startsWith("SAMPLE") ? "SAMPLE" : null;

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
          return (
            <div key={src} className="rounded-[10px] border border-line bg-[#0e1229] px-2.5 py-2">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <SourceTag source={src} />
                  {src === "costar" && costarBadge && <StubBadge>{costarBadge}</StubBadge>}
                </span>
                <span className="truncate font-mono text-[10px] text-dim">{src === "costar" && b.costar_id ? `#${b.costar_id}` : LAYER_META[src]}</span>
              </div>
              <div className="divide-y divide-line/60">
                {vs.map((v) => (
                  <VarRow key={v.name} v={v} cell={cell(v.name)} />
                ))}
              </div>
            </div>
          );
        })}
        {!vars.length && <p className="px-1 text-[11.5px] text-dim">Variables appear once the plan is approved.</p>}
        {b.matterport_models != null && (
          <div className="rounded-[10px] border border-line bg-[#0e1229] px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="rounded-[5px] bg-mport px-1.5 py-0.5 text-[9px] font-bold tracking-[0.07em] text-[#0b0f1e]">MATTERPORT</span>
              <span className="font-mono text-[10px] text-dim">
                {b.matterport_models} scan{b.matterport_models === 1 ? "" : "s"} linked
              </span>
            </div>
            {b.matterport_url ? (
              <>
                <iframe
                  src={b.matterport_url}
                  title={`Matterport 3D tour of ${b.name ?? b.building_id}`}
                  className="aspect-video w-full rounded-md border border-line"
                  allow="xr-spatial-tracking; fullscreen"
                  loading="lazy"
                />
                <a href={b.matterport_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-mport hover:underline">
                  Open 3D tour <Icon name="external" className="size-3" />
                </a>
                <p className="mt-0.5 text-[10px] text-dim">A scan may cover one suite or amenity, not the whole building.</p>
              </>
            ) : (
              <p className="text-[11px] text-muted">No Matterport scan is linked to this property.</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
