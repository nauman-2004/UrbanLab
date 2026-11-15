import type { StudyState } from "./state/reducer";
import { cellKey } from "./state/reducer";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Research-ready CSV: per planned variable, the value plus its source, status, confidence, evidence and reason. */
export function toCsv(s: StudyState): string {
  const vars = s.plan?.variables ?? [];
  const header = [
    "building_id",
    "costar_id",
    "name",
    "address",
    "lat",
    "lng",
    ...vars.flatMap((v) => [v.name, `${v.name}_source`, `${v.name}_status`, `${v.name}_confidence`, `${v.name}_evidence`, `${v.name}_reason`]),
  ];
  const lines = s.order.map((id) => {
    const b = s.buildings[id];
    return [
      id,
      b.costar_id,
      b.name,
      b.address,
      b.lat,
      b.lng,
      ...vars.flatMap((v) => {
        const c = s.cells[cellKey(id, v.name)];
        return [c?.value, c?.source, c?.status, c?.confidence, c?.evidence_ref, c?.reason];
      }),
    ]
      .map(esc)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

export function downloadCsv(s: StudyState) {
  const blob = new Blob([toCsv(s)], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `urbanlab-${s.studyId ?? "study"}-dataset.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
