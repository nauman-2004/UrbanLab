"""Small HTTP layer with explicit live/offline separation.

- :class:`BlockedTransport` is the default: any send raises :class:`LiveModeDisabled`.
- :class:`UrllibTransport` performs real requests and is only built by
  :func:`build_transport` after :meth:`Settings.live_allowed` passes.
- :class:`ApiClient` adds the request budget, bounded retries, an in-run memo
  (the same request is never sent twice in one run) and safe logging (method,
  path and status only; never headers, query strings or bodies).
"""

from __future__ import annotations

import base64
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from .budget import RequestBudget
from .redaction import Secret, get_logger, redact

log = get_logger("urbanlab_costar.http")

RETRYABLE_STATUS = frozenset({429, 502, 503, 504})
MAX_BACKOFF_S = 30.0


class LiveModeDisabled(RuntimeError):
    """An authenticated request was attempted while live mode is not allowed."""


class TransportError(RuntimeError):
    """Network-level failure (DNS, TLS, timeout). Message is redacted."""


@dataclass(frozen=True)
class HttpRequest:
    method: str
    url: str
    params: Mapping[str, Any] | None = None
    json_body: Any = None
    headers: Mapping[str, str | Secret] = field(default_factory=dict)
    basic_auth: tuple[Secret, Secret] | None = None
    timeout_s: float = 60.0

    @property
    def path(self) -> str:
        return urllib.parse.urlsplit(self.url).path


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes = b""
    headers: Mapping[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8")) if self.body else None

    def text_excerpt(self, n: int = 200) -> str:
        return redact(self.body[:n].decode("utf-8", errors="replace"))


class Transport(Protocol):
    def send(self, request: HttpRequest) -> HttpResponse: ...


class BlockedTransport:
    """Default transport: refuses to send anything."""

    def __init__(self, reason: str = "live mode is disabled") -> None:
        self.reason = reason

    def send(self, request: HttpRequest) -> HttpResponse:
        raise LiveModeDisabled(f"Refusing {request.method} {request.path}: {self.reason}")


class UrllibTransport:
    """Real network transport (stdlib only). Secrets are revealed only here."""

    user_agent = "UrbanLab-hackathon/0.1"

    def send(self, request: HttpRequest) -> HttpResponse:
        url = request.url
        if request.params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(
                {k: _param(v) for k, v in request.params.items()}
            )
        headers = {"User-Agent": self.user_agent, "Accept": "application/json, image/*"}
        for k, v in request.headers.items():
            headers[k] = v.reveal() if isinstance(v, Secret) else v
        if request.basic_auth:
            user, pw = request.basic_auth
            token = base64.b64encode(f"{user.reveal()}:{pw.reveal()}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        data = None
        if request.json_body is not None:
            data = json.dumps(request.json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=request.method)
        try:
            with urllib.request.urlopen(req, timeout=request.timeout_s) as resp:  # noqa: S310
                return HttpResponse(resp.status, resp.read(), dict(resp.headers.items()))
        except urllib.error.HTTPError as e:
            return HttpResponse(e.code, e.read() or b"", dict(e.headers.items()) if e.headers else {})
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise TransportError(redact(f"{request.method} {request.path} failed: {e}")) from None


def _param(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


class ApiClient:
    def __init__(
        self,
        provider: str,
        base_url: str,
        transport: Transport,
        budget: RequestBudget,
        *,
        headers: Mapping[str, str | Secret] | None = None,
        basic_auth: tuple[Secret, Secret] | None = None,
        timeout_s: float = 60.0,
        max_retries: int = 2,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
    ) -> None:
        self.provider = provider
        self.base_url = base_url.rstrip("/")
        self.transport = transport
        self.budget = budget
        self.headers = dict(headers or {})
        self.basic_auth = basic_auth
        self.timeout_s = timeout_s
        self.max_retries = max(0, min(max_retries, 3))
        self._sleep = sleep
        self._jitter = jitter
        self._memo: dict[str, HttpResponse] = {}

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json_body: Any = None,
        memo: bool = True,
    ) -> HttpResponse:
        key = json.dumps([method, path, params, json_body], sort_keys=True, default=str)
        if memo and key in self._memo:
            log.debug("%s %s %s (memo hit, no request sent)", self.provider, method, path)
            return self._memo[key]
        req = HttpRequest(
            method=method,
            url=f"{self.base_url}/{path.lstrip('/')}",
            params=params,
            json_body=json_body,
            headers=self.headers,
            basic_auth=self.basic_auth,
            timeout_s=self.timeout_s,
        )
        resp: HttpResponse | None = None
        last_error: TransportError | None = None
        for attempt in range(self.max_retries + 1):
            self.budget.acquire()  # raises BudgetExceeded; every attempt counts
            started = time.monotonic()
            try:
                resp = self.transport.send(req)
                last_error = None
            except TransportError as e:
                last_error = e
                resp = None
            elapsed_ms = int((time.monotonic() - started) * 1000)
            log.info(
                "%s %s %s -> %s (%d ms, attempt %d)",
                self.provider, method, req.path,
                resp.status if resp else "network-error", elapsed_ms, attempt + 1,
            )
            retryable = resp is None or resp.status in RETRYABLE_STATUS
            if not retryable or attempt == self.max_retries:
                break
            self._sleep(self._backoff(attempt, resp))
        if resp is None:
            assert last_error is not None
            raise last_error
        if memo and resp.status not in RETRYABLE_STATUS:
            self._memo[key] = resp
        return resp

    def _backoff(self, attempt: int, resp: HttpResponse | None) -> float:
        if resp is not None:
            ra = {k.lower(): v for k, v in resp.headers.items()}.get("retry-after")
            if ra:
                try:
                    return min(float(ra), MAX_BACKOFF_S)
                except ValueError:
                    pass
        return min(2.0**attempt, MAX_BACKOFF_S) + self._jitter()
