"use client";

import Link from "next/link";
import { downloadCsv } from "@/lib/csv";
import { fmtNum, fmtP } from "@/lib/format";
import { useStudy } from "@/lib/state/StudyProvider";
import type { Effect, Findings, Source } from "@/lib/types";
import { Card, CardHeader, Label } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { SOURCE_META, SourceDot } from "../ui/Provenance";
import { DecadeChart } from "./DecadeChart";

function Stat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-[#0e1229] px-3 py-2.5">
      <b className={`block font-mono text-xl font-semibold ${tone ?? ""}`}>{value}</b>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

const ciExcludesZero = (e: Effect) => {
  const ci = e.diff_ci95;
  return !!ci && ci[0] != null && ci[1] != null && (ci[0] > 0 || ci[1] < 0);
};

/** Findings computed by the backend (analysis.py) from filled cells; the LLM only narrates them. */
export function FindingsView() {
  const { state, status } = useStudy();
  const f: Findings | null = state.findings;

  if (!state.studyId) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="mb-3 text-sm text-muted">No study yet.</p>
          <Link href="/" className="rounded-[9px] bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white">
            Run a study in the Workspace
          </Link>
        </div>
      </div>
    );
  }

  const cells = Object.values(state.cells);
  const total = state.order.length * (state.plan?.variables.length ?? 0);
  const filled = cells.filter((c) => c.status === "filled").length;
  const bySource = (["costar", "vexcel"] as Source[]).map((s) => ({ s, n: cells.filter((c) => c.source === s && c.status === "filled").length }));
  const compared = (f?.effects ?? []).filter((e) => e.diff_older_minus_newer != null || e.note);
  const chartTitle = f?.chart_spec?.title;
  const chartValues = f?.chart_spec?.data?.values ?? [];
  const cutoff = f?.era_cutoff ?? 1990;

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_372px]">
      <Card>
        <CardHeader icon="report" title="Findings Report" aside={state.finished ? (state.error ? "study failed" : "final") : "the agent is still running"} />
        <div className="px-4 py-4 sm:px-5">
          {!f && (
            <p className="mb-3 rounded-lg border border-line2 bg-well px-3 py-2 text-xs text-muted">
              {state.error
                ? `The study failed before analysis: ${state.error}`
                : status === "awaiting"
                  ? "The agent is waiting for an approval. Findings appear when the analyst subagent finishes."
                  : "Findings appear when the analyst subagent finishes."}
            </p>
          )}
          {f?.error && <p className="mb-3 rounded-lg border border-gap/40 bg-gap/10 px-3 py-2 text-xs text-gap">{f.error}</p>}

          {state.summary && (
            <>
              <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/12 px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.08em] text-accent2">
                ● PRINCIPAL INVESTIGATOR SUMMARY
              </span>
              <p className="mb-4 text-[15px] leading-relaxed text-soft whitespace-pre-line">{state.summary}</p>
            </>
          )}
          {state.plan && (
            <p className="mb-4 text-[12.5px] text-muted">
              <b className="text-ink">Hypothesis:</b> {state.plan.hypothesis}
            </p>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat value={String(f?.n_buildings ?? state.order.length)} label="buildings in the sample" />
            <Stat value={total ? `${Math.round((filled / total) * 100)}%` : "—"} tone="text-voice" label={`dataset coverage · ${filled}/${total} cells`} />
            <Stat value={String(state.order.filter((id) => state.buildings[id]?.aerial_url).length)} label="buildings with aerial imagery" />
            <Stat value={String(f?.limitations.length ?? 0)} tone="text-unverified" label="limitations reported" />
          </div>

          {chartValues.length > 0 && (
            <div className="mb-4 rounded-xl border border-line bg-[#0e1229] p-3">
              <h3 className="text-xs font-semibold">{chartTitle}</h3>
              <p className="mb-1.5 text-[11px] text-muted">Bars are means by decade built; whiskers are bootstrap 95% CIs (none when a decade has one building).</p>
              <DecadeChart values={chartValues} />
            </div>
          )}

          {compared.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-xs">
                <caption className="bg-[#0e1229] px-3 py-2 text-left text-xs font-semibold">Older (before {cutoff}) vs newer buildings</caption>
                <thead>
                  <tr className="border-y border-line text-left text-[11px] text-muted">
                    <th className="px-3 py-1.5 font-semibold">Variable</th>
                    <th className="px-3 py-1.5 font-semibold">n old / new</th>
                    <th className="px-3 py-1.5 font-semibold">Mean old</th>
                    <th className="px-3 py-1.5 font-semibold">Mean new</th>
                    <th className="px-3 py-1.5 font-semibold">Difference (95% CI)</th>
                    <th className="px-3 py-1.5 font-semibold">Spearman ρ</th>
                    <th className="px-3 py-1.5 font-semibold">Mann-Whitney p</th>
                  </tr>
                </thead>
                <tbody>
                  {compared.map((e) => {
                    const src = state.plan?.variables.find((v) => v.name === e.variable)?.source;
                    return (
                      <tr key={e.variable} className="border-b border-[#1b2040]">
                        <th scope="row" className="px-3 py-1.5 text-left font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {src && <SourceDot source={src} />}
                            {e.label ?? e.variable}
                          </span>
                        </th>
                        {e.note ? (
                          <td colSpan={6} className="px-3 py-1.5 text-dim">
                            {e.note}
                          </td>
                        ) : (
                          <>
                            <td className="px-3 py-1.5 font-mono">{e.n_older} / {e.n_newer}</td>
                            <td className="px-3 py-1.5 font-mono">{fmtNum(e.mean_older)}</td>
                            <td className="px-3 py-1.5 font-mono">{fmtNum(e.mean_newer)}</td>
                            <td className={`px-3 py-1.5 font-mono whitespace-nowrap ${ciExcludesZero(e) ? "text-ink" : "text-muted"}`}>
                              {fmtNum(e.diff_older_minus_newer)}
                              {e.diff_ci95 ? ` (${fmtNum(e.diff_ci95[0])} to ${fmtNum(e.diff_ci95[1])})` : " (n<2)"}
                              {ciExcludesZero(e) && <span className="ml-1 text-voice" title="95% CI excludes zero">●</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono">
                              {fmtNum(e.spearman_rho_vs_year_built)} <span className="text-dim">p {fmtP(e.spearman_p)}</span>
                            </td>
                            <td className="px-3 py-1.5 font-mono">{fmtP(e.mann_whitney_p)}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {f && f.findings.length > 0 && (
            <>
              <Label>Findings</Label>
              <ul className="space-y-1.5">
                {f.findings.map((x) => (
                  <li key={x} className="relative pl-3.5 text-[12.5px] text-soft">
                    <span className="absolute top-1.5 left-0 size-1.5 rounded-full bg-accent2" />
                    {x}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon="shield" title="Self-Critique & Evidence" />
        <div className="flex flex-1 flex-col gap-4 px-4 py-3.5 text-xs">
          <div>
            <Label>Evidence trail</Label>
            <ul className="space-y-1 text-soft">
              {bySource.map(({ s, n }) => (
                <li key={s} className="flex items-center gap-2">
                  <SourceDot source={s} />
                  <span className="flex-1">{SOURCE_META[s].label}</span>
                  <span className="font-mono">{n} values</span>
                </li>
              ))}
              <li className="flex items-center gap-2 text-gap">
                <span className="inline-block size-1.5 rounded-[2px] bg-gap" />
                <span className="flex-1">Missing, with a recorded reason</span>
                <span className="font-mono">{cells.filter((c) => c.status === "missing").length} cells</span>
              </li>
            </ul>
          </div>
          <div>
            <Label>Method</Label>
            <ol className="space-y-1 text-soft">
              <li><span className="mr-2 font-mono text-dim">01</span>Values written by tools straight from each source; none pass through the LLM</li>
              <li><span className="mr-2 font-mono text-dim">02</span>Older = built before {cutoff}; compared against newer buildings</li>
              <li><span className="mr-2 font-mono text-dim">03</span>Bootstrap 95% CIs (5,000 resamples) on means and differences</li>
              <li><span className="mr-2 font-mono text-dim">04</span>Spearman correlation with year built; Mann-Whitney U when both groups have n≥2</li>
            </ol>
          </div>
          <div>
            <Label>Limitations</Label>
            {f?.limitations.length ? (
              <ul className="space-y-1.5">
                {f.limitations.map((l) => (
                  <li key={l} className="relative pl-3.5 text-soft">
                    <span className={`absolute top-1.5 left-0 size-1.5 rounded-full ${/stub|placeholder|synthetic|sample/i.test(l) ? "bg-unverified" : "bg-vexcel"}`} />
                    {l}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-dim">Reported by the analyst when the study finishes.</p>
            )}
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3 py-1.5 text-[12.5px] font-semibold text-white">
              <Icon name="report" className="size-3.5" /> Export report
            </button>
            <button type="button" onClick={() => downloadCsv(state)} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line2 px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink">
              <Icon name="download" className="size-3.5" /> Dataset CSV
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
