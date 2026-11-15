"""Secret handling: a masking wrapper plus best-effort redaction for text and logs."""

from __future__ import annotations

import logging
import re
import threading
from typing import NoReturn

MASK = "****"

_registry: set[str] = set()
_lock = threading.Lock()

# Patterns that look like credentials even if the value was never registered.
_PATTERNS = [
    re.compile(r"(?i)(authorization\s*[:=]\s*)(basic|bearer)?\s*[^\s,;'\"]+"),
    re.compile(r"(?i)(x-api-key\s*[:=]\s*)[^\s,;'\"]+"),
    re.compile(r"(?i)((?:api_key|apikey|token|password|secret)=)[^&\s'\"]+"),
]


class Secret:
    """A string that never shows its value in repr/str/format/logs.

    Call :meth:`reveal` only at the point where the value is placed on the wire.
    """

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        if not isinstance(value, str) or not value:
            raise ValueError("Secret requires a non-empty string")
        self._value = value
        register(value)

    def reveal(self) -> str:
        return self._value

    def __repr__(self) -> str:
        return f"Secret('{MASK}')"

    __str__ = __repr__

    def __format__(self, spec: str) -> str:
        return MASK

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Secret) and other._value == self._value

    def __hash__(self) -> int:
        return hash(("Secret", self._value))

    def __reduce__(self) -> NoReturn:
        raise TypeError("Secret values cannot be pickled or serialized")


def register(value: str) -> None:
    """Remember a value so :func:`redact` scrubs it from any text."""
    if value and len(value) >= 4:
        with _lock:
            _registry.add(value)


def redact(text: object) -> str:
    """Return ``text`` with registered secrets and credential-looking tokens masked."""
    s = str(text)
    with _lock:
        values = sorted(_registry, key=len, reverse=True)
    for v in values:
        if v in s:
            s = s.replace(v, MASK)
    for p in _PATTERNS:
        s = p.sub(lambda m: m.group(1) + MASK, s)
    return s


class RedactingFilter(logging.Filter):
    """Logging filter that redacts the fully formatted message."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover - malformed log call
            msg = str(record.msg)
        record.msg = redact(msg)
        record.args = ()
        return True


def get_logger(name: str = "urbanlab_costar") -> logging.Logger:
    logger = logging.getLogger(name)
    if not any(isinstance(f, RedactingFilter) for f in logger.filters):
        logger.addFilter(RedactingFilter())
    return logger
