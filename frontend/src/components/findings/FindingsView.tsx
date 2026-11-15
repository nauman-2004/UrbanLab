"use client";

import Link from "next/link";
import { computeFindings, fmt } from "@/lib/analysis";
import { toCsv } from "@/lib/csv";
import { useStudy } from "@/lib/state/StudyProvider";
import { fmtP } from "@/lib/stats";
import { Card, CardHeader, Label } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { SupplyBars, supplySegments } from "./SupplyBars";
import { studyAreaLabel } from "../workspace/StudyMap";
import { GenericFindings } from "./GenericFindings";
import { SurfaceScatter } from "./SurfaceScatter";

function Stat({ value, label, tone, warn }: { value: string; label: string; tone?: string; warn?: string }) {
  return (
    <div className="rounded-xl border border-line bg-[#0e1229] px-3 py-2.5">
      <b className={`block font-mono text-xl font-semibold ${tone ?? ""}`}>{value}</b>
      <span className="text-[11px] text-muted">{label}</span>
      {warn && <span className="mt-1 block text-[10.5px] font-medium text-unverified">⚠ {warn}</span>}
    </div>
  );
}

export function FindingsView() {
  const { state, status } = useStudy();

  if (state.order.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="mb-3 text-sm text-muted">No study data yet.</p>
          <Link href="/" className="rounded-[9px] bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-white">
            Run the study in the Workspace
          </Link>
        </div>
      </div>
    );
  }

  // The parking analysis applies only to the parking template with measured surface areas;
  // any other question (or a parking study without Vexcel values yet) gets a descriptive summary.
  const keys = state.plan?.variables.map((v) => v.key) ?? [];
  const parking = !state.plan || (["yearBuilt", "surfaceSf"].every((k) => keys.includes(k)) &&
    state.order.some((id) => state.rows[id].cells.surfaceSf));
  if (!parking) return <GenericFindings />;
  const area = studyAreaLabel(state.order.map((id) => state.rows[id].info));
  const f = computeFindings(state);
  const final = state.reportDraft != null;
  const pre = supplySegments(f.rows.filter((r) => r.era === "pre"), state.rows);
  const post = supplySegments(f.rows.filter((r) => r.era === "post"), state.rows);
  const supplyP = f.supply.test.p;
  const similar = Number.isFinite(supplyP) && supplyP >= 0.05;
  const scans = Object.values(state.rows).filter((r) => r.cells.garageStalls?.source === "matterport").length;
  const inferred = Object.values(state.rows).filter((r) => r.cells.garageStalls?.source === "costar").length;
  const ivCount = f.interviewImpact.length;
  const ivSpaces = f.interviewImpact.reduce((s, x) => s + x.spaces, 0);
  const biggest = [...f.interviewImpact].sort((a, b) => b.with - b.without - (a.with - a.without))[0];
  const rowsWithUnverified = f.rows.filter((r) => r.unverified).length;

  const download = () => {
    const blob = new Blob([toCsv(state.order.map((id) => state.rows[id]))], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `urbanlab-${state.studyId ?? "study"}-dataset.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_372px]">
      <Card>
        <CardHeader
          icon="report"
          title="Findings Report"
          aside={final ? `draft ${state.reportDraft} · n = ${f.nComplete} / ${f.nTotal} complete` : "preliminary · updates live"}
        />
        <div className="px-4 py-4 sm:px-5">
          {!final && (
            <p className="mb-3 rounded-lg border border-line2 bg-well px-3 py-2 text-xs text-muted">
              {status === "awaiting" ? "The agent is waiting for interview approval." : "The study is still running."} These numbers are computed from the data collected so far and will change.
            </p>
          )}
          <span className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/12 px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.08em] text-accent2">
            ● {f.verdict.label.toUpperCase()}
          </span>
          <h2 className="mb-4 text-xl leading-snug font-bold tracking-tight sm:text-2xl">
            Pre-1980 {area ? `${area} ` : ""}buildings devote <span className="text-vexcel">{fmt.dec(f.surface.multiple, 1)}× more of their lot</span> to surface parking
            {similar ? (
              <>
                , but once off-site leases are counted, <span className="text-voice">total parking supply is about the same</span>. Older buildings spread
                parking across the ground; newer ones stack it in garages.
              </>
            ) : (
              "."
            )}
          </h2>

          <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat value={fmt.dec(f.surface.preMedian)} tone="text-vexcel" label={`median surface ratio, pre-1980 (n=${f.surface.nPre})`} />
            <Stat value={fmt.dec(f.surface.postMedian)} tone="text-vexcel" label={`median surface ratio, post-2000 (n=${f.surface.nPost})`} />
            <Stat value={`ρ ${fmt.dec(f.trend.rho)}`} label={`Spearman, year vs surface ratio · p = ${fmtP(f.trend.p)} · n = ${f.trend.n}`} />
            <Stat
              value={`${fmt.dec(f.supply.pre.mean)} vs ${fmt.dec(f.supply.post.mean)}`}
              tone="text-voice"
              label={`mean stalls / 1k sf, old vs new · Mann-Whitney p = ${fmtP(supplyP)}`}
              warn={rowsWithUnverified ? `${rowsWithUnverified} rows rely on unverified interviews` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
            <div className="rounded-xl border border-line bg-[#0e1229] p-3">
              <h3 className="text-xs font-semibold">Surface-parking share of lot, by year built</h3>
              <p className="mb-1.5 text-[11px] text-muted">
                Each point is a building (Vexcel ÷ CoStar). Ringed points were completed by interview; a dashed ring means unverified. The dashed line is a least-squares guide.
              </p>
              <SurfaceScatter rows={f.rows} />
            </div>
            <div className="rounded-xl border border-line bg-[#0e1229] p-3">
              <h3 className="text-xs font-semibold">Where the parking is (mean stalls per 1,000 sf)</h3>
              <p className="mb-1.5 text-[11px] text-muted">Totals are close; the mix is not. Segments are split by data source. Hatched segments are inferred or self-reported.</p>
              <SupplyBars pre={pre} post={post} />
            </div>
          </div>

          {ivCount > 0 && biggest && (
            <div className="mt-3 flex gap-3 rounded-xl border border-voice/35 bg-gradient-to-r from-voice/10 to-transparent px-3.5 py-3 text-[12.5px]">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-voice/15 font-bold text-voice">↻</span>
              <p className="text-soft">
                <b className="text-voice">The interviews changed the conclusion.</b> Without them, {biggest.name} would appear to have only{" "}
                <span className="font-mono">{fmt.dec(biggest.without)}</span> stalls per 1k sf, implausibly low for an office building of that size. {ivCount} interviews found{" "}
                <span className="font-mono">{fmt.int(ivSpaces)}</span> off-site leased spaces that no digital source recorded
                {f.nUnverified > 0 && <span className="text-unverified"> ({f.nUnverified} still unverified)</span>}.{" "}
                {f.interviewImpact.map((x) => (
                  <span key={x.id} className="mr-1 rounded border border-line2 bg-[#0c1023] px-1 font-mono text-[10px] text-soft">
                    {state.rows[x.id].cells.offsiteSpaces?.evidence.ref}
                  </span>
                ))}
              </p>
            </div>
          )}

          {f.nUnverified > 0 && Number.isFinite(f.sensitivity.test.p) && (
            <p className="mt-3 text-[11.5px] text-muted">
              <b className="text-unverified">Sensitivity check:</b> excluding rows with unverified values, mean supply is {fmt.dec(f.sensitivity.pre.mean)} vs{" "}
              {fmt.dec(f.sensitivity.post.mean)} stalls / 1k sf (n = {f.sensitivity.pre.n} / {f.sensitivity.post.n}, p = {fmtP(f.sensitivity.test.p)}). The conclusion{" "}
              {(f.sensitivity.test.p >= 0.05) === similar ? "does not change" : "changes"}.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon="shield" title="Self-Critique & Evidence" />
        <div className="flex flex-1 flex-col gap-4 px-4 py-3.5 text-xs">
          <div>
            <Label>Evidence trail</Label>
            <p className="leading-relaxed text-soft">
              Lots and build years come from <Ref>CoStar ×{f.nTotal}</Ref>. Surface parking is segmented from <Ref>Vexcel ×{f.rows.filter((r) => r.surfaceSf != null).length}</Ref>.
              Garages are counted in <Ref>Matterport ×{scans}</Ref>, with {inferred} inferred from CoStar notes. Off-site leases come from CoStar notes
              {ivCount > 0 && (
                <>
                  {" "}and <Ref>interviews ×{ivCount}</Ref>, each with consent and a recording
                </>
              )}
              .
            </p>
          </div>
          <div>
            <Label>Method</Label>
            <ol className="space-y-1 text-soft">
              <li><span className="mr-2 font-mono text-dim">01</span>Sampled {f.nTotal} properties{area ? ` in ${area}` : ""} ({f.surface.nPre} pre-1980 / {f.surface.nPost} post-2000)</li>
              <li><span className="mr-2 font-mono text-dim">02</span>Surface ratio = segmented surface lot ÷ CoStar lot area</li>
              <li><span className="mr-2 font-mono text-dim">03</span>Supply = surface (320 sf/stall) + garage + off-site, per 1k sf RBA</li>
              <li><span className="mr-2 font-mono text-dim">04</span>Spearman rank correlation; exact Mann-Whitney U</li>
            </ol>
          </div>
          <div>
            <Label>Limitations</Label>
            <ul className="space-y-1.5">
              <Lim b={`Small pilot (n=${f.nTotal}).`}>Limited to the sampled area and property type, so it may not hold elsewhere.</Lim>
              {inferred > 0 && <Lim b={`${inferred} buildings have no 3D scan.`}>Their garage counts are inferred from CoStar parking notes.</Lim>}
              {f.nUnverified > 0 && (
                <Lim b={`${f.nUnverified} values are self-reported and unverified.`} warn>
                  They come from interviews, not lease documents. Results are reported with and without them.
                </Lim>
              )}
              {f.declinedGaps > 0 && <Lim b={`${f.declinedGaps} interviews declined.`}>Those rows are excluded from the supply comparison.</Lim>}
              <Lim b="Land value isn't controlled for.">Older lots may simply have been cheaper.</Lim>
              <Lim b="Surface stalls are estimated">from area at 320 sf per stall, not counted.</Lim>
            </ul>
          </div>
          <div>
            <Label>Suggested follow-up</Label>
            <p className="text-soft">Verify the off-site counts against lease documents, expand the sample within the supported areas (Houston, TX and Los Angeles, CA), and add assessed land value as a control.</p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[9px] bg-gradient-to-br from-accent to-violet-600 px-3 py-1.5 text-[12.5px] font-semibold text-white">
              <Icon name="report" className="size-3.5" /> Export report
            </button>
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-[9px] border border-line2 px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-ink">
              <Icon name="download" className="size-3.5" /> Dataset CSV
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

const Ref = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded border border-line2 bg-[#0c1023] px-1 font-mono text-[10px] whitespace-nowrap text-soft">{children}</span>
);

function Lim({ b, children, warn }: { b: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <li className="relative pl-3.5 text-soft">
      <span className={`absolute top-1.5 left-0 size-1.5 rounded-full ${warn ? "bg-unverified" : "bg-vexcel"}`} />
      <b className="text-ink">{b}</b> {children}
    </li>
  );
}
