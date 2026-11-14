/** Small, dependency-free statistics helpers. All functions are pure. */

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Ranks with ties averaged (1-based). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

// Regularized incomplete beta via continued fraction (Numerical Recipes 6.4).
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Student's t with df degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  return ibeta(df / 2, 0.5, df / (df + t * t));
}

export interface SpearmanResult { rho: number; p: number; n: number }

/** Spearman rank correlation; p from the t-approximation (fine for n ≥ 10). */
export function spearman(x: number[], y: number[]): SpearmanResult {
  const n = x.length;
  if (n < 3) return { rho: NaN, p: NaN, n };
  const rho = pearson(ranks(x), ranks(y));
  if (Math.abs(rho) >= 1) return { rho, p: 0, n };
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho));
  return { rho, p: tTwoSidedP(t, n - 2), n };
}

export interface MannWhitneyResult { u: number; p: number; n1: number; n2: number }

/**
 * Exact two-sided Mann–Whitney U by enumerating every split of the pooled
 * ranks (C(12,6) = 924 for the demo — trivial). Handles ties via mid-ranks.
 */
export function mannWhitneyExact(a: number[], b: number[]): MannWhitneyResult {
  const n1 = a.length, n2 = b.length, n = n1 + n2;
  if (n1 === 0 || n2 === 0) return { u: NaN, p: NaN, n1, n2 };
  const r = ranks([...a, ...b]);
  const r1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
  const uObs = r1 - (n1 * (n1 + 1)) / 2;
  const mean = (n1 * n2) / 2;
  const dObs = Math.abs(uObs - mean);
  let extreme = 0, total = 0;
  const pick = (start: number, left: number, sum: number) => {
    if (left === 0) {
      total++;
      const u = sum - (n1 * (n1 + 1)) / 2;
      if (Math.abs(u - mean) >= dObs - 1e-9) extreme++;
      return;
    }
    for (let i = start; i <= n - left; i++) pick(i + 1, left - 1, sum + r[i]);
  };
  pick(0, n1, 0);
  return { u: uObs, p: extreme / total, n1, n2 };
}

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(p < 0.01 ? 3 : 2);
}
