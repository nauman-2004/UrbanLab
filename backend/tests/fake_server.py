"""Run the real API with the scripted fake model (no API key, no network).
Useful to test the HTTP/SSE flow or develop a UI against the backend.

    uv run uvicorn tests.fake_server:app --port 8000
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

import main  # noqa: E402
from agent import build_agent  # noqa: E402
from tests.test_pipeline_offline import ScriptedModel, install_fakes  # noqa: E402

# Reuse the test's fake vision patch against the real data dir.
_mp = pytest.MonkeyPatch()
install_fakes(Path(main.config.DATA_DIR), _mp, costar_source=None)  # CoStar source from .env
main._agent = build_agent(model=ScriptedModel())
app = main.app
