"""Delete sponsor data and everything derived from it (sponsor terms §2.3).

Dry run by default. Deletes:
- the sponsor data directory (field map, inspection output, caches, imagery)
- the configured field map if it lives elsewhere
- with ``include_sources``: the kit zip and the models index CSV themselves
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .config import Settings


class UnsafePurge(RuntimeError):
    pass


@dataclass
class PurgeReport:
    targets: list[Path] = field(default_factory=list)
    deleted: list[Path] = field(default_factory=list)
    missing: list[Path] = field(default_factory=list)
    dry_run: bool = True


def _guard(p: Path, settings: Settings) -> None:
    rp = p.expanduser().resolve()
    forbidden = {Path("/").resolve(), Path.home().resolve()}
    if settings.checkout_root:
        forbidden.add(settings.checkout_root.resolve())
        forbidden.add((settings.checkout_root / "costar").resolve())
    if rp in forbidden or len(rp.parts) < 3:
        raise UnsafePurge(f"refusing to delete {rp}")
    if rp.is_dir() and settings.checkout_root and (rp / ".git").exists():
        raise UnsafePurge(f"refusing to delete a git checkout: {rp}")


def purge(settings: Settings, *, include_sources: bool = False, dry_run: bool = True) -> PurgeReport:
    targets = [settings.data_dir, settings.costar_field_map]
    if include_sources:
        targets += [p for p in (settings.costar_kit_zip, settings.matterport_index_csv) if p]
    report = PurgeReport(dry_run=dry_run)
    seen: set[Path] = set()
    for t in targets:
        rt = t.expanduser().resolve()
        if rt in seen or any(parent in seen for parent in rt.parents):
            continue
        seen.add(rt)
        _guard(rt, settings)
        if not rt.exists():
            report.missing.append(rt)
            continue
        report.targets.append(rt)
        if dry_run:
            continue
        if rt.is_dir():
            shutil.rmtree(rt)
        else:
            rt.unlink()
        report.deleted.append(rt)
    return report
