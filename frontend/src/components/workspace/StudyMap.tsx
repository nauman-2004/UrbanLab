"use client";

import { useMemo } from "react";
import { useStudy } from "@/lib/state/StudyProvider";
import type { PropertyInfo, PropertyRow } from "@/lib/types";

/**
 * Offline SVG map of the study area, projected from WGS84 lat/lng.
 * The synthetic replay uses a stylized downtown-Houston backdrop; any other sample
 * (Houston or Los Angeles, any property type) gets a neutral grid fitted to its pins.
 * Swap for MapLibre/Mapbox later by keeping the same props: rows, selected id, onSelect.
 */
const DEMO_BBOX = { minLat: 29.7533, maxLat: 29.7634, minLng: -95.3735, maxLng: -95.3602 };
const W = 1000;

interface Frame {
  bbox: typeof DEMO_BBOX;
  h: number;
  demo: boolean;
}

function frameFor(points: { lat: number; lng: number }[]): Frame {
  const inDemo = points.length > 0 && points.every((p) =>
    p.lat >= DEMO_BBOX.minLat && p.lat <= DEMO_BBOX.maxLat && p.lng >= DEMO_BBOX.minLng && p.lng <= DEMO_BBOX.maxLng);
  let bbox = DEMO_BBOX;
  if (points.length > 0 && !inDemo) {
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    const pad = (a: number, b: number) => Math.max((b - a) * 0.08, 0.004);
    const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    bbox = { minLat: la0 - pad(la0, la1), maxLat: la1 + pad(la0, la1), minLng: lo0 - pad(lo0, lo1), maxLng: lo1 + pad(lo0, lo1) };
  }
  const cos = Math.cos((((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180);
  const h = Math.min(1400, Math.max(320, Math.round((W * (bbox.maxLat - bbox.minLat)) / ((bbox.maxLng - bbox.minLng) * cos))));
  return { bbox, h, demo: points.length === 0 || inDemo };
}

const projectIn = (f: Frame, lat: number, lng: number) => ({
  x: ((lng - f.bbox.minLng) / (f.bbox.maxLng - f.bbox.minLng)) * W,
  y: ((f.bbox.maxLat - lat) / (f.bbox.maxLat - f.bbox.minLat)) * f.h,
});

/** Projection of the synthetic demo frame (kept for callers that place markers on the demo map). */
export const project = (lat: number, lng: number) => projectIn(frameFor([]), lat, lng);

/** "Houston, TX" / "Los Angeles, CA" / both, from the recorded cities of the sampled properties. */
export function studyAreaLabel(infos: PropertyInfo[]): string {
  const places = [...new Set(infos.filter((i) => i.city).map((i) => (i.state ? `${i.city}, ${i.state}` : i.city!)))];
  if (places.length === 0) return "";
  return places.length <= 2 ? places.join(" · ") : `${places.slice(0, 2).join(" · ")} +${places.length - 2}`;
}

type PinState = "pending" | "observed" | "gap" | "collecting" | "interview";

function pinState(row: PropertyRow, gapStatus?: string): PinState {
  const off = row.cells.offsiteSpaces;
  if (off?.source === "interview") return "interview";
  if (gapStatus === "collecting") return "collecting";
  if (gapStatus && gapStatus !== "filled") return "gap";
  if (Object.keys(row.cells).length === 0) return "pending";
  return "observed";
}

const FILL: Record<PinState, string> = {
  pending: "#3b4270",
  observed: "var(--color-costar)",
  gap: "#0c1028",
  collecting: "#0c1028",
  interview: "var(--color-voice)",
};

export function StudyMap({ activeId }: { activeId: string | null }) {
  const { state, select } = useStudy();

  const frame = useMemo(() => frameFor(state.order.map((id) => state.rows[id].info)), [state.order, state.rows]);
  const H = frame.h;
  const pins = useMemo(
    () =>
      state.order.map((id) => {
        const row = state.rows[id];
        const gap = state.gaps.find((g) => g.propertyId === id && g.status !== "filled");
        return { id, row, ...projectIn(frame, row.info.lat, row.info.lng), st: pinState(row, gap?.status) };
      }),
    [state.order, state.rows, state.gaps, frame],
  );
  const area = studyAreaLabel(state.order.map((id) => state.rows[id].info));

  // Demo backdrop: downtown Houston's street grid is rotated ~36° from north.
  const streets = Array.from({ length: 34 }, (_, i) => -900 + i * 58);
  const grid = Array.from({ length: 11 }, (_, i) => i / 10);

  return (
    <div className="relative min-h-[260px] flex-1 overflow-hidden bg-[#0c1028]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 size-full" role="img" aria-label={`Map of ${pins.length} sampled buildings${area ? ` in ${area}` : ""}`}>
        <defs>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#8b5cf6" stopOpacity=".55" />
            <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="#0c1028" />
        {!frame.demo && (
          <g stroke="#141a3c" strokeWidth="3">
            {grid.map((t) => <line key={`gx${t}`} x1={t * W} y1={0} x2={t * W} y2={H} />)}
            {grid.map((t) => <line key={`gy${t}`} x1={0} y1={t * H} x2={W} y2={t * H} />)}
          </g>
        )}
        {frame.demo && (<>
        <g transform={`rotate(-36 ${W / 2} ${H / 2})`} stroke="#121838" strokeWidth="7">
          {streets.map((o) => (
            <line key={`a${o}`} x1={o + W / 2} y1={-600} x2={o + W / 2} y2={H + 600} />
          ))}
          {streets.map((o) => (
            <line key={`b${o}`} x1={-600} y1={o + H / 2} x2={W + 600} y2={o + H / 2} />
          ))}
        </g>
        {/* Buffalo Bayou (north-west) and freeway loop (stylized) */}
        <path d={`M-20 ${H * 0.18} C ${W * 0.18} ${H * 0.1}, ${W * 0.3} ${H * 0.32}, ${W * 0.12} ${H * 0.55} S ${W * 0.02} ${H * 0.8}, -20 ${H * 0.95}`} fill="none" stroke="#123049" strokeWidth="18" />
        <path d={`M${W * 0.08} -20 L ${W * 0.1} ${H + 20}`} stroke="#3a2f78" strokeWidth="8" />
        <path d={`M-20 ${H * 0.93} L ${W + 20} ${H * 0.88}`} stroke="#3a2f78" strokeWidth="8" />
        <path d={`M${W * 0.93} -20 L ${W * 0.9} ${H + 20}`} stroke="#3a2f78" strokeWidth="8" />
        <text x={W * 0.03} y={H * 0.12} fill="#2f3f66" fontSize="26" letterSpacing="3">BUFFALO BAYOU</text>
        <text x={W * 0.115} y={H * 0.98} fill="#4b4590" fontSize="24" letterSpacing="3">I-45</text>
        <text x={W * 0.79} y={H * 0.08} fill="#4b4590" fontSize="24" letterSpacing="3">I-69</text>
        </>)}

        {pins.map((p) => {
          const active = p.id === activeId;
          const unverified = p.row.cells.offsiteSpaces?.verification === "unverified";
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.row.info.name}${active ? " (selected)" : ""}`}
              onClick={() => select(p.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(p.id)}
              className="cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-white"
            >
              {active && <circle cx={p.x} cy={p.y} r={80} fill="url(#glow)" />}
              {p.st === "collecting" && <circle cx={p.x} cy={p.y} r={24} fill="none" stroke="var(--color-voice)" strokeWidth="4" className="animate-pulse-ring origin-center [transform-box:fill-box]" />}
              <circle cx={p.x} cy={p.y} r={40} fill="transparent" />
              <circle
                cx={p.x}
                cy={p.y}
                r={active ? 26 : 19}
                fill={FILL[p.st]}
                stroke={p.st === "gap" ? "var(--color-gap)" : p.st === "collecting" ? "var(--color-voice)" : active ? "var(--color-accent2)" : "#0c1028"}
                strokeWidth={p.st === "gap" || p.st === "collecting" ? 6 : active ? 7 : 5}
                strokeDasharray={p.st === "gap" ? "8 6" : undefined}
              />
              {unverified && <circle cx={p.x + 17} cy={p.y - 17} r={9} fill="var(--color-unverified)" stroke="#0c1028" strokeWidth="4" />}
              {active && (
                <text x={p.x} y={p.y + 62} textAnchor="middle" fill="#e8eaf6" fontSize="32" fontWeight="600" paintOrder="stroke" stroke="#0c1028" strokeWidth="9">
                  {p.row.info.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {pins.length === 0 && <div className="absolute inset-0 grid place-items-center text-xs text-dim">Buildings appear here as CoStar returns the sample.</div>}
      <div className="absolute bottom-2.5 left-2.5 flex flex-wrap gap-x-2.5 gap-y-1 rounded-[9px] border border-line2 bg-[#0d1126]/90 px-2.5 py-1.5 text-[10.5px] text-muted">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-costar" />Observed</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full border-2 border-dashed border-gap" />Gap</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-voice" />Interview</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-unverified" />Unverified</span>
      </div>
    </div>
  );
}
