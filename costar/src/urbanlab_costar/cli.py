"""Command line: ``python -m urbanlab_costar <command>``.

  doctor        show configuration status (never prints secret values)
  demo          run the SYNTHETIC end-to-end study; print events as JSON lines
  plan          plan a spec (JSON file) without making requests
  run           run a spec; live requests need --approve-live AND the .env switches
  kit-inspect   summarize the local CoStar kit schema (local terminal only)
  kit-validate  fill rates of the local field map per region / property type
  purge         delete sponsor data + derivatives (dry run unless --yes)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import load_settings
from .redaction import redact


def _doctor(_: argparse.Namespace) -> int:
    s = load_settings()
    width = max(len(k) for k, _ in s.status_report())
    for k, v in s.status_report():
        print(f"{k:<{width}}  {redact(v)}")
    for w in s.warnings:
        print(f"WARNING: {w}")
    return 1 if any("NEXT_PUBLIC" in w for w in s.warnings) else 0


def _demo(args: argparse.Namespace) -> int:
    from .synthetic import DEMO_SPEC
    from .tools import run_research_tool

    def emit(e: dict[str, object]) -> None:
        if args.events:
            print(json.dumps(e))

    out = run_research_tool(DEMO_SPEC, "synthetic", emit=emit, profile=args.profile, finalize=True,
                            settings=load_settings())
    if not out.get("ok"):
        print(json.dumps(out.get("errors")), file=sys.stderr)
        return 1
    if args.csv:
        Path(args.csv).write_text(_dataset_csv(out), encoding="utf-8")
    if not args.events:
        ds = out["dataset"]
        print(f"SYNTHETIC demo: {len(ds['properties'])} properties, {len(out['events'])} events")
        for w in out["warnings"] + out["contract_warnings"]:
            print(f"  note: {w}")
    return 0


def _dataset_csv(out: dict[str, object]) -> str:
    """Long-format CSV (one row per value or gap) from the tool's JSON result."""
    import csv
    import io

    ds = out["dataset"]
    assert isinstance(ds, dict)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["property_id", "variable", "value", "source", "method", "verification", "confidence",
                "evidence", "gap"])
    for p in ds["properties"]:
        for k, v in p["values"].items():
            w.writerow([p["property_id"], k, json.dumps(v["value"]), v["source"], v["method"],
                        v["verification"], "" if v["confidence"] is None else v["confidence"],
                        v["evidence"].get("ref", ""), ""])
        for k, g in p["gaps"].items():
            w.writerow([p["property_id"], k, "", g["source"] or "", "", "", "", "", f"{g['kind']}: {g['reason']}"])
    return buf.getvalue()


def _plan(args: argparse.Namespace) -> int:
    from .synthetic import DEMO_SPEC
    from .tools import plan_research_tool

    spec = DEMO_SPEC if args.spec is None else json.loads(Path(args.spec).read_text(encoding="utf-8"))
    print(json.dumps(plan_research_tool(spec, args.mode, settings=load_settings()), indent=2))
    return 0


def _run(args: argparse.Namespace) -> int:
    from .tools import run_research_tool

    settings = load_settings()
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    out = run_research_tool(spec, args.mode, approved_live_requests=args.approve_live, settings=settings)
    if not out.get("ok"):
        print(json.dumps({"errors": out.get("errors"), "plan": out.get("plan")}, indent=2))
        return 1
    if args.mode == "real":
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        target = settings.data_dir / f"{out['study_id']}.json"
        target.write_text(json.dumps(out, indent=1), encoding="utf-8")
        print(f"result written to {target} (git-ignored; deleted by purge)")
    print(json.dumps({"requests_used": out["requests_used"], "warnings": out["warnings"],
                      "contract_warnings": out["contract_warnings"],
                      "properties": len(out["dataset"]["properties"])}, indent=2))
    return 0


def _kit_inspect(args: argparse.Namespace) -> int:
    if not args.confirm_local_access:
        print("Reading the CoStar kit needs explicit approval. Re-run with --confirm-local-access.")
        return 2
    from .kit import KitArchive
    from .kit.inspect import draft_field_map, render, summarize

    s = load_settings()
    if s.costar_kit_zip is None:
        print("COSTAR_KIT_ZIP is not set")
        return 1
    with KitArchive(s.costar_kit_zip, s.costar_zip_password) as kit:
        summaries = summarize(kit, args.sample)
    print("# LOCAL ONLY: sponsor-confidential schema. Do not paste into chats, issues or commits.")
    print(render(summaries))
    if args.write_draft:
        s.data_dir.mkdir(parents=True, exist_ok=True)
        target = s.data_dir / "field_map.draft.toml"
        target.write_text(draft_field_map(summaries), encoding="utf-8")
        print(f"draft written to {target} (git-ignored; deleted by purge)")
    return 0


def _kit_validate(args: argparse.Namespace) -> int:
    """Aggregate fill rates of every mapped field per region and property type (no record values)."""
    if not args.confirm_local_access:
        print("Reading the CoStar kit needs explicit approval. Re-run with --confirm-local-access.")
        return 2
    from collections import Counter, defaultdict

    from .kit import KitArchive, PropertyFilter, PropertyRecord, PropertyRepository, load_field_map
    from .research.spec import SUPPORTED_REGIONS

    s = load_settings()
    if s.costar_kit_zip is None:
        print("COSTAR_KIT_ZIP is not set")
        return 1
    fm = load_field_map(s.costar_field_map)
    fields = sorted(fm.property_fields())
    with KitArchive(s.costar_kit_zip, s.costar_zip_password) as kit:
        repo = PropertyRepository(kit, fm)
        for region in SUPPORTED_REGIONS:
            props = repo.properties(PropertyFilter(region=region, limit=10**7))
            by_type: dict[str, list[PropertyRecord]] = defaultdict(list)
            for p in props:
                by_type[str(p.get("property_type"))].append(p)
            print(f"== {region}: {len(props)} properties")
            for ptype, group in sorted(by_type.items(), key=lambda kv: -len(kv[1]))[: args.types]:
                filled: Counter[str] = Counter()
                for p in group:
                    for f in fields:
                        filled[f] += f in p.values
                rates = ", ".join(f"{f}={filled[f] / len(group):.0%}" for f in fields)
                print(f"   {ptype} (n={len(group)}): {rates}")
    return 0


def _purge(args: argparse.Namespace) -> int:
    from .purge import purge

    report = purge(load_settings(), include_sources=args.include_sources, dry_run=not args.yes)
    verb = "Would delete" if report.dry_run else "Deleted"
    for p in report.targets:
        print(f"{verb}: {p}")
    for p in report.missing:
        print(f"Not present: {p}")
    if report.dry_run:
        print("Dry run. Re-run with --yes to delete.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="urbanlab-costar")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(fn=_doctor)
    d = sub.add_parser("demo")
    d.add_argument("--events", action="store_true", help="print events as JSON lines")
    d.add_argument("--profile", choices=["strict", "extended"], default="strict")
    d.add_argument("--csv", help="write the synthetic dataset as CSV to this path")
    d.set_defaults(fn=_demo)
    p = sub.add_parser("plan")
    p.add_argument("--spec", help="JSON spec file (default: the synthetic demo spec)")
    p.add_argument("--mode", choices=["synthetic", "real"], default="synthetic")
    p.set_defaults(fn=_plan)
    r = sub.add_parser("run")
    r.add_argument("--spec", required=True, help="JSON spec file")
    r.add_argument("--mode", choices=["synthetic", "real"], default="synthetic")
    r.add_argument("--approve-live", action="store_true",
                   help="human approval for the planned live requests (budgets in .env still apply)")
    r.set_defaults(fn=_run)
    k = sub.add_parser("kit-inspect")
    k.add_argument("--confirm-local-access", action="store_true")
    k.add_argument("--write-draft", action="store_true")
    k.add_argument("--sample", type=int, default=25)
    k.set_defaults(fn=_kit_inspect)
    v = sub.add_parser("kit-validate")
    v.add_argument("--confirm-local-access", action="store_true")
    v.add_argument("--types", type=int, default=6, help="property types per region to show")
    v.set_defaults(fn=_kit_validate)
    g = sub.add_parser("purge")
    g.add_argument("--yes", action="store_true")
    g.add_argument("--include-sources", action="store_true", help="also delete the kit zip and models index")
    g.set_defaults(fn=_purge)
    args = ap.parse_args(argv)
    try:
        return int(args.fn(args))
    except Exception as e:  # never dump tracebacks that might include values
        print(f"error: {type(e).__name__}: {redact(e)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
