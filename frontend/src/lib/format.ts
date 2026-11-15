import type { Cell, PlanVariable } from "./types";

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

export const fmtCallTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Split a survey evidence ref like `STUB call-1a2b @ 00:12: "We have 4…"` into parts. */
export function parseSurveyEvidence(ref: string | null): { callId?: string; at?: string; quote?: string; stub: boolean } {
  if (!ref) return { stub: false };
  const m = ref.match(/^(STUB )?(call-[\w-]+)(?: @ (\d+:\d+))?(?:: "([\s\S]*)")?$/);
  if (!m) return { stub: ref.startsWith("STUB") };
  return { stub: !!m[1], callId: m[2], at: m[3], quote: m[4] };
}
