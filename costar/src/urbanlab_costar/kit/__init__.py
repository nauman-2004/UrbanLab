"""CoStar data kit adapter (local file only; there is no CoStar API).

The workshop describes eight JSON datasets plus starter CSVs linking properties
and homes to Matterport models. Real member names and field paths are NOT
committed: they live in a local, git-ignored field map (see
``field_map.example.toml``) produced with ``urbanlab-costar kit-inspect``.
"""

from .archive import KitArchive, KitError, KitPasswordError, UnsupportedEncryption
from .mapping import DatasetMapping, FieldMap, MappingError, load_field_map
from .repository import PropertyFilter, PropertyRecord, PropertyRepository

__all__ = [
    "DatasetMapping",
    "FieldMap",
    "KitArchive",
    "KitError",
    "KitPasswordError",
    "MappingError",
    "PropertyFilter",
    "PropertyRecord",
    "PropertyRepository",
    "UnsupportedEncryption",
    "load_field_map",
]
