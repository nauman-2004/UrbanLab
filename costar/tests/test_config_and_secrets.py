from __future__ import annotations

import logging
import pickle
from pathlib import Path

import pytest

from conftest import FAKE_SECRET, make_settings
from urbanlab_costar.config import parse_env_text
from urbanlab_costar.redaction import Secret, get_logger, redact


def test_env_parser_handles_quotes_comments_export() -> None:
    text = 'export A=1\nB="two words"\nC=three # comment\n# skip\nbad line\nD=\'x#y\'\n'
    assert parse_env_text(text) == {"A": "1", "B": "two words", "C": "three", "D": "x#y"}


def test_defaults_are_offline_with_zero_budget(isolated: Path) -> None:
    s = make_settings(isolated)
    assert s.env_file is None
    assert not s.live_mode
    assert s.vexcel.max_requests == 0 and s.matterport.max_requests == 0
    assert s.live_allowed("vexcel")[0] is False
    assert any("No root .env" in w for w in s.warnings)
    assert s.data_dir == isolated / "costar" / ".local"


def test_root_env_file_is_found_and_process_env_wins(isolated: Path) -> None:
    (isolated / ".env").write_text(f"VEXCEL_API_KEY={FAKE_SECRET}\nURBANLAB_MAX_PROPERTIES=7\n")
    s = make_settings(isolated, URBANLAB_MAX_PROPERTIES="9")
    assert s.env_file == isolated / ".env"
    assert s.vexcel_api_key is not None and s.vexcel_api_key.reveal() == FAKE_SECRET
    assert s.max_properties == 9


def test_worktree_can_point_at_main_checkout_env(isolated: Path, tmp_path_factory: pytest.TempPathFactory) -> None:
    main = tmp_path_factory.mktemp("main")
    (main / ".env").write_text("MATTERPORT_API_KEY=abc12345\n")
    s = make_settings(isolated, URBANLAB_ENV_FILE=str(main / ".env"))
    assert s.env_file == main / ".env"
    assert s.matterport_api_key is not None


def test_placeholders_count_as_missing(isolated: Path) -> None:
    (isolated / ".env").write_text("VEXCEL_API_KEY=replace-me\nCOSTAR_KIT_ZIP=/absolute/path/to/costar-kit.zip\n")
    s = make_settings(isolated)
    assert s.vexcel_api_key is None and s.costar_kit_zip is None


def test_live_requires_every_switch(isolated: Path) -> None:
    base = {"VEXCEL_API_KEY": FAKE_SECRET}
    assert not make_settings(isolated, **base, VEXCEL_LIVE="1", VEXCEL_MAX_REQUESTS_PER_RUN="5").live_allowed("vexcel")[0]
    assert not make_settings(isolated, **base, URBANLAB_LIVE_MODE="1", VEXCEL_MAX_REQUESTS_PER_RUN="5").live_allowed("vexcel")[0]
    assert not make_settings(isolated, **base, URBANLAB_LIVE_MODE="1", VEXCEL_LIVE="1").live_allowed("vexcel")[0]
    ok = make_settings(isolated, **base, URBANLAB_LIVE_MODE="1", VEXCEL_LIVE="1", VEXCEL_MAX_REQUESTS_PER_RUN="5")
    assert ok.live_allowed("vexcel") == (True, "ok")
    assert not make_settings(isolated, URBANLAB_LIVE_MODE="1", VEXCEL_LIVE="1",
                             VEXCEL_MAX_REQUESTS_PER_RUN="5").live_allowed("vexcel")[0]


def test_caps_on_rate_and_retries(isolated: Path) -> None:
    s = make_settings(isolated, VEXCEL_MAX_RPS="50", URBANLAB_MAX_RETRIES="10")
    assert s.vexcel.max_rps == 5.0 and s.max_retries == 3


def test_next_public_credentials_are_flagged(isolated: Path) -> None:
    (isolated / ".env").write_text("NEXT_PUBLIC_VEXCEL_API_KEY=oops\nNEXT_PUBLIC_API_BASE=http://x\n")
    s = make_settings(isolated)
    flagged = [w for w in s.warnings if "NEXT_PUBLIC" in w]
    assert len(flagged) == 1 and "VEXCEL" in flagged[0]


def test_status_report_never_contains_secret_values(isolated: Path) -> None:
    (isolated / ".env").write_text(
        f"VEXCEL_API_KEY={FAKE_SECRET}\nMATTERPORT_API_TOKEN={FAKE_SECRET}x\nCOSTAR_ZIP_PASSWORD={FAKE_SECRET}y\n"
    )
    s = make_settings(isolated)
    text = repr(s) + str(s.status_report())
    assert FAKE_SECRET not in text
    assert ("VEXCEL_API_KEY", "set") in s.status_report()


def test_secret_masking_everywhere(caplog: pytest.LogCaptureFixture) -> None:
    s = Secret(FAKE_SECRET)
    assert FAKE_SECRET not in repr(s) and FAKE_SECRET not in str(s) and FAKE_SECRET not in f"{s}"
    with pytest.raises(TypeError):
        pickle.dumps(s)
    assert FAKE_SECRET not in redact(f"failed with key {FAKE_SECRET}")
    assert "abc" not in redact("GET /x?api_key=abc&srid=4326")
    assert "zzz" not in redact("X-API-KEY: zzz") and "qqq" not in redact("Authorization: Basic qqq")
    log = get_logger("urbanlab_costar.test")
    with caplog.at_level(logging.INFO, logger="urbanlab_costar.test"):
        log.info("leak %s", FAKE_SECRET)
    assert FAKE_SECRET not in caplog.text
