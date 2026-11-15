"""Read-only access to the kit: a (password-protected) zip or an extracted folder.

Members are streamed from the zip in memory; nothing is extracted to disk, so
no extra copies of sponsor data are created.
"""

from __future__ import annotations

import csv
import fnmatch
import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import IO, Any

from ..redaction import Secret

AES_COMPRESS_TYPE = 99


class KitError(RuntimeError):
    pass


class KitPasswordError(KitError):
    pass


class UnsupportedEncryption(KitError):
    pass


class KitArchive:
    def __init__(self, path: Path, password: Secret | None = None) -> None:
        self.path = Path(path)
        if not self.path.exists():
            raise KitError("kit path does not exist (check COSTAR_KIT_ZIP)")
        self._zip: Any = None
        if self.path.is_file():
            self._zip = self._open_zip(password)

    def _open_zip(self, password: Secret | None) -> Any:
        try:
            zf = zipfile.ZipFile(self.path)
        except zipfile.BadZipFile:
            raise KitError("kit file is not a valid zip") from None
        infos = zf.infolist()
        encrypted = [i for i in infos if i.flag_bits & 0x1]
        if any(i.compress_type == AES_COMPRESS_TYPE for i in infos):
            zf.close()
            try:
                import pyzipper  # type: ignore[import-not-found]
            except ImportError:
                raise UnsupportedEncryption(
                    "kit uses AES zip encryption; install the optional extra: pip install 'urbanlab-costar[aes]'"
                ) from None
            zf = pyzipper.AESZipFile(self.path)
        if encrypted:
            if password is None:
                raise KitPasswordError("kit is encrypted but COSTAR_ZIP_PASSWORD is not set")
            zf.setpassword(password.reveal().encode())
            probe = min(encrypted, key=lambda i: i.file_size)
            try:
                with zf.open(probe) as fh:
                    fh.read(1)
            except RuntimeError:
                raise KitPasswordError("COSTAR_ZIP_PASSWORD was rejected by the kit") from None
        return zf

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()

    def __enter__(self) -> KitArchive:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def members(self) -> list[str]:
        if self._zip is not None:
            return [n for n in self._zip.namelist() if not n.endswith("/")]
        return sorted(
            str(p.relative_to(self.path)).replace("\\", "/") for p in self.path.rglob("*") if p.is_file()
        )

    def match(self, pattern: str) -> list[str]:
        return [m for m in self.members() if fnmatch.fnmatchcase(m, pattern)]

    def open_binary(self, member: str) -> IO[bytes]:
        if self._zip is not None:
            try:
                return self._zip.open(member)  # type: ignore[no-any-return]
            except KeyError:
                raise KitError(f"member not in kit: {member}") from None
        p = (self.path / member).resolve()
        if self.path.resolve() not in p.parents:
            raise KitError("member path escapes the kit directory")
        return p.open("rb")

    def read_json(self, member: str) -> Any:
        with self.open_binary(member) as fh:
            return json.load(io.TextIOWrapper(fh, encoding="utf-8-sig"))

    def iter_jsonl(self, member: str) -> Iterator[Any]:
        with self.open_binary(member) as fh:
            for line in io.TextIOWrapper(fh, encoding="utf-8-sig"):
                if line.strip():
                    yield json.loads(line)

    def iter_csv(self, member: str) -> Iterator[dict[str, str]]:
        with self.open_binary(member) as fh:
            yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""))
