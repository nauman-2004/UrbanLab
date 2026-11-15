"""Wire adapters for one of two explicit modes.

- ``synthetic``: invented fixtures only; no sponsor data, no network.
- ``real``: the local CoStar kit + local models index; Vexcel/Matterport clients
  use the live transport ONLY if :meth:`Settings.live_allowed` passes, otherwise
  every authenticated call is refused (and becomes a ``blocked`` gap).
"""

from __future__ import annotations

import tempfile
from contextlib import ExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from . import synthetic
from .budget import RequestBudget
from .config import Settings
from .http import ApiClient
from .kit import KitArchive, PropertyRepository, load_field_map
from .kit.repository import normalize_id
from .matterport import MatterportAdapter, MatterportClient, ModelsIndex
from .research.planner import Capabilities
from .research.pipeline import Adapters
from .vexcel import VexcelAdapter, VexcelClient

Mode = Literal["synthetic", "real"]


@dataclass
class Runtime:
    mode: Mode
    adapters: Adapters | None
    capabilities: Capabilities
    problems: list[str] = field(default_factory=list)
    _stack: ExitStack = field(default_factory=ExitStack)

    def close(self) -> None:
        self._stack.close()

    def __enter__(self) -> Runtime:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def build_runtime(settings: Settings, mode: Mode) -> Runtime:
    if mode == "synthetic":
        return _synthetic(settings)
    if mode == "real":
        return _real(settings)
    raise ValueError("mode must be 'synthetic' or 'real'")


LINKS_DATASET = "matterport_links"


def matterport_links(repo: PropertyRepository) -> dict[str, list[str]]:
    """Property id -> Matterport model ids from an optional kit dataset (fields property_id, model_id)."""
    if repo.field_map.get(LINKS_DATASET) is None:
        return {}
    out: dict[str, list[str]] = {}
    for r in repo.records(LINKS_DATASET):
        pid, sid = r.get("property_id"), str(r.get("model_id") or "").strip()
        if pid is None or not sid:
            continue
        key = normalize_id(pid)
        if key and sid not in out.setdefault(key, []):
            out[key].append(sid)
    return out


def _synthetic(settings: Settings) -> Runtime:
    stack = ExitStack()
    tmp = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="urbanlab-synthetic-")))
    kit = stack.enter_context(KitArchive(synthetic.build_kit(tmp)))
    fmap = load_field_map(synthetic.write_field_map(tmp))
    index = ModelsIndex.load(synthetic.write_models_index(tmp))
    vexcel = VexcelClient(ApiClient("vexcel", "https://synthetic.invalid/v2", synthetic.SyntheticVexcelTransport(),
                                    RequestBudget("vexcel", 1000, 1000.0), max_retries=0))
    mclient = MatterportClient(ApiClient("matterport", "https://synthetic.invalid/api/models",
                                         synthetic.SyntheticMatterportTransport(),
                                         RequestBudget("matterport", 1000, 1000.0), max_retries=0))
    repo = PropertyRepository(kit, fmap)
    links = matterport_links(repo)
    caps = Capabilities(kit_ready=True, kit_fields=fmap.property_fields(), vexcel="offline",
                        vexcel_reason="synthetic fixtures", matterport_index=True, matterport_api="offline",
                        matterport_reason="synthetic fixtures", budgets={"vexcel": 0, "matterport": 0},
                        max_retries=0)
    return Runtime("synthetic", Adapters(repo, VexcelAdapter(vexcel), MatterportAdapter(index, mclient, links)),
                   caps, _stack=stack)


def _real(settings: Settings) -> Runtime:
    stack = ExitStack()
    problems: list[str] = []
    repo = None
    links: dict[str, list[str]] = {}
    kit_fields: frozenset[str] = frozenset()
    if settings.costar_kit_zip is None:
        problems.append("COSTAR_KIT_ZIP is not set")
    else:
        try:
            kit = stack.enter_context(KitArchive(settings.costar_kit_zip, settings.costar_zip_password))
            fmap = load_field_map(settings.costar_field_map)
            repo = PropertyRepository(kit, fmap)
            kit_fields = fmap.property_fields()
            links = matterport_links(repo)
        except Exception as e:  # report, never crash with a traceback that could echo paths/values
            problems.append(f"CoStar kit unavailable: {type(e).__name__}: {e}")
    index = None
    if settings.matterport_index_csv:
        try:
            index = ModelsIndex.load(settings.matterport_index_csv)
        except (OSError, ValueError) as e:
            problems.append(f"models index unavailable: {e}")
    vexcel = VexcelAdapter(VexcelClient.from_settings(settings))
    mclient = MatterportClient.from_settings(settings)
    caps = Capabilities.from_settings(settings, kit_fields, repo is not None, index is not None or bool(links))
    mp = MatterportAdapter(index, mclient, links) if (index or links) else None
    adapters = Adapters(repo, vexcel, mp) if repo else None
    return Runtime("real", adapters, caps, problems, _stack=stack)
