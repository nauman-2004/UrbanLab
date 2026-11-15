"""Configuration from the single shared root ``.env`` (never copied, never written).

Resolution order for the env file:

1. ``URBANLAB_ENV_FILE`` (absolute path) from the process environment. Use this
   from a git worktree to point at the main checkout's root ``.env`` read-only.
2. ``<checkout root>/.env`` where the checkout root is the nearest ancestor of
   the working directory containing ``.git`` (a directory or a worktree file).

Process environment variables override values from the file. Values are kept
in a :class:`Settings` object; they are NOT exported into ``os.environ``.

Live (authenticated) requests require ALL of: ``URBANLAB_LIVE_MODE=1``,
``<PROVIDER>_LIVE=1`` and ``<PROVIDER>_MAX_REQUESTS_PER_RUN`` > 0.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from .redaction import Secret

SECRET_KEYS = (
    "COSTAR_ZIP_PASSWORD",
    "MATTERPORT_API_KEY",
    "MATTERPORT_API_TOKEN",
    "MATTERPORT_SDK_KEY",
    "VEXCEL_API_KEY",
)
PATH_KEYS = ("COSTAR_KIT_ZIP", "COSTAR_FIELD_MAP", "MATTERPORT_INDEX_CSV", "URBANLAB_SPONSOR_DATA_DIR")
PLAIN_KEYS = (
    "COSTAR_KIT_URL",
    "MATTERPORT_SDK_ALLOWED_DOMAINS",
    "URBANLAB_LIVE_MODE",
    "VEXCEL_LIVE",
    "MATTERPORT_LIVE",
    "VEXCEL_MAX_REQUESTS_PER_RUN",
    "MATTERPORT_MAX_REQUESTS_PER_RUN",
    "VEXCEL_MAX_RPS",
    "MATTERPORT_MAX_RPS",
    "URBANLAB_HTTP_TIMEOUT_S",
    "URBANLAB_MAX_RETRIES",
    "URBANLAB_MAX_PROPERTIES",
)
ALL_KEYS = SECRET_KEYS + PATH_KEYS + PLAIN_KEYS

PLACEHOLDERS = {"", "replace-me", "changeme", "change-me", "your-key-here", "xxx", "todo"}
MAX_RPS_CAP = 5.0
MAX_RETRIES_CAP = 3
_SENSITIVE_PUBLIC = re.compile(r"COSTAR|MATTERPORT|VEXCEL|API_KEY|TOKEN|SECRET|PASSWORD", re.I)


class ConfigError(RuntimeError):
    pass


def parse_env_text(text: str) -> dict[str, str]:
    """Minimal ``.env`` parser: ``KEY=VALUE``, optional ``export``, quotes, ``#`` comments."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        key, sep, value = line.partition("=")
        key = key.strip()
        if not sep or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        out[key] = value
    return out


def find_checkout_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / ".git").exists():
            return p
    return None


def resolve_env_file(environ: Mapping[str, str], cwd: Path) -> tuple[Path | None, list[str]]:
    warnings: list[str] = []
    explicit = environ.get("URBANLAB_ENV_FILE", "").strip()
    if explicit:
        p = Path(explicit).expanduser()
        if not p.is_absolute():
            warnings.append("URBANLAB_ENV_FILE should be an absolute path")
            p = (cwd / p).resolve()
        if not p.is_file():
            warnings.append("URBANLAB_ENV_FILE points to a file that does not exist")
            return None, warnings
        return p, warnings
    root = find_checkout_root(cwd)
    if root and (root / ".env").is_file():
        return root / ".env", warnings
    warnings.append(
        "No root .env found. Create one from .env.example at the repo root, or (in a worktree) "
        "export URBANLAB_ENV_FILE=/absolute/path/to/main-checkout/.env"
    )
    return None, warnings


@dataclass(frozen=True)
class ProviderLimits:
    live_flag: bool
    max_requests: int
    max_rps: float


@dataclass(frozen=True)
class Settings:
    env_file: Path | None
    checkout_root: Path | None
    data_dir: Path
    costar_kit_zip: Path | None
    costar_kit_url_set: bool
    costar_zip_password: Secret | None
    costar_field_map: Path
    matterport_api_key: Secret | None
    matterport_api_token: Secret | None
    matterport_sdk_key: Secret | None
    matterport_sdk_allowed_domains: tuple[str, ...]
    matterport_index_csv: Path | None
    vexcel_api_key: Secret | None
    live_mode: bool
    vexcel: ProviderLimits
    matterport: ProviderLimits
    http_timeout_s: float
    max_retries: int
    max_properties: int
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def live_allowed(self, provider: str) -> tuple[bool, str]:
        """Whether authenticated requests to ``provider`` may be sent, and why not."""
        limits = {"vexcel": self.vexcel, "matterport": self.matterport}.get(provider)
        if limits is None:
            return False, f"unknown provider {provider!r}"
        up = provider.upper()
        if not self.live_mode:
            return False, "URBANLAB_LIVE_MODE is not 1 (offline by default)"
        if not limits.live_flag:
            return False, f"{up}_LIVE is not 1"
        if limits.max_requests <= 0:
            return False, f"{up}_MAX_REQUESTS_PER_RUN is 0 (set an approved budget)"
        creds = {
            "vexcel": [self.vexcel_api_key],
            "matterport": [self.matterport_api_key, self.matterport_api_token],
        }[provider]
        if not all(creds):
            return False, f"{provider} credentials are not set in the root .env"
        return True, "ok"

    def status_report(self) -> list[tuple[str, str]]:
        """(name, status) rows safe to print: secrets show only set/missing."""
        rows: list[tuple[str, str]] = [
            ("env file", str(self.env_file) if self.env_file else "NOT FOUND"),
            ("sponsor data dir", str(self.data_dir)),
            ("COSTAR_KIT_ZIP", _path_status(self.costar_kit_zip)),
            ("COSTAR_KIT_URL", "set" if self.costar_kit_url_set else "missing"),
            ("COSTAR_ZIP_PASSWORD", _secret_status(self.costar_zip_password)),
            ("COSTAR_FIELD_MAP", _path_status(self.costar_field_map)),
            ("MATTERPORT_API_KEY", _secret_status(self.matterport_api_key)),
            ("MATTERPORT_API_TOKEN", _secret_status(self.matterport_api_token)),
            ("MATTERPORT_SDK_KEY", _secret_status(self.matterport_sdk_key)),
            ("MATTERPORT_SDK_ALLOWED_DOMAINS", ",".join(self.matterport_sdk_allowed_domains) or "missing"),
            ("MATTERPORT_INDEX_CSV", _path_status(self.matterport_index_csv)),
            ("VEXCEL_API_KEY", _secret_status(self.vexcel_api_key)),
            ("URBANLAB_LIVE_MODE", "1" if self.live_mode else "0"),
        ]
        for name, lim in (("VEXCEL", self.vexcel), ("MATTERPORT", self.matterport)):
            ok, why = self.live_allowed(name.lower())
            rows.append(
                (f"{name} live", f"{'ALLOWED' if ok else 'blocked'} "
                 f"(budget {lim.max_requests}/run, {lim.max_rps}/s){'' if ok else ': ' + why}")
            )
        rows.append(("http timeout / retries", f"{self.http_timeout_s}s / {self.max_retries}"))
        rows.append(("max properties per run", str(self.max_properties)))
        return rows


def _secret_status(s: Secret | None) -> str:
    return "set" if s else "missing"


def _path_status(p: Path | None) -> str:
    if p is None:
        return "missing"
    return f"{p} ({'exists' if p.exists() else 'NOT FOUND'})"


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


def _int(v: str | None, default: int, lo: int = 0, hi: int | None = None) -> int:
    try:
        n = int(str(v).strip()) if v not in (None, "") else default
    except ValueError:
        n = default
    n = max(lo, n)
    return min(n, hi) if hi is not None else n


def _float(v: str | None, default: float, lo: float, hi: float) -> float:
    try:
        x = float(str(v).strip()) if v not in (None, "") else default
    except ValueError:
        x = default
    return min(max(lo, x), hi)


def load_settings(environ: Mapping[str, str] | None = None, cwd: Path | None = None) -> Settings:
    environ = dict(os.environ if environ is None else environ)
    cwd = (cwd or Path.cwd()).resolve()
    env_file, warnings = resolve_env_file(environ, cwd)
    file_values = parse_env_text(env_file.read_text(encoding="utf-8")) if env_file else {}
    merged = {**file_values, **{k: v for k, v in environ.items() if k in ALL_KEYS}}

    for k in sorted(set(file_values) | set(environ)):
        if k.startswith("NEXT_PUBLIC_") and _SENSITIVE_PUBLIC.search(k):
            warnings.append(f"{k} looks like a credential exposed to the browser; remove it")

    def get(k: str) -> str | None:
        v = merged.get(k)
        return None if v is None or v.strip().lower() in PLACEHOLDERS else v.strip()

    def secret(k: str) -> Secret | None:
        v = get(k)
        return Secret(v) if v else None

    def path(k: str) -> Path | None:
        v = get(k)
        if not v or v.startswith("/absolute/path/to"):
            return None
        return Path(v).expanduser()

    root = find_checkout_root(cwd)
    data_dir = path("URBANLAB_SPONSOR_DATA_DIR") or ((root or cwd) / "costar" / ".local")
    field_map = path("COSTAR_FIELD_MAP") or (data_dir / "field_map.toml")

    return Settings(
        env_file=env_file,
        checkout_root=root,
        data_dir=data_dir,
        costar_kit_zip=path("COSTAR_KIT_ZIP"),
        costar_kit_url_set=bool(get("COSTAR_KIT_URL")),
        costar_zip_password=secret("COSTAR_ZIP_PASSWORD"),
        costar_field_map=field_map,
        matterport_api_key=secret("MATTERPORT_API_KEY"),
        matterport_api_token=secret("MATTERPORT_API_TOKEN"),
        matterport_sdk_key=secret("MATTERPORT_SDK_KEY"),
        matterport_sdk_allowed_domains=tuple(
            d.strip() for d in (get("MATTERPORT_SDK_ALLOWED_DOMAINS") or "").split(",") if d.strip()
        ),
        matterport_index_csv=path("MATTERPORT_INDEX_CSV"),
        vexcel_api_key=secret("VEXCEL_API_KEY"),
        live_mode=_bool(get("URBANLAB_LIVE_MODE")),
        vexcel=ProviderLimits(
            live_flag=_bool(get("VEXCEL_LIVE")),
            max_requests=_int(get("VEXCEL_MAX_REQUESTS_PER_RUN"), 0),
            max_rps=_float(get("VEXCEL_MAX_RPS"), 1.0, 0.05, MAX_RPS_CAP),
        ),
        matterport=ProviderLimits(
            live_flag=_bool(get("MATTERPORT_LIVE")),
            max_requests=_int(get("MATTERPORT_MAX_REQUESTS_PER_RUN"), 0),
            max_rps=_float(get("MATTERPORT_MAX_RPS"), 1.0, 0.05, MAX_RPS_CAP),
        ),
        http_timeout_s=_float(get("URBANLAB_HTTP_TIMEOUT_S"), 60.0, 1.0, 300.0),
        max_retries=_int(get("URBANLAB_MAX_RETRIES"), 2, 0, MAX_RETRIES_CAP),
        max_properties=_int(get("URBANLAB_MAX_PROPERTIES"), 25, 1, 500),
        warnings=tuple(warnings),
    )
