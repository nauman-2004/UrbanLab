import type { DerivedRow } from "@/lib/analysis";

const X0 = 1965, X1 = 2025, Y0 = 0, Y1 = 0.5;
const W = 500, H = 250, L = 40, R = 490, T = 15, B = 220;
const sx = (y: number) => L + ((y - X0) / (X1 - X0)) * (R - L);
const sy = (v: number) => B - ((v - Y0) / (Y1 - Y0)) * (B - T);

/** Least-squares line, drawn only as a visual guide (the test reported is Spearman). */
function ols(pts: { x: number; y: number }[]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return (x: number) => my + b * (x - mx);
}

export function SurfaceScatter({ rows }: { rows: DerivedRow[] }) {
  const pts = rows.filter((r) => r.yearBuilt != null && r.surfaceRatio != null);
  const fit = pts.length >= 3 ? ols(pts.map((r) => ({ x: r.yearBuilt!, y: r.surfaceRatio! }))) : null;
  const xa = 1968, xb = 2022;

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="Scatter plot of surface-parking share of lot against year built">
      {[0.1, 0.2, 0.3, 0.4, 0.5].map((v) => (
        <g key={v}>
          <line x1={L} x2={R} y1={sy(v)} y2={sy(v)} stroke="#1f2548" />
          <text x={L - 8} y={sy(v) + 3} textAnchor="end" fill="#5f668c" fontSize="10" fontFamily="var(--font-mono)">{v.toFixed(1)}</text>
        </g>
      ))}
      <line x1={L} x2={R} y1={B} y2={B} stroke="#3a4170" />
      {[1970, 1980, 1990, 2000, 2010, 2020].map((y) => (
        <text key={y} x={sx(y)} y={B + 16} textAnchor="middle" fill="#5f668c" fontSize="10" fontFamily="var(--font-mono)">{y}</text>
      ))}
      {/* era bands */}
      <rect x={L} y={T} width={sx(1980) - L} height={B - T} fill="#fbbf24" opacity="0.04" />
      <rect x={sx(2000)} y={T} width={R - sx(2000)} height={B - T} fill="#8b5cf6" opacity="0.05" />
      <text x={L + 6} y={T + 12} fill="#8c92b6" fontSize="10">pre-1980</text>
      <text x={R - 6} y={T + 12} fill="#8c92b6" fontSize="10" textAnchor="end">post-2000</text>
      {fit && <line x1={sx(xa)} y1={sy(fit(xa))} x2={sx(xb)} y2={sy(fit(xb))} stroke="var(--color-accent2)" strokeWidth="2" strokeDasharray="6 4" />}
      {pts.map((r) => (
        <g key={r.id}>
          <title>{`${r.name} · ${r.yearBuilt} · ${(r.surfaceRatio! * 100).toFixed(0)}% of lot${r.interviewed ? " · completed by interview" : ""}${r.unverified ? " (unverified)" : ""}`}</title>
          <circle cx={sx(r.yearBuilt!)} cy={sy(r.surfaceRatio!)} r="6.5" fill="var(--color-vexcel)" stroke="#0e1229" strokeWidth="2" />
          {r.interviewed && (
            <circle cx={sx(r.yearBuilt!)} cy={sy(r.surfaceRatio!)} r="10.5" fill="none" stroke={r.unverified ? "var(--color-unverified)" : "var(--color-voice)"} strokeWidth="2" strokeDasharray={r.unverified ? "3 2" : undefined} />
          )}
        </g>
      ))}
      <text x={W / 2} y={H + 16} textAnchor="middle" fill="#5f668c" fontSize="10">year built</text>
    </svg>
  );
}
