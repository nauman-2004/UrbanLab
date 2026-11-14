/**
 * Derived values + findings, computed from whatever is currently in the
 * dataset. Nothing on the Findings page is hard-coded: if a value changes
 * (or an interview is declined), every number and chart updates with it.
 */
import { SF_PER_STALL, STUDY } from "./data/houston";
import type { StudyState } from "./state/reducer";
import { mannWhitneyExact, median, spearman, type MannWhitneyResult, type SpearmanResult } from "./stats";
import type { Cell, PropertyRow } from "./types";

export type Era = "pre" | "post" | "mid";

export interface DerivedRow {
  id: string;
  name: string;
  era: Era | null;
  yearBuilt?: number;
  rbaSf?: number;
  lotSf?: number;
  surfaceSf?: number;
  surfaceRatio?: number;
  surfaceStalls?: number;
  garageStalls?: number;
  offsiteSpaces?: number;
  totalStalls?: number;
  stallsPer1k?: number;
  /** components per 1k sf RBA */
  per1k?: { surface: number; garage: number; offsite: number };
  /** All inputs for the parking-supply calculation are present. */
  complete: boolean;
  /** Any input is self-reported and not yet verified. */
  unverified: boolean;
  interviewed: boolean;
}

const v = (c?: Cell) => c?.value;

export function eraOf(year?: number): Era | null {
  if (year == null) return null;
  if (year < STUDY.preCutoff) return "pre";
  if (year > STUDY.postCutoff) return "post";
  return "mid";
}

export function deriveRow(row: PropertyRow): DerivedRow {
  const c = row.cells;
  const yearBuilt = v(c.yearBuilt);
  const rbaSf = v(c.rbaSf);
  const lotSf = v(c.lotSf);
  const surfaceSf = v(c.surfaceSf);
  const garageStalls = v(c.garageStalls);
  const offsiteSpaces = v(c.offsiteSpaces);
  const surfaceRatio = surfaceSf != null && lotSf ? surfaceSf / lotSf : undefined;
  const surfaceStalls = surfaceSf != null ? Math.round(surfaceSf / SF_PER_STALL) : undefined;
  const complete = rbaSf != null && surfaceStalls != null && garageStalls != null && offsiteSpaces != null;
  const totalStalls = complete ? surfaceStalls! + garageStalls! + offsiteSpaces! : undefined;
  const k = rbaSf ? rbaSf / 1000 : undefined;
  return {
    id: row.info.id,
    name: row.info.name,
    era: eraOf(yearBuilt),
    yearBuilt,
    rbaSf,
    lotSf,
    surfaceSf,
    surfaceRatio,
    surfaceStalls,
    garageStalls,
    offsiteSpaces,
    totalStalls,
    stallsPer1k: complete && k ? totalStalls! / k : undefined,
    per1k: complete && k ? { surface: surfaceStalls! / k, garage: garageStalls! / k, offsite: offsiteSpaces! / k } : undefined,
    complete,
    unverified: Object.values(c).some((cell) => cell?.verification === "unverified"),
    interviewed: Object.values(c).some((cell) => cell?.source === "interview"),
  };
}

export function deriveRows(s: StudyState): DerivedRow[] {
  return s.order.map((id) => deriveRow(s.rows[id]));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export interface EraSupply {
  n: number;
  mean: number;
  components: { surface: number; garage: number; offsite: number };
}

function supply(rows: DerivedRow[]): EraSupply {
  const r = rows.filter((x) => x.complete);
  return {
    n: r.length,
    mean: mean(r.map((x) => x.stallsPer1k!)),
    components: {
      surface: mean(r.map((x) => x.per1k!.surface)),
      garage: mean(r.map((x) => x.per1k!.garage)),
      offsite: mean(r.map((x) => x.per1k!.offsite)),
    },
  };
}

export interface Findings {
  rows: DerivedRow[];
  nTotal: number;
  nComplete: number;
  nUnverified: number;
  nVerified: number;
  nInterviewed: number;
  openGaps: number;
  declinedGaps: number;
  surface: { preMedian: number; postMedian: number; multiple: number; nPre: number; nPost: number };
  trend: SpearmanResult;
  supply: { pre: EraSupply; post: EraSupply; test: MannWhitneyResult };
  /** Same supply comparison excluding any row with unverified inputs. */
  sensitivity: { pre: EraSupply; post: EraSupply; test: MannWhitneyResult };
  /** What the interviews changed, per interviewed building. */
  interviewImpact: { id: string; name: string; without: number; with: number; spaces: number; verified: boolean }[];
  verdict: { supported: boolean; twist: boolean; label: string };
}

export function computeFindings(s: StudyState): Findings {
  const rows = deriveRows(s);
  const pre = rows.filter((r) => r.era === "pre");
  const post = rows.filter((r) => r.era === "post");

  const ratio = (rs: DerivedRow[]) => rs.filter((r) => r.surfaceRatio != null).map((r) => r.surfaceRatio!);
  const preMedian = median(ratio(pre));
  const postMedian = median(ratio(post));

  const withRatio = rows.filter((r) => r.surfaceRatio != null && r.yearBuilt != null);
  const trend = spearman(withRatio.map((r) => r.yearBuilt!), withRatio.map((r) => r.surfaceRatio!));

  const sp = supply(pre), so = supply(post);
  const test = mannWhitneyExact(
    pre.filter((r) => r.complete).map((r) => r.stallsPer1k!),
    post.filter((r) => r.complete).map((r) => r.stallsPer1k!),
  );
  const preV = pre.filter((r) => !r.unverified), postV = post.filter((r) => !r.unverified);
  const sensitivity = {
    pre: supply(preV),
    post: supply(postV),
    test: mannWhitneyExact(
      preV.filter((r) => r.complete).map((r) => r.stallsPer1k!),
      postV.filter((r) => r.complete).map((r) => r.stallsPer1k!),
    ),
  };

  const interviewImpact = s.order.flatMap((id) => {
    const row = s.rows[id];
    const off = row.cells.offsiteSpaces;
    const d = rows.find((r) => r.id === id)!;
    if (!off || off.source !== "interview" || !d.complete) return [];
    const k = d.rbaSf! / 1000;
    return [{
      id,
      name: d.name,
      without: (d.surfaceStalls! + d.garageStalls!) / k,
      with: d.stallsPer1k!,
      spaces: off.value,
      verified: off.verification === "verified",
    }];
  });

  const supported = trend.rho < 0 && trend.p < 0.05 && preMedian > postMedian;
  const twist = Number.isFinite(test.p) && test.p >= 0.05;
  const cells = Object.values(s.rows).flatMap((r) => Object.values(r.cells));

  return {
    rows,
    nTotal: rows.length,
    nComplete: rows.filter((r) => r.complete).length,
    nUnverified: cells.filter((c) => c?.verification === "unverified").length,
    nVerified: cells.filter((c) => c?.verification === "verified").length,
    nInterviewed: rows.filter((r) => r.interviewed).length,
    openGaps: s.gaps.filter((g) => g.status !== "filled").length,
    declinedGaps: s.gaps.filter((g) => g.status === "declined").length,
    surface: {
      preMedian,
      postMedian,
      multiple: preMedian / postMedian,
      nPre: ratio(pre).length,
      nPost: ratio(post).length,
    },
    trend,
    supply: { pre: sp, post: so, test },
    sensitivity,
    interviewImpact,
    verdict: {
      supported,
      twist,
      label: !Number.isFinite(trend.rho)
        ? "Not enough data yet"
        : supported
          ? twist
            ? "Hypothesis supported · with a twist"
            : "Hypothesis supported"
          : "Hypothesis not supported",
    },
  };
}

export const fmt = {
  int: (n?: number) => (n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US")),
  dec: (n?: number, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d)),
  pct: (n?: number) => (n == null || !Number.isFinite(n) ? "—" : `${Math.round(n * 100)}%`),
};
