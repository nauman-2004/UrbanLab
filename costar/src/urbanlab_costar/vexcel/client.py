"""Thin Vexcel client: request construction, geofence pre-check, error mapping."""

from __future__ import annotations

from typing import Any

from .. import geo
from ..budget import RequestBudget
from ..config import Settings
from ..http import ApiClient, BlockedTransport, HttpResponse, Transport, UrllibTransport

BASE_URL = "https://api.vexcelgroup.com/v2"
# Ask for every ortho layer so the API picks the best available one (quickstart).
ORTHO_LAYERS = "urban,urban-r,wide-area,urban-g"
OBLIQUE_DIRECTIONS = ("oblique-north", "oblique-south", "oblique-east", "oblique-west")
MAX_EMBEDDING_RECORDS = 25


class VexcelError(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class VexcelNotFound(VexcelError):
    """404: e.g. no property record (parcel) at this point."""


class VexcelClient:
    def __init__(self, api: ApiClient) -> None:
        self.api = api

    @classmethod
    def from_settings(cls, settings: Settings, transport: Transport | None = None) -> VexcelClient:
        """Live transport only if settings allow it; otherwise every call is refused."""
        allowed, why = settings.live_allowed("vexcel")
        if transport is None:
            transport = UrllibTransport() if allowed else BlockedTransport(why)
        headers = {"X-API-KEY": settings.vexcel_api_key} if settings.vexcel_api_key else {}
        budget = RequestBudget("vexcel", settings.vexcel.max_requests, settings.vexcel.max_rps)
        return cls(ApiClient("vexcel", BASE_URL, transport, budget, headers=headers,
                             timeout_s=settings.http_timeout_s, max_retries=settings.max_retries))

    # ------------------------------------------------------------ helpers
    @staticmethod
    def _check(resp: HttpResponse, what: str) -> HttpResponse:
        if resp.ok:
            return resp
        if resp.status == 404:
            raise VexcelNotFound(f"{what}: no data (404)", 404)
        if resp.status == 403:
            raise geo.GeofenceError(f"{what}: 403 from Vexcel (outside the key's geofence or not permitted)")
        if resp.status == 401:
            raise VexcelError(f"{what}: 401 unauthorized (check VEXCEL_API_KEY)", 401)
        if resp.status == 429:
            raise VexcelError(f"{what}: still rate limited after bounded retries", 429)
        raise VexcelError(f"{what}: HTTP {resp.status}: {resp.text_excerpt()}", resp.status)

    @staticmethod
    def _precheck(lat: float, lon: float) -> None:
        geo.require_coverage("vexcel", lat, lon)

    # ---------------------------------------------------------- endpoints
    def property_extract(self, lat: float, lon: float) -> dict[str, Any]:
        """GET property/extract: parcel polygon + structures + precomputed attributes."""
        self._precheck(lat, lon)
        resp = self.api.request("GET", "property/extract", params={
            "wkt": geo.point_wkt(lat, lon), "srid": 4326, "layer": ORTHO_LAYERS,
            "latest": "true", "include": "precomputed", "unit-system": "imperial",
        })
        body = self._check(resp, "property/extract").json()
        if not isinstance(body, dict):
            raise VexcelError("property/extract: unexpected response shape")
        return body

    def detect_elements(self, lat: float, lon: float, area_wkt: str, labels: list[str],
                        threshold: float = 0.5) -> dict[str, Any]:
        """POST elements/detect on the ortho image of ``area_wkt`` (SAM3, open vocabulary)."""
        if not labels or len(labels) > 5:
            raise ValueError("pass 1-5 labels")
        self._precheck(lat, lon)
        resp = self.api.request("POST", "elements/detect", json_body={
            "wkt": area_wkt, "srid": 4326, "buffer-meter": 0,
            "images": [{"endpoint": "ortho/extract", "request": {
                "layer": ORTHO_LAYERS, "srid": 4326, "wkt": area_wkt, "crop": "bounding_box"}}],
            "model-input": {
                "elements": [{"label": lb, "model": "sam3", "detection-threshold": threshold} for lb in labels],
                "include": ["bbox", "confidence"],
            },
        })
        body = self._check(resp, "elements/detect").json()
        if not isinstance(body, dict):
            raise VexcelError("elements/detect: unexpected response shape")
        return body

    def ortho_extract(self, lat: float, lon: float, area_wkt: str, *, buffer_m: int = 10,
                      image_format: str = "jpeg") -> bytes:
        """POST ortho/extract -> image bytes. Store only in the git-ignored data dir."""
        self._precheck(lat, lon)
        resp = self.api.request("POST", "ortho/extract", json_body={
            "wkt": area_wkt, "srid": 4326, "layer": ORTHO_LAYERS, "buffer-meter": buffer_m,
            "crop": "bounding_box", "image-format": image_format,
        })
        return self._check(resp, "ortho/extract").body

    def oriented_extract(self, lat: float, lon: float, area_wkt: str, direction: str) -> bytes:
        """POST oriented/extract (oblique imagery; 'urban' layer only)."""
        if direction not in OBLIQUE_DIRECTIONS:
            raise ValueError(f"direction must be one of {OBLIQUE_DIRECTIONS}")
        self._precheck(lat, lon)
        resp = self.api.request("POST", "oriented/extract", json_body={
            "wkt": area_wkt, "srid": 4326, "layer": "urban", "product-type": direction,
            "rotation": "natural", "buffer-meter": 10, "crop": "bbox", "image-format": "jpeg",
        })
        return self._check(resp, "oriented/extract").body

    def embedding_search(self, lat: float, lon: float, text: str, *, half_m: float = 1000,
                         total_records: int = 10) -> dict[str, Any]:
        """POST embedding/extract: semantic search in a square around a point (bounded)."""
        n = max(1, min(total_records, MAX_EMBEDDING_RECORDS))
        self._precheck(lat, lon)
        resp = self.api.request("POST", "embedding/extract", json_body={
            "wkt": geo.square_wkt(lat, lon, min(half_m, 3000)), "srid": 4326, "search-text": text,
            "include": "score,geometry,collection", "total-records": n, "page-size": n,
        })
        body = self._check(resp, "embedding/extract").json()
        if not isinstance(body, dict):
            raise VexcelError("embedding/extract: unexpected response shape")
        return body

    @property
    def requests_used(self) -> int:
        return self.api.budget.used
