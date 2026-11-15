"""Hard per-run request budgets with a minimum interval between requests."""

from __future__ import annotations

import time
from collections.abc import Callable


class BudgetExceeded(RuntimeError):
    """Raised before a request would exceed the approved per-run budget."""


class RequestBudget:
    """Counts every attempt (retries included) and spaces requests ``1/max_rps`` apart."""

    def __init__(
        self,
        provider: str,
        max_requests: int,
        max_rps: float,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if max_requests < 0:
            raise ValueError("max_requests must be >= 0")
        if max_rps <= 0:
            raise ValueError("max_rps must be > 0")
        self.provider = provider
        self.max_requests = max_requests
        self.min_interval = 1.0 / max_rps
        self.used = 0
        self._clock = clock
        self._sleep = sleep
        self._last: float | None = None

    @property
    def remaining(self) -> int:
        return max(0, self.max_requests - self.used)

    def acquire(self) -> None:
        if self.used >= self.max_requests:
            raise BudgetExceeded(
                f"{self.provider}: request budget exhausted ({self.used}/{self.max_requests} used this run)"
            )
        if self._last is not None:
            wait = self.min_interval - (self._clock() - self._last)
            if wait > 0:
                self._sleep(wait)
        self._last = self._clock()
        self.used += 1

    def summary(self) -> dict[str, int | str]:
        return {"provider": self.provider, "used": self.used, "limit": self.max_requests}
