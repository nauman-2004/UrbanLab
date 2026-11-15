"""Vexcel API 2.0 adapter (https://api.vexcelgroup.com/v2, ``X-API-KEY`` header).

Endpoints and parameters follow the sponsor's quickstart/tutorial and workshop
slides. Response fields read here are only those the quickstart itself reads.
"""

from .adapter import VexcelAdapter
from .client import VexcelClient, VexcelError, VexcelNotFound
from .parse import Detection, ParcelResult, parse_detections, parse_property

__all__ = [
    "Detection",
    "ParcelResult",
    "VexcelAdapter",
    "VexcelClient",
    "VexcelError",
    "VexcelNotFound",
    "parse_detections",
    "parse_property",
]
