"use client";

import { useMemo } from "react";
import { cellKey, type StudyState } from "@/lib/state/reducer";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Building } from "@/lib/types";

/**
 * Offline SVG map of the sample, projected from WGS84 lat/lng and fitted to
 * whatever buildings CoStar returned. Swap for MapLibre/Mapbox later by
 * keeping the same props.
 */
const W = 1000;
const H = 620;
const PAD = 70;

type PinState = "pending" | "observed" | "gap" | "queued" | "surveyed";

export function buildingState(s: StudyState, id: string): PinState {
  const vars = s.plan?.variables ?? [];
  const survey = vars.filter((v) => v.source === "survey");
  if (survey.some((v) => s.cells[cellKey(id, v.name)]?.status === "filled")) return "surveyed";
  const approved = s.approvals.some((a) => a.kind === "survey" && a.args.building_id === id && a.status === "approved");
  const called = Object.values(s.calls).some((c) => c.building_id === id);
  if (approved && !called) return "queued";
  if (s.gaps.some((g) => g.building_id === id)) return "gap";
  if (vars.some((v) => s.cells[cellKey(id, v.name)]?.status === "filled")) return "observed";
  return "pending";
}

const FILL: Record<PinState, string> = {
  pending: "#3b4270",
  observed: "var(--color-costar)",
  gap: "#0c1028",
  queued: "#0c1028",
  surveyed: "var(--color-voice)",
};

function projector(points: { lat: number; lng: number }[]) {
  if (!points.length) return () => ({ x: W / 2, y: H / 2 });
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180);
  const minX = Math.min(...lngs) * cos, maxX = Math.max(...lngs) * cos;
  const minY = Math.min(...lats), maxY = Math.max(...lats);
  const span = Math.max(maxX - minX, maxY - minY, 0.004); // never zoom closer than ~400 m
  const scale = Math.min((W - 2 * PAD) / span, (H - 2 * PAD) / span);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return (p: { lat: number; lng: number }) => ({ x: W / 2 + (p.lng * cos - cx) * scale, y: H / 2 - (p.lat - cy) * scale });
}

export function StudyMap({ activeId }: { activeId: string | null }) {
  const { state, select } = useStudy();

  const pins = useMemo(() => {
    // Buildings without coordinates stay in the dataset but can't be placed on the map.
    const bs = state.order
      .map((id) => state.buildings[id])
      .filter((b): b is Building & { lat: number; lng: number } => b?.lat != null && b?.lng != null && Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const project = projector(bs);
    return bs.map((b) => ({ id: b.building_id, b, ...project(b), st: buildingState(state, b.building_id) }));
  }, [state]);

  const grid = Array.from({ length: 21 }, (_, i) => i * 50);

  return (
    <div className="relative min-h-[260px] flex-1 overflow-hidden bg-[#0c1028]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" role="img" aria-label={`Map of ${pins.length} sampled buildings`}>
        <defs>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity=".55" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="#0c1028" />
        <g stroke="#121838" strokeWidth="2">
          {grid.map((o) => (
            <line key={`v${o}`} x1={o} y1={0} x2={o} y2={H} />
          ))}
          {grid.map((o) => (
            <line key={`h${o}`} x1={0} y1={o} x2={W} y2={o} />
          ))}
        </g>

        {pins.map((p) => {
          const active = p.id === activeId;
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.b.name ?? p.id}${active ? " (selected)" : ""}`}
              onClick={() => select(p.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(p.id)}
              className="cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-white"
            >
              <title>{`${p.id} · ${p.b.name ?? ""}`}</title>
              {active && <circle cx={p.x} cy={p.y} r={70} fill="url(#glow)" />}
              {p.st === "queued" && <circle cx={p.x} cy={p.y} r={20} fill="none" stroke="var(--color-voice)" strokeWidth="4" className="animate-pulse-ring origin-center [transform-box:fill-box]" />}
              <circle cx={p.x} cy={p.y} r={34} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 20 : 15}
                fill={FILL[p.st]}
                stroke={p.st === "gap" ? "var(--color-gap)" : p.st === "queued" ? "var(--color-voice)" : active ? "var(--color-accent2)" : "#0c1028"}
                strokeWidth={p.st === "gap" || p.st === "queued" ? 5 : active ? 6 : 4}
                strokeDasharray={p.st === "gap" ? "7 5" : undefined}
              />
              <text x={p.x} y={p.y + (active ? 44 : 36)} textAnchor="middle" fill={active ? "#e8eaf6" : "#8c92b6"} fontSize={active ? 24 : 18} fontWeight="600" paintOrder="stroke" stroke="#0c1028" strokeWidth="7">
                {active ? p.b.name ?? p.id : p.id}
              </text>
            </g>
          );
        })}
      </svg>
      {pins.length === 0 && <div className="absolute inset-0 grid place-items-center text-xs text-dim">Buildings appear here as CoStar returns the sample.</div>}
      <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-x-2.5 gap-y-1 rounded-[9px] border border-line2 bg-[#0d1126]/90 px-2.5 py-1.5 text-[10.5px] text-muted">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-costar" />Observed</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full border-2 border-dashed border-gap" />Survey gap</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full border-2 border-voice" />Call approved</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-voice" />Surveyed</span>
      </div>
    </div>
  );
}
