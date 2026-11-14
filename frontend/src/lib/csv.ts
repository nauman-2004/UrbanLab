import type { PropertyRow, VariableKey } from "./types";
import { deriveRow } from "./analysis";

const VARS: VariableKey[] = ["yearBuilt", "rbaSf", "lotSf", "surfaceSf", "garageStalls", "offsiteSpaces"];

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Research-ready CSV: one value column plus source / verification / evidence per variable. */
export function toCsv(rows: PropertyRow[]): string {
  const header = ["id", "name", "address", ...VARS.flatMap((v) => [v, `${v}_source`, `${v}_verification`, `${v}_evidence`]), "surface_ratio", "stalls_per_1k_sf"];
  const lines = rows.map((r) => {
    const d = deriveRow(r);
    return [
      r.info.id,
      r.info.name,
      r.info.address,
      ...VARS.flatMap((v) => {
        const c = r.cells[v];
        return [c?.value, c?.source, c?.verification, c?.evidence.ref];
      }),
      d.surfaceRatio?.toFixed(4),
      d.stallsPer1k?.toFixed(3),
    ]
      .map(esc)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
