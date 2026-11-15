import { fmtNum } from "@/lib/format";

interface Row {
  decade: string;
  mean: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
}

const W = 520, H = 240, L = 48, R = 510, T = 16, B = 206;

/** Bar + error-bar chart for the backend's `chart_spec` (mean by decade built, bootstrap 95% CI). */
export function DecadeChart({ values }: { values: Row[] }) {
  const rows = values.filter((v) => v.mean != null);
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => Math.max(r.hi ?? r.mean!, r.mean!)), 0);
  const bottom = Math.min(...rows.map((r) => Math.min(r.lo ?? r.mean!, r.mean!)), 0);
  const span = top - bottom || 1;
  const y = (v: number) => B - ((v - bottom) / span) * (B - T);
  const slot = (R - L) / rows.length;
  const bw = Math.min(56, slot * 0.6);
  const ticks = Array.from({ length: 5 }, (_, i) => bottom + (span * i) / 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto max-h-[280px] w-full" role="img" aria-label="Mean by decade built with 95% confidence intervals">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="#1f2548" />
          <text x={L - 8} y={y(t) + 3} textAnchor="end" fill="#5f668c" fontSize="10" fontFamily="var(--font-mono)">
            {fmtNum(t, 1)}
          </text>
        </g>
      ))}
      <line x1={L} x2={R} y1={y(0)} y2={y(0)} stroke="#3a4170" />
      {rows.map((r, i) => {
        const cx = L + slot * i + slot / 2;
        const m = r.mean!;
        return (
          <g key={r.decade}>
            <title>{`${r.decade}: mean ${fmtNum(m)} · n=${r.n}${r.lo != null && r.hi != null && r.lo !== r.hi ? ` · 95% CI ${fmtNum(r.lo)}–${fmtNum(r.hi)}` : ""}`}</title>
            <rect x={cx - bw / 2} y={Math.min(y(m), y(0))} width={bw} height={Math.abs(y(m) - y(0))} rx="3" fill="var(--color-accent)" opacity="0.85" />
            {r.lo != null && r.hi != null && r.lo !== r.hi && (
              <g stroke="#e8eaf6" strokeWidth="1.5">
                <line x1={cx} x2={cx} y1={y(r.lo)} y2={y(r.hi)} />
                <line x1={cx - 7} x2={cx + 7} y1={y(r.lo)} y2={y(r.lo)} />
                <line x1={cx - 7} x2={cx + 7} y1={y(r.hi)} y2={y(r.hi)} />
              </g>
            )}
            <text x={cx} y={B + 16} textAnchor="middle" fill="#8c92b6" fontSize="11">
              {r.decade}
            </text>
            <text x={cx} y={B + 29} textAnchor="middle" fill="#5f668c" fontSize="9.5" fontFamily="var(--font-mono)">
              n={r.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
