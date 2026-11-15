"""Statistics over the provenance dataset: grouped comparison by decade built, or (goal "lookup")
the ranked list of properties that met the plan's filters.

Pure pandas/numpy/scipy. Every number in the output is computed from filled
cells; the LLM only narrates it.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from dataset import VARIABLE_CATALOG, DatasetStore

ERA_CUTOFF = 1990  # "older" = built before this year
N_BOOT = 5000


def _boot_ci(values: np.ndarray, fn=np.mean, rng=None) -> tuple[float, float] | None:
    if len(values) < 2:
        return None
    rng = rng or np.random.default_rng(0)
    samples = rng.choice(values, size=(N_BOOT, len(values)), replace=True)
    boots = np.apply_along_axis(fn, 1, samples)
    return float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))


def _boot_diff_ci(a: np.ndarray, b: np.ndarray, rng=None) -> tuple[float, float] | None:
    if len(a) < 2 or len(b) < 2:
        return None
    rng = rng or np.random.default_rng(1)
    da = rng.choice(a, size=(N_BOOT, len(a)), replace=True).mean(axis=1)
    db = rng.choice(b, size=(N_BOOT, len(b)), replace=True).mean(axis=1)
    diff = da - db
    return float(np.percentile(diff, 2.5)), float(np.percentile(diff, 97.5))


def _r(x: float | None, nd: int = 2) -> float | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def wide_frame(store: DatasetStore) -> pd.DataFrame:
    rows: dict[str, dict[str, Any]] = {bid: {"building_id": bid} for bid in store.buildings}
    for cell in store.cells.values():
        if cell["status"] == "filled":
            rows.setdefault(cell["building_id"], {"building_id": cell["building_id"]})[cell["variable"]] = cell["value"]
    return pd.DataFrame(list(rows.values()))


def _fmt(value: Any, var: str) -> str:
    if value is None:
        return "not recorded"
    t = VARIABLE_CATALOG.get(var, {}).get("type")
    if t == "int" or var.startswith("year"):
        return str(int(value)) if var.startswith("year") else f"{int(value):,}"
    if t == "float":
        return f"{float(value):,.0f}" if abs(float(value)) >= 100 else f"{float(value):,.2f}"
    return str(value)


def lookup(store: DatasetStore) -> dict[str, Any]:
    """Ranked list of the properties the plan's search returned, with the values that qualified them."""
    plan = store.plan or {}
    sample = plan.get("sample", {})
    search = store.search or {}
    planned = [v["name"] for v in store.planned_variables()]
    results = []
    for rank, bid in enumerate(store.buildings, start=1):
        b = store.buildings[bid]
        values = {}
        for var in planned:
            cell = store.get_cell(bid, var)
            values[var] = cell["value"] if cell and cell["status"] == "filled" else None
        results.append({"rank": rank, "building_id": bid, "costar_id": b.get("costar_id"), "name": b.get("name"),
                        "address": b.get("address"), "values": values})

    where = f"{sample.get('city')} {sample.get('property_type')}"
    findings = []
    if search:
        order = ""
        if sample.get("sort_by"):
            order = (f", ranked by {VARIABLE_CATALOG[sample['sort_by']]['label'].lower()} "
                     f"({'largest' if sample.get('sort_desc', True) else 'smallest'} first)")
        findings.append(f"{search.get('matched', 0)} of {search.get('candidates', 0)} {where} properties in the CoStar "
                        f"data meet every condition; showing {len(results)}{order}.")
        for desc, left in search.get("steps", []):
            findings.append(f"Filter {desc}: {left} properties left.")
    for r in results:
        label = r["name"] or "unnamed"
        detail = ", ".join(f"{VARIABLE_CATALOG[v]['label']}: {_fmt(r['values'].get(v), v)}" for v in planned)
        findings.append(f"#{r['rank']} CoStar ID {r['costar_id']} ({label}): {detail}")

    limitations = []
    if any(f.get("include_missing") for f in sample.get("filters", [])):
        limitations.append("Filters marked 'or not recorded' also kept properties where CoStar has no value "
                           "(for renovation: no renovation is recorded).")
    for var in planned:
        miss = sum(1 for r in results if r["values"].get(var) is None)
        if miss:
            limitations.append(f"{var}: not recorded in CoStar for {miss} of {len(results)} listed properties.")
    limitations.extend(_source_limitations(store))
    return {"goal": "lookup", "n_buildings": len(results), "results": results, "search": search,
            "findings": findings, "effects": [], "by_decade": [], "chart_spec": None, "limitations": limitations}


def _source_limitations(store: DatasetStore) -> list[str]:
    out = []
    sources = {b.get("costar_source") for b in store.buildings.values()}
    if "sample" in sources or any(str(b.get("costar_id", "")).startswith("SAMPLE") for b in store.buildings.values()):
        out.append("Property records come from the placeholder CoStar sample CSV, not the CoStar data kit.")
    if "synthetic" in sources:
        out.append("Property records come from the costar package's synthetic test kit: invented data, "
                   "not CoStar's. Do not report these values.")
    return out


def run(store: DatasetStore) -> dict[str, Any]:
    if (store.plan or {}).get("goal") == "lookup":
        return lookup(store)
    df = wide_frame(store)
    planned = [v["name"] for v in store.planned_variables()]
    if df.empty or "year_built" not in df or df["year_built"].isna().all():
        return {"error": "No buildings with year_built; cannot run grouped comparison.", "findings": [],
                "effects": [], "chart_spec": None, "limitations": ["Dataset has no usable year_built values."]}

    df["year_built"] = pd.to_numeric(df["year_built"], errors="coerce")
    df["decade"] = (df["year_built"] // 10 * 10).astype("Int64")
    df["era"] = np.where(df["year_built"] < ERA_CUTOFF, f"pre-{ERA_CUTOFF}", f"{ERA_CUTOFF}+")

    outcomes = [v for v in planned if v != "year_built" and VARIABLE_CATALOG.get(v, {}).get("type") in {"int", "float", "bool"}]
    effects, by_decade, findings = [], [], []
    for var in outcomes:
        if var not in df:
            continue
        sub = df[["building_id", "year_built", "decade", "era", var]].copy()
        sub[var] = pd.to_numeric(sub[var], errors="coerce")
        sub = sub.dropna(subset=[var, "year_built"])
        if len(sub) < 3:
            effects.append({"variable": var, "n": int(len(sub)), "note": "Too few observations (<3) for a comparison."})
            continue

        for dec, g in sub.groupby("decade"):
            vals = g[var].to_numpy(dtype=float)
            ci = _boot_ci(vals)
            by_decade.append({"variable": var, "decade": int(dec), "n": int(len(vals)), "mean": _r(vals.mean()),
                              "ci95": [_r(ci[0]), _r(ci[1])] if ci else None})

        older = sub.loc[sub["era"] == f"pre-{ERA_CUTOFF}", var].to_numpy(dtype=float)
        newer = sub.loc[sub["era"] != f"pre-{ERA_CUTOFF}", var].to_numpy(dtype=float)
        rho, rho_p = stats.spearmanr(sub["year_built"], sub[var]) if sub[var].nunique() > 1 else (float("nan"), float("nan"))
        eff: dict[str, Any] = {
            "variable": var,
            "label": VARIABLE_CATALOG[var]["label"],
            "n": int(len(sub)),
            "n_older": int(len(older)),
            "n_newer": int(len(newer)),
            "spearman_rho_vs_year_built": _r(rho),
            "spearman_p": _r(rho_p, 3),
        }
        if len(older) and len(newer):
            diff = older.mean() - newer.mean()
            ci = _boot_diff_ci(older, newer)
            eff.update({
                "mean_older": _r(older.mean()), "mean_newer": _r(newer.mean()),
                "diff_older_minus_newer": _r(diff),
                "diff_ci95": [_r(ci[0]), _r(ci[1])] if ci else None,
            })
            if len(older) >= 2 and len(newer) >= 2:
                eff["mann_whitney_p"] = _r(stats.mannwhitneyu(older, newer, alternative="two-sided").pvalue, 3)
            if ci is None:
                ci_txt, verdict = "", "Too few buildings in one group (n<2) to estimate uncertainty; treat as anecdotal."
            elif ci[0] > 0 or ci[1] < 0:
                ci_txt, verdict = f" (95% CI {ci[0]:.2f} to {ci[1]:.2f})", "The interval excludes zero."
            else:
                ci_txt, verdict = f" (95% CI {ci[0]:.2f} to {ci[1]:.2f})", "The interval includes zero, so the difference is not distinguishable from noise."
            findings.append(
                f"{eff['label']}: buildings from before {ERA_CUTOFF} average {older.mean():.2f} vs {newer.mean():.2f} for "
                f"{ERA_CUTOFF}+ (difference {diff:+.2f}{ci_txt}; n={len(older)} vs {len(newer)}). {verdict}"
            )
        effects.append(eff)

    # Chart the first aerial-measured outcome if there is one, else the first comparable outcome.
    primary = next((e["variable"] for e in effects if "diff_older_minus_newer" in e
                    and VARIABLE_CATALOG[e["variable"]]["source"] == "vexcel"), None) or \
        next((e["variable"] for e in effects if "diff_older_minus_newer" in e), None)
    chart_spec = _chart(primary, by_decade) if primary else None

    return {
        "era_cutoff": ERA_CUTOFF,
        "n_buildings": int(len(df)),
        "findings": findings,
        "effects": effects,
        "by_decade": by_decade,
        "chart_spec": chart_spec,
        "limitations": _limitations(store, df, outcomes),
    }


def _chart(var: str, by_decade: list[dict[str, Any]]) -> dict[str, Any]:
    values = [
        {"decade": f"{r['decade']}s", "mean": r["mean"], "lo": r["ci95"][0] if r["ci95"] else r["mean"],
         "hi": r["ci95"][1] if r["ci95"] else r["mean"], "n": r["n"]}
        for r in by_decade if r["variable"] == var
    ]
    label = VARIABLE_CATALOG[var]["label"]
    return {
        "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
        "title": f"{label} by decade built (mean, bootstrap 95% CI)",
        "data": {"values": values},
        "encoding": {"x": {"field": "decade", "type": "ordinal", "title": "Decade built"}},
        "layer": [
            {"mark": "bar", "encoding": {"y": {"field": "mean", "type": "quantitative", "title": label},
                                         "tooltip": [{"field": "n"}, {"field": "mean"}, {"field": "lo"}, {"field": "hi"}]}},
            {"mark": "errorbar", "encoding": {"y": {"field": "lo", "type": "quantitative"}, "y2": {"field": "hi"}}},
        ],
    }


def _limitations(store: DatasetStore, df: pd.DataFrame, outcomes: list[str]) -> list[str]:
    cells = list(store.cells.values())
    out = [f"Small sample (n={len(df)} buildings); decade groups often have 1-3 buildings, so CIs are wide and unstable."]
    for var in outcomes:
        miss = sum(1 for c in cells if c["variable"] == var and c["status"] == "missing")
        if miss:
            out.append(f"{var}: {miss} of {len(store.buildings)} buildings missing.")
    out.extend(_source_limitations(store))
    if any(c["source"] == "vexcel" and c["status"] == "filled" for c in cells):
        out.append("Aerial measurements are vision-model estimates of surface parking; structured garages are excluded.")
    return out
