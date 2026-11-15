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


def test_openrouter_image_payload():
    """The vision message must convert to an OpenAI-style image_url data URI for OpenRouter (no network)."""
    import base64
    from langchain_openrouter.chat_models import _format_message_content
    tile = next(config.TILES_DIR.glob("*.png"))
    b64 = base64.b64encode(tile.read_bytes()).decode()
    parts = _format_message_content([
        {"type": "text", "text": "x"}, {"type": "image", "base64": b64, "mime_type": "image/png"}])
    assert parts[1] == {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
