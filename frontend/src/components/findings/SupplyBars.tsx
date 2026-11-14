import type { DerivedRow } from "@/lib/analysis";
import type { PropertyRow } from "@/lib/types";

/** Segment = parking type × data source, so the chart keeps provenance visible. */
const SEGMENTS = [
  { key: "surface|vexcel", label: "surface · Vexcel", color: "var(--color-vexcel)" },
  { key: "garage|matterport", label: "garage · Matterport", color: "var(--color-mport)" },
  { key: "garage|costar", label: "garage · CoStar (inferred)", color: "#f9a8d4", hatch: true },
  { key: "offsite|costar", label: "off-site · CoStar", color: "var(--color-costar)" },
  { key: "offsite|interview", label: "off-site · interview", color: "var(--color-voice)", hatch: true },
] as const;

type SegKey = (typeof SEGMENTS)[number]["key"];

/** Mean stalls per 1,000 sf by segment for complete rows. Segments sum exactly to the era mean. */
export function supplySegments(rows: DerivedRow[], raw: Record<string, PropertyRow>) {
  const done = rows.filter((r) => r.complete);
  const acc: Record<SegKey, number> = { "surface|vexcel": 0, "garage|matterport": 0, "garage|costar": 0, "offsite|costar": 0, "offsite|interview": 0 };
  for (const r of done) {
    const k = r.rbaSf! / 1000;
    const c = raw[r.id].cells;
    acc["surface|vexcel"] += r.surfaceStalls! / k;
    acc[`garage|${c.garageStalls!.source === "matterport" ? "matterport" : "costar"}`] += r.garageStalls! / k;
    acc[`offsite|${c.offsiteSpaces!.source === "interview" ? "interview" : "costar"}`] += r.offsiteSpaces! / k;
  }
  const n = done.length || 1;
  for (const key of Object.keys(acc) as SegKey[]) acc[key] /= n;
  return { n: done.length, segs: acc, total: Object.values(acc).reduce((a, b) => a + b, 0) };
}

const B = 200, T = 30, YMAX = 3;
const sy = (v: number) => B - (v / YMAX) * (B - T);

export function SupplyBars({ pre, post }: { pre: ReturnType<typeof supplySegments>; post: ReturnType<typeof supplySegments> }) {
  const bars = [
    { label: `Pre-1980 (n=${pre.n})`, x: 80, d: pre },
    { label: `Post-2000 (n=${post.n})`, x: 230, d: post },
  ];
  return (
    <div>
      <svg viewBox="0 0 380 226" className="w-full" role="img" aria-label={`Mean parking stalls per 1,000 sf: pre-1980 ${pre.total.toFixed(2)}, post-2000 ${post.total.toFixed(2)}`}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#0b0f1e" strokeWidth="2" opacity="0.45" />
          </pattern>
        </defs>
        {[0, 1, 2, 3].map((v) => (
          <g key={v}>
            <line x1="40" x2="370" y1={sy(v)} y2={sy(v)} stroke={v ? "#1f2548" : "#3a4170"} />
            <text x="30" y={sy(v) + 3} textAnchor="end" fill="#5f668c" fontSize="10" fontFamily="var(--font-mono)">{v.toFixed(1)}</text>
          </g>
        ))}
        {bars.map(({ label, x, d }) => {
          let y = B;
          return (
            <g key={label}>
              {SEGMENTS.map((s) => {
                const h = (d.segs[s.key] / YMAX) * (B - T);
                if (h <= 0.05) return null;
                y -= h;
                return (
                  <g key={s.key}>
                    <title>{`${s.label}: ${d.segs[s.key].toFixed(2)} stalls / 1k sf`}</title>
                    <rect x={x} y={y} width="90" height={h} fill={s.color} />
                    {"hatch" in s && s.hatch && <rect x={x} y={y} width="90" height={h} fill="url(#hatch)" />}
                  </g>
                );
              })}
              <text x={x + 45} y={y - 7} textAnchor="middle" fill="#e8eaf6" fontWeight="600" fontSize="12" fontFamily="var(--font-mono)">{d.n ? d.total.toFixed(2) : "—"}</text>
              <text x={x + 45} y={B + 18} textAnchor="middle" fill="#8c92b6" fontSize="11">{label}</text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <i className="size-2 rounded-sm" style={{ background: s.color, backgroundImage: "hatch" in s && s.hatch ? "repeating-linear-gradient(45deg,#0b0f1e66 0 1px,transparent 1px 4px)" : undefined }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
