import type { Cell, PlanFilter, PlanSample, PlanVariable } from "./types";

/** Format a cell value using the plan variable's type (bools arrive as 1/0). */
export function formatValue(value: Cell["value"], type?: PlanVariable["type"], name?: string): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (name && /year/.test(name)) return String(Math.round(value)); // 1996, not 1,996
  if (type === "bool") return value ? "Yes" : "No";
  if (type === "int") return Math.round(value).toLocaleString("en-US");
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const fmtNum = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });

export const fmtP = (p: number | null | undefined) => (p == null || !Number.isFinite(p) ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3));

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// Years stay bare (1995); large amounts get separators (217,800).
const n = (v: number) => (Math.abs(v) >= 10000 ? v.toLocaleString("en-US") : String(v));

/** "1975 ≤ year_built ≤ 1995", "building_class is B", "year_renovated ≤ 2012 or not recorded". */
export function describeFilter(f: PlanFilter): string {
  let txt: string;
  if (f.values?.length) txt = `${f.variable} is ${f.values.join(" or ")}`;
  else if (f.min != null && f.max != null) txt = f.min === f.max ? `${f.variable} = ${n(f.min)}` : `${n(f.min)} ≤ ${f.variable} ≤ ${n(f.max)}`;
  else if (f.min != null) txt = `${f.variable} ≥ ${n(f.min)}`;
  else txt = `${f.variable} ≤ ${n(f.max ?? 0)}`;
  return f.include_missing ? `${txt} or not recorded` : txt;
}

/** "Top 5 Multifamily properties in Houston by lot_sf (largest first)" or "8 Office properties in Houston (random sample)". */
export function describeSample(s: Partial<PlanSample> | undefined): string {
  if (!s) return "—";
  const what = `${s.property_type ?? "?"} properties in ${s.city ?? "?"}`;
  if (s.sort_by) return `Top ${s.n} ${what} by ${s.sort_by} (${s.sort_desc === false ? "smallest" : "largest"} first)`;
  return `${s.n} ${what} (random sample${s.filters?.length ? " of those matching" : ""})`;
}
