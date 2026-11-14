import { SF_PER_STALL } from "@/lib/data/houston";
import type { PropertyRow } from "@/lib/types";

/**
 * Vexcel aerial slot. Renders the real ortho tile when the integration
 * provides `info.aerialUrl`; otherwise a schematic generated from the
 * measured values (clearly labeled as a placeholder).
 */
export function AerialTile({ row }: { row: PropertyRow }) {
  const surface = row.cells.surfaceSf;
  const lot = row.cells.lotSf;
  const label = surface
    ? `Vexcel ortho · lot segmented by Gemini Vision · conf ${surface.evidence.confidence?.toFixed(2) ?? "—"}`
    : "Waiting for Vexcel measurement";

  if (row.info.aerialUrl) {
    return (
      <div className="relative h-[118px] shrink-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- external tile URL from integration */}
        <img src={row.info.aerialUrl} alt={`Aerial image of ${row.info.name}`} className="size-full object-cover" />
        <span className="absolute bottom-1.5 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{label}</span>
      </div>
    );
  }

  const ratio = surface && lot ? Math.min(0.8, surface.value / lot.value) : 0;
  const lotW = 330, lotX = 13, lotY = 18, lotH = 82;
  const pw = Math.max(0, ratio * lotW);
  const bw = lotW - pw - 10;
  const stalls = surface ? Math.round(surface.value / SF_PER_STALL) : 0;
  const cols = Math.max(0, Math.floor(pw / 12));

  return (
    <div className="relative h-[118px] shrink-0 overflow-hidden">
      <svg viewBox="0 0 356 118" preserveAspectRatio="xMidYMid slice" className="size-full" aria-label={`Schematic aerial of ${row.info.name}: surface parking ${Math.round(ratio * 100)}% of lot`}>
        <rect width="356" height="118" fill="#5f625a" />
        <rect y="0" width="356" height="12" fill="#3f423b" />
        <rect y="106" width="356" height="12" fill="#3f423b" />
        <rect x={lotX} y={lotY} width={bw} height={lotH} fill="#b8b4a8" />
        <rect x={lotX + 8} y={lotY + 8} width={Math.max(0, bw - 16)} height={lotH - 16} fill="#a19d90" />
        {pw > 0 && (
          <g>
            <rect x={lotX + bw + 10} y={lotY} width={pw} height={lotH} fill="#4d5049" />
            {Array.from({ length: cols }, (_, i) => (
              <g key={i} stroke="#e5e7eb" strokeWidth=".8" opacity=".75">
                <line x1={lotX + bw + 14 + i * 12} y1={lotY + 3} x2={lotX + bw + 14 + i * 12} y2={lotY + 26} />
                <line x1={lotX + bw + 14 + i * 12} y1={lotY + lotH - 26} x2={lotX + bw + 14 + i * 12} y2={lotY + lotH - 3} />
              </g>
            ))}
            {Array.from({ length: Math.min(cols, 14) }, (_, i) => (
              <rect key={i} x={lotX + bw + 16 + ((i * 37) % Math.max(12, pw - 10))} y={i % 2 ? lotY + 6 : lotY + lotH - 22} width="7" height="12" fill={i % 3 ? "#1f2937" : "#9ca3af"} />
            ))}
            {surface && <rect x={lotX + bw + 10} y={lotY} width={pw} height={lotH} fill="#fbbf2426" stroke="#fbbf24" strokeWidth="2" strokeDasharray="5 3" />}
          </g>
        )}
        {surface && (
          <text x={lotX + bw + 14} y={lotY + lotH / 2 + 4} fill="#fde68a" fontSize="10" fontFamily="monospace" paintOrder="stroke" stroke="#0008" strokeWidth="3">
            ~{stalls} stalls
          </text>
        )}
      </svg>
      <span className="absolute bottom-1.5 left-2 max-w-[92%] truncate rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{label}</span>
      <span className="absolute top-1.5 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white/70">SCHEMATIC</span>
    </div>
  );
}
