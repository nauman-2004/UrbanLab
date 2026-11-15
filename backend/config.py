"""Settings loaded from .env (repo root first, then backend/.env overrides)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


def _path(name: str, default: str) -> Path:
    p = Path(os.getenv(name, default))
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


# Models (LangChain "provider:model" strings), served through OpenRouter by default.
# The agent model needs tool calling; the vision/extraction model needs image input + structured output.
MODEL = os.getenv("URBANLAB_MODEL", "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free")
_MULTIMODAL_DEFAULT = "openrouter:nvidia/nemotron-3.5-super-vl:free"
VISION_MODEL = os.getenv("URBANLAB_VISION_MODEL", _MULTIMODAL_DEFAULT)
EXTRACTION_MODEL = os.getenv("URBANLAB_EXTRACTION_MODEL", _MULTIMODAL_DEFAULT)

# Paths
DATA_DIR = _path("URBANLAB_DATA_DIR", "data")
COSTAR_CSV = _path("COSTAR_SAMPLE_CSV", "data/costar_sample.csv")
TILES_DIR = _path("VEXCEL_TILES_DIR", "data/tiles")
CACHE_DIR = _path("URBANLAB_CACHE_DIR", "data/cache")
DATASET_JSON = _path("URBANLAB_DATASET_JSON", "data/dataset.json")

# CoStar property source: auto (kit if COSTAR_KIT_ZIP is set, else sample CSV) | kit | synthetic | sample
COSTAR_SOURCE = os.getenv("URBANLAB_COSTAR_SOURCE", "auto").strip().lower()
# Seed for the random property sample drawn from the kit (reproducible, not biased toward low ids).
SAMPLE_SEED = int(os.getenv("URBANLAB_SAMPLE_SEED", "0"))
# Matterport 3D-tour links (on hold): off until a real models_index.csv is configured.
MATTERPORT_LINKS = _flag("URBANLAB_MATTERPORT_LINKS")

# Behaviour
DEMO_MODE = _flag("DEMO_MODE")
# Total seconds a cached CoStar + vision replay should take in DEMO_MODE.
DEMO_REPLAY_SECONDS = float(os.getenv("DEMO_REPLAY_SECONDS", "20"))
SURVEY_MAX_CALLS = int(os.getenv("SURVEY_MAX_CALLS", "3"))
DEFAULT_SAMPLE_N = int(os.getenv("DEFAULT_SAMPLE_N", "8"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
