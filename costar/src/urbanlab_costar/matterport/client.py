"""Matterport Model API (GraphQL, production only, HTTP basic auth key:token).

Queries are taken from the sponsor quickstart. Signed URLs in responses expire,
so they are never cached or persisted.
"""

from __future__ import annotations

import re
from typing import Any

from ..budget import RequestBudget
from ..config import Settings
from ..http import ApiClient, BlockedTransport, Transport, UrllibTransport

BASE_URL = "https://api.matterport.com/api/models"
SID_RE = re.compile(r"^[A-Za-z0-9]{6,20}$")

Q_BASICS = """query Basics($id: ID!) { model(id: $id) {
  id name visibility
  address { locality administrativeArea }
  geolocation { lat long }
  propertyClassifications { classification type }
  floors { id label } rooms { id } panoLocations { id }
} }"""

Q_ROOMS = """query Rooms($id: ID!) { model(id: $id) {
  rooms { id floor { id } classifications { label confidence }
          dimensions(units: metric) { areaFloor } }
} }"""


class MatterportError(RuntimeError):
    pass


class MatterportNotFound(MatterportError):
    pass


def showcase_url(sid: str) -> str:
    """Hosted Showcase player URL (no key needed for public/unlisted models)."""
    if not SID_RE.fullmatch(sid):
        raise ValueError("invalid Matterport model id")
    return f"https://my.matterport.com/show/?m={sid}&play=1&qs=1"


class MatterportClient:
    def __init__(self, api: ApiClient) -> None:
        self.api = api

    @classmethod
    def from_settings(cls, settings: Settings, transport: Transport | None = None) -> MatterportClient:
        allowed, why = settings.live_allowed("matterport")
        if transport is None:
            transport = UrllibTransport() if allowed else BlockedTransport(why)
        auth = None
        if settings.matterport_api_key and settings.matterport_api_token:
            auth = (settings.matterport_api_key, settings.matterport_api_token)
        budget = RequestBudget("matterport", settings.matterport.max_requests, settings.matterport.max_rps)
        return cls(ApiClient("matterport", BASE_URL, transport, budget, basic_auth=auth,
                             timeout_s=settings.http_timeout_s, max_retries=settings.max_retries))

    def graph(self, query: str, **variables: Any) -> dict[str, Any]:
        resp = self.api.request("POST", "graph", json_body={"query": query, "variables": variables})
        if resp.status in (401, 403):
            raise MatterportError(f"Matterport rejected the key (HTTP {resp.status}); check key/token")
        if not resp.ok:
            raise MatterportError(f"Matterport HTTP {resp.status}")
        body = resp.json() or {}
        for err in body.get("errors") or []:
            code = (err.get("extensions") or {}).get("code", "")
            if code == "not.found":
                raise MatterportNotFound("model not found or not shared with this key")
            raise MatterportError(f"GraphQL error: {str(err.get('message', ''))[:200]}")
        data = body.get("data")
        if not isinstance(data, dict):
            raise MatterportError("unexpected GraphQL response")
        return data

    def model_basics(self, sid: str) -> dict[str, Any]:
        showcase_url(sid)  # validates id
        return dict(self.graph(Q_BASICS, id=sid).get("model") or {})

    def model_rooms(self, sid: str) -> list[dict[str, Any]]:
        showcase_url(sid)
        return list((self.graph(Q_ROOMS, id=sid).get("model") or {}).get("rooms") or [])
