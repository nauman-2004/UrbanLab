"""Matterport adapter: local models index (no geo search in the API) + Model API.

Important scope limits (see costar/README.md):
- A model is often a single suite, unit or amenity, not a whole building.
- Scans are never used to infer parking or garage capacity.
- Only Houston and Los Angeles have models; Princeton is not assumed.
"""

from .adapter import MatterportAdapter
from .client import MatterportClient, MatterportError, MatterportNotFound, showcase_url
from .index import ModelsIndex, ModelSummary

__all__ = [
    "MatterportAdapter",
    "MatterportClient",
    "MatterportError",
    "MatterportNotFound",
    "ModelSummary",
    "ModelsIndex",
    "showcase_url",
]
