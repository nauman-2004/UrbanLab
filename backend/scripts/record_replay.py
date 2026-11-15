"""Record one study's event stream for the frontend's offline demo (replay mode).

Runs a study against a running backend, approves every gate, and writes the
events exactly as the SSE stream sent them, so replay mode shows a real run.

    uv run uvicorn main:app --port 8000          # live models (uses API quota)
    # or: uv run uvicorn tests.fake_server:app --port 8000   (scripted model, no key)
    uv run python scripts/record_replay.py [--api http://localhost:8000] [--question "..."]

Output: ../frontend/src/lib/replay/recorded-study.json
"""

from __future__ import annotations

import argparse
import json
import threading
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "frontend" / "src" / "lib" / "replay" / "recorded-study.json"
DEFAULT_Q = "Do older office buildings in Houston dedicate more land to surface parking?"


def scrub(obj):
    """Make absolute paths repo-relative, so the committed recording holds no machine/user paths."""
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    if isinstance(obj, str):
        for root in {str(REPO), str(REPO).replace("\\", "/")}:
            obj = obj.replace(root + "\\", "").replace(root + "/", "")
        return obj.replace("\\", "/") if obj.startswith("backend\\") else obj
    return obj


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--question", default=DEFAULT_Q)
    args = p.parse_args()

    with httpx.Client(base_url=args.api, timeout=None) as client:
        sid = client.post("/studies", json={"question": args.question}).raise_for_status().json()["study_id"]
        print(f"study {sid}")
        recorded: list[dict] = []
        with client.stream("GET", f"/studies/{sid}/events") as resp:
            for line in resp.iter_lines():
                if not line.startswith("data: "):
                    continue
                ev = json.loads(line[6:])
                recorded.append(ev)
                print(f"  {ev['seq']:>4} {ev['type']}")
                if ev["type"] == "approval_required":
                    action_id = ev["data"]["action_id"]
                    # Approve off the stream thread so reading continues.
                    threading.Thread(target=lambda a=action_id: httpx.post(
                        f"{args.api}/studies/{sid}/approve", json={"action_id": a, "approved": True}), daemon=True).start()
                if ev["type"] in {"study_completed", "study_failed"}:
                    break

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(scrub(recorded), indent=1, default=str), encoding="utf-8")
    print(f"wrote {len(recorded)} events -> {OUT}")


if __name__ == "__main__":
    main()
