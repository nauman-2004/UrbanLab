"use client";

import { useStudy } from "@/lib/state/StudyProvider";
import type { Building, Cell } from "@/lib/types";

/** The Vexcel tile the vision model measured, served by the backend (`building_updated.aerial_url`). */
export function AerialTile({ building, measured }: { building: Building; measured?: Cell }) {
  const { resolveUrl } = useStudy();
  const url = resolveUrl(building.aerial_url);
  const label = measured
    ? measured.status === "filled"
      ? `Vexcel ortho · measured by vision model · conf ${measured.confidence?.toFixed(2) ?? "—"}`
      : "Vexcel ortho · not measurable"
    : url
      ? "Vexcel ortho · measuring…"
      : "Waiting for Vexcel tile";

  return (
    <div className="relative h-[118px] shrink-0 overflow-hidden bg-[#0e1229]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- tile served by the agent backend
        <img src={url} alt={`Aerial tile of ${building.name ?? building.building_id}`} className="size-full object-cover" />
      ) : (
        <div className="hatch-gap grid size-full place-items-center text-[11px] text-dim">no aerial tile yet</div>
      )}
      <span className="absolute bottom-1.5 left-2 max-w-[92%] truncate rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{label}</span>
    </div>
  );
}
