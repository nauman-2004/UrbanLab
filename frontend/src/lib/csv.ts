import type { PropertyRow, VariableKey } from "./types";

const methodOfCell = (c: { provenance?: { method?: string }; source: string; evidence: { note?: string } }) =>
  c.provenance?.method ??
  (c.source === "interview" ? "self_reported" : c.evidence.note?.startsWith("MODEL ESTIMATE") ? "model_estimate"
    : c.evidence.note?.startsWith("computed") || c.source === "derived" ? "computed" : "observed");
import { deriveRow } from "./analysis";

const BASE_VARS: VariableKey[] = ["yearBuilt", "rbaSf", "lotSf", "surfaceSf", "garageStalls", "offsiteSpaces"];

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Research-ready CSV: one value column plus source / verification / evidence per variable. */
export function toCsv(rows: PropertyRow[]): string {
  // Template variables first, then every other variable present in this study. Absent values stay empty.
  const VARS = [...BASE_VARS, ...new Set(rows.flatMap((r) => Object.keys(r.cells)).filter((k) => !BASE_VARS.includes(k)))];
  const header = ["id", "name", "address", "city", "state", "property_type",
    ...VARS.flatMap((v) => [v, `${v}_source`, `${v}_method`, `${v}_verification`, `${v}_evidence`]), "surface_ratio", "stalls_per_1k_sf"];
  const lines = rows.map((r) => {
    const d = deriveRow(r);
    return [
      r.info.id,
      r.info.name,
      r.info.address,
      r.info.city,
      r.info.state,
      r.info.propertyType,
      ...VARS.flatMap((v) => {
        const c = r.cells[v];
        return [c?.value, c?.source, c ? methodOfCell(c) : undefined, c?.verification, c?.evidence.ref];
      }),
      d.surfaceRatio?.toFixed(4),
      d.stallsPer1k?.toFixed(3),
    ]
      .map(esc)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
