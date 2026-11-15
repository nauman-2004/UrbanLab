from __future__ import annotations

import subprocess
import sys

import pytest

from conftest import FAKE_SECRET
from urbanlab_costar.budget import BudgetExceeded, RequestBudget
from urbanlab_costar.http import (
    ApiClient,
    BlockedTransport,
    HttpRequest,
    HttpResponse,
    LiveModeDisabled,
    TransportError,
    UrllibTransport,
)
from urbanlab_costar.redaction import Secret


class Script:
    """Transport returning a scripted sequence of responses."""

    def __init__(self, *responses: HttpResponse | Exception) -> None:
        self.responses = list(responses)
        self.sent: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.sent.append(request)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def client(transport: object, budget: int = 10, retries: int = 2) -> tuple[ApiClient, list[float]]:
    sleeps: list[float] = []
    c = ApiClient("test", "https://example.invalid/v2", transport,  # type: ignore[arg-type]
                  RequestBudget("test", budget, 1000.0, sleep=lambda _s: None),
                  headers={"X-API-KEY": Secret(FAKE_SECRET)}, max_retries=retries,
                  sleep=sleeps.append, jitter=lambda: 0.0)
    return c, sleeps


def test_import_has_no_side_effects(tmp_path: object) -> None:
    """Import every module in a fresh interpreter with sockets disabled and no env."""
    code = (
        "import socket\n"
        "def boom(*a, **k): raise SystemExit('network used at import')\n"
        "socket.socket.connect = boom; socket.create_connection = boom; socket.getaddrinfo = boom\n"
        "import pkgutil, importlib, urbanlab_costar\n"
        "for m in pkgutil.walk_packages(urbanlab_costar.__path__, 'urbanlab_costar.'):\n"
        "    if m.name != 'urbanlab_costar.__main__': importlib.import_module(m.name)\n"
        "print('clean')\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=str(tmp_path),
                         env={"PATH": "/usr/bin:/bin"}, timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "clean"


def test_blocked_transport_is_default_refusal() -> None:
    c, _ = client(BlockedTransport("live mode is disabled"))
    with pytest.raises(LiveModeDisabled):
        c.request("GET", "property/extract")


def test_budget_is_hard_and_counts_attempts() -> None:
    t = Script(*[HttpResponse(200, b"{}")] * 5)
    c, _ = client(t, budget=2)
    c.request("GET", "a")
    c.request("GET", "b")
    with pytest.raises(BudgetExceeded):
        c.request("GET", "c")
    assert len(t.sent) == 2


def test_memo_prevents_duplicate_requests() -> None:
    t = Script(HttpResponse(200, b'{"x":1}'))
    c, _ = client(t)
    assert c.request("GET", "p", params={"wkt": "POINT(1 2)"}).json() == {"x": 1}
    assert c.request("GET", "p", params={"wkt": "POINT(1 2)"}).json() == {"x": 1}
    assert len(t.sent) == 1 and c.budget.used == 1


def test_bounded_retries_on_429_with_capped_retry_after() -> None:
    t = Script(HttpResponse(429, headers={"Retry-After": "999"}), HttpResponse(429), HttpResponse(429))
    c, sleeps = client(t, retries=2)
    r = c.request("GET", "p")
    assert r.status == 429 and len(t.sent) == 3
    assert sleeps[0] == 30.0 and sleeps[1] == 2.0  # cap, then exponential backoff


def test_no_retry_on_client_errors() -> None:
    t = Script(HttpResponse(400, b"bad"))
    c, _ = client(t)
    assert c.request("POST", "p", json_body={"a": 1}).status == 400
    assert len(t.sent) == 1


def test_network_error_retried_then_raised() -> None:
    t = Script(TransportError("down"), TransportError("down"))
    c, _ = client(t, retries=1)
    with pytest.raises(TransportError):
        c.request("GET", "p")
    assert len(t.sent) == 2


def test_rate_limit_spacing() -> None:
    now = [0.0]
    sleeps: list[float] = []
    b = RequestBudget("t", 5, 2.0, clock=lambda: now[0], sleep=lambda s: (sleeps.append(s), now.__setitem__(0, now[0] + s)))
    b.acquire()
    b.acquire()
    assert sleeps == [0.5]


def test_request_repr_never_shows_secret() -> None:
    req = HttpRequest("GET", "https://x.invalid/v2/p", headers={"X-API-KEY": Secret(FAKE_SECRET)})
    assert FAKE_SECRET not in repr(req)


def test_real_transport_blocked_in_tests() -> None:
    # The autouse guard means even an accidental real call cannot leave the machine.
    with pytest.raises(Exception):
        UrllibTransport().send(HttpRequest("GET", "https://api.vexcelgroup.com/v2/none", timeout_s=1))
