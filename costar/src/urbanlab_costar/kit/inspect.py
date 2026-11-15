"""Local schema discovery for the kit. Output is sponsor-confidential: it is only
printed to the local terminal or written into the git-ignored data directory.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .archive import KitArchive, KitError
from .mapping import PROPERTY_FIELDS


@dataclass
class GroupSummary:
    group: str
    files: int
    formats: Counter[str]
    sampled_records: int
    paths: dict[str, Counter[str]]  # dotted path -> type counts


def _group_of(member: str) -> str:
    return member.split("/", 1)[0] if "/" in member else member


def _walk(obj: Any, prefix: str, out: dict[str, Counter[str]], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            _walk(v, f"{prefix}.{k}" if prefix else str(k), out, depth + 1)
    elif isinstance(obj, list):
        out[prefix or "[]"]["list"] += 1
        if obj:
            _walk(obj[0], f"{prefix}.0" if prefix else "0", out, depth + 1)
    else:
        out[prefix or "<value>"][type(obj).__name__ if obj is not None else "null"] += 1


def summarize(kit: KitArchive, sample_per_group: int = 25) -> list[GroupSummary]:
    groups: dict[str, list[str]] = defaultdict(list)
    for m in kit.members():
        groups[_group_of(m)].append(m)
    summaries = []
    for g, members in sorted(groups.items()):
        fmts: Counter[str] = Counter(Path(m).suffix.lower().lstrip(".") or "none" for m in members)
        paths: dict[str, Counter[str]] = defaultdict(Counter)
        n = 0
        for m in members:
            if n >= sample_per_group:
                break
            ext = Path(m).suffix.lower()
            try:
                if ext == ".json":
                    obj = kit.read_json(m)
                    for rec in (obj if isinstance(obj, list) else [obj])[:sample_per_group]:
                        _walk(rec, "", paths)
                        n += 1
                elif ext in {".jsonl", ".ndjson"}:
                    for i, rec in enumerate(kit.iter_jsonl(m)):
                        if i >= sample_per_group:
                            break
                        _walk(rec, "", paths)
                        n += 1
                elif ext == ".csv":
                    for i, row in enumerate(kit.iter_csv(m)):
                        if i >= sample_per_group:
                            break
                        for k, v in row.items():
                            paths[k]["str" if v else "null"] += 1
                        n += 1
            except (KitError, ValueError, UnicodeDecodeError):
                continue
        summaries.append(GroupSummary(g, len(members), fmts, n, dict(paths)))
    return summaries


def render(summaries: list[GroupSummary], max_paths: int = 80) -> str:
    lines = []
    for s in summaries:
        lines.append(f"## {s.group}  ({s.files} files; formats {dict(s.formats)}; sampled {s.sampled_records} records)")
        for p, types in list(sorted(s.paths.items()))[:max_paths]:
            fill = 1 - types.get("null", 0) / max(1, sum(types.values()))
            lines.append(f"    {p:<60} {'/'.join(sorted(types))}  fill={fill:.0%}")
        if len(s.paths) > max_paths:
            lines.append(f"    ... {len(s.paths) - max_paths} more paths")
    return "\n".join(lines)


def draft_field_map(summaries: list[GroupSummary]) -> str:
    """A TOML skeleton with discovered groups; field paths are left for a human to fill."""
    out = [
        "# LOCAL ONLY - derived from the sponsor kit schema. Never commit. Deleted by `urbanlab-costar purge`.",
        "# Fill each field with a dotted path from `urbanlab-costar kit-inspect` output (or leave empty).",
        "",
    ]
    for s in summaries:
        fmt = max(s.formats, key=lambda k: s.formats[k]) if s.formats else "json"
        fmt = {"ndjson": "jsonl"}.get(fmt, fmt)
        key = s.group.replace("-", "_").replace(".", "_").lower()
        pattern = f"{s.group}/*" if s.files > 1 or "/" in s.group else s.group
        out += [f"[datasets.{key}]", f'members = "{pattern}"', f'format = "{fmt}"', 'records_path = ""',
                'id = ""', ""]
    out += [
        "# Rename the commercial property dataset table to [datasets.commercial_property] and map:",
        "[datasets.commercial_property.fields]  # move under the right dataset",
        *[f'{k} = ""  # {desc}' for k, desc in PROPERTY_FIELDS.items()],
        "",
    ]
    return "\n".join(out)
