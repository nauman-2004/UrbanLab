"""Test harness: real network access is blocked for every test."""

from __future__ import annotations

import socket
from pathlib import Path
from typing import Any

import pytest

from urbanlab_costar.config import Settings, load_settings

FAKE_SECRET = "test-secret-not-real-0001"


class NetworkBlocked(RuntimeError):
    pass


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def guard(*args: Any, **kwargs: Any) -> None:
        raise NetworkBlocked("tests must not open network connections")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket, "create_connection", guard)
    monkeypatch.setattr(socket, "getaddrinfo", guard)


@pytest.fixture
def isolated(tmp_path: Path) -> Path:
    """A fake checkout root with no .env, so the developer's real .env is never read."""
    (tmp_path / ".git").mkdir()
    return tmp_path


def make_settings(root: Path, **env: str) -> Settings:
    return load_settings(environ=env, cwd=root)
