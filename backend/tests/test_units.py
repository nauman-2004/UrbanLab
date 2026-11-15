import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cache  # noqa: E402
import config  # noqa: E402


def test_demo_cache_replays(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(config, "DEMO_MODE", True)
    monkeypatch.setattr(config, "DEMO_REPLAY_SECONDS", 0)
    calls = []
    v1, hit1 = cache.cached("costar", "Houston|Office|8", lambda: calls.append(1) or [{"a": 1}])
    v2, hit2 = cache.cached("costar", "Houston|Office|8", lambda: calls.append(1) or [{"a": 2}])
    assert (v1, hit1, v2, hit2, len(calls)) == ([{"a": 1}], False, [{"a": 1}], True, 1)


def test_demo_cache_skips_errors(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(config, "DEMO_MODE", True)
    def boom():
        raise RuntimeError("x")
    try:
        cache.cached("vision", "t.png", boom)
    except RuntimeError:
        pass
    assert not list(tmp_path.iterdir())


def test_gemini_image_payload():
    """The vision message must convert to a Gemini inline-data image part with the tile's bytes (no network)."""
    import base64
    from langchain_google_genai.chat_models import _convert_to_parts
    tile = next(config.TILES_DIR.glob("*.png"))
    raw = tile.read_bytes()
    parts = _convert_to_parts([
        {"type": "text", "text": "x"},
        {"type": "image", "base64": base64.b64encode(raw).decode(), "mime_type": "image/png"}])
    assert parts[0].text == "x"
    assert parts[1].inline_data.mime_type == "image/png" and parts[1].inline_data.data == raw
