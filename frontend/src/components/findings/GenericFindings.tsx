"use client";

import { toCsv } from "@/lib/csv";
import { median } from "@/lib/stats";
import { useStudy } from "@/lib/state/StudyProvider";
import { varLabel } from "@/lib/state/reducer";
import type { Cell, CellScalar, Method } from "@/lib/types";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { formatValue, methodOf, NOT_AVAILABLE, SourceDot, SOURCE_META } from "../ui/Provenance";
import { studyAreaLabel } from "../workspace/StudyMap";

const METHOD_LABEL: Record<Method, string> = {
  observed: "reported",
  computed: "calculated",
  model_estimate: "estimated",
  self_reported: "interview",
};

interface Summary {
  key: string;
  label: string;
  n: number;
  missing: number;
  numeric: boolean;
  median?: number;
  min?: number;
  max?: number;
  top: [string, number][];
  sources: string[];
  methods: string[];
  unverified: number;
}

/**
 * Descriptive findings for any supported research question. Every number is computed from the
 * values currently in the dataset; nothing is inferred, imputed or tested beyond what is shown.
 */
export function GenericFindings() {
  const { state } = useStudy();
  const rows = state.order.map((id) => state.rows[id]);
  const area = studyAreaLabel(rows.map((r) => r.info));
  const planKeys = state.plan?.variables.map((v) => v.key) ?? [];
  const keys = [...new Set([...planKeys, ...rows.flatMap((r) => Object.keys(r.cells))])];
  const label = (k: string) => state.plan?.variables.find((v) => v.key === k)?.label ?? varLabel(k);

  const summaries: Summary[] = keys.map((k) => {
    const cells = rows.map((r) => r.cells[k]).filter((c): c is Cell<CellScalar> => !!c);
    const nums = cells.map((c) => c.value).filter((v): v is number => typeof v === "number");
    const numeric = cells.length > 0 && nums.length === cells.length;
    const counts = new Map<string, number>();
    if (!numeric) for (const c of cells) counts.set(formatValue(c.value), (counts.get(formatValue(c.value)) ?? 0) + 1);
    return {
      key: k,
      label: label(k),
      n: cells.length,
      missing: rows.length - cells.length,
      numeric,
      median: numeric ? median(nums) : undefined,
      min: numeric ? Math.min(...nums) : undefined,
      max: numeric ? Math.max(...nums) : undefined,
      top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      sources: [...new Set(cells.map((c) => c.source))],
      methods: [...new Set(cells.map((c) => METHOD_LABEL[methodOf(c)]))],
      unverified: cells.filter((c) => c.verification === "unverified").length,
    };
  });
  const gapReasons = new Map<string, number>();
  for (const g of state.gaps) if (g.status !== "filled") gapReasons.set(`${varLabel(g.variable)}: ${g.reason}`, (gapReasons.get(`${varLabel(g.variable)}: ${g.reason}`) ?? 0) + 1);

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `urbanlab-${state.studyId ?? "study"}-dataset.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const fmtNum = (n?: number) => (n == null ? NOT_AVAILABLE : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Card>
        <CardHeader icon="report" title="Descriptive findings" aside={<span>{rows.length} properties{area ? ` · ${area}` : ""}</span>} />
        <div className="px-4 py-3 text-[13px] text-soft">
          <p className="mb-1 font-semibold text-ink">{state.question}</p>
          <p className="text-[12px] text-muted">
            Summary of the collected evidence. UrbanLab reports what the data shows for each variable and how much is missing;
            it does not claim a causal or statistically tested answer for this question type. Estimates and interview values keep their caveats.
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader
          icon="grid"
          title="Variables"
          aside={
            <button type="button" onClick={download} className="inline-flex items-center gap-1 text-muted hover:text-ink">
              <Icon name="download" className="size-3" /> CSV
            </button>
          }
        />
        <div className="scrollbar-thin overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-left text-[11px] text-muted">
                <th scope="col" className="px-3 py-1.5">Variable</th>
                <th scope="col" className="px-3 py-1.5">Values</th>
                <th scope="col" className="px-3 py-1.5">Missing</th>
                <th scope="col" className="px-3 py-1.5">Median (min–max) / most common</th>
                <th scope="col" className="px-3 py-1.5">Source · method</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.key} className="border-b border-[#1b2040]">
                  <th scope="row" className="px-3 py-1 text-left font-medium">{s.label}</th>
                  <td className="px-3 py-1 font-mono">{s.n}</td>
                  <td className={`px-3 py-1 font-mono ${s.missing ? "text-gap" : "text-dim"}`}>{s.missing}</td>
                  <td className="px-3 py-1 font-mono">
                    {s.n === 0
                      ? NOT_AVAILABLE
                      : s.numeric
                        ? `${fmtNum(s.median)} (${fmtNum(s.min)}–${fmtNum(s.max)})`
                        : s.top.map(([v, n]) => `${v} (${n})`).join(", ")}
                  </td>
                  <td className="px-3 py-1">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {s.sources.map((src) => (
                        <span key={src} className="inline-flex items-center gap-1">
                          <SourceDot source={src as keyof typeof SOURCE_META} />
                          {SOURCE_META[src as keyof typeof SOURCE_META].label}
                        </span>
                      ))}
                      <span className="text-dim">· {s.methods.join(", ") || "—"}</span>
                      {s.unverified > 0 && <span className="text-[10px] font-bold text-unverified">⚠ {s.unverified} unverified</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {gapReasons.size > 0 && (
        <Card>
          <CardHeader icon="grid" title="Evidence gaps" aside={<span>{state.gaps.filter((g) => g.status !== "filled").length} open</span>} />
          <ul className="px-4 py-2 text-[12px] text-soft">
            {[...gapReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([r, n]) => (
              <li key={r} className="py-0.5"><span className="mr-2 font-mono text-gap">{n}×</span>{r}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
