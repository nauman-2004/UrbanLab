"""Generate SCHEMATIC placeholder aerial tiles for the CoStar sample rows.

These are drawn diagrams (lot, building footprint, striped surface stalls), not
real imagery. They exist so the vision pipeline can run end to end before the
Vexcel integration lands. Tile names are "<lat>_<lng>.png" (5 decimals), the
same naming the real Vexcel client should use.

One building (SAMPLE-0007) deliberately gets no tile, to exercise the
"tool failed -> cell marked missing" path.

    uv run python scripts/make_sample_tiles.py
"""

from __future__ import annotations

import csv
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import config  # noqa: E402

SKIP = {"SAMPLE-0007"}
SIZE = 640


def draw_tile(seed: int, surface_share: float) -> Image.Image:
    rnd = random.Random(seed)
    img = Image.new("RGB", (SIZE, SIZE), (92, 110, 84))  # vegetation/background
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, SIZE - 20, SIZE - 20], fill=(150, 146, 138), outline=(240, 240, 240), width=3)  # lot
    # Building footprint
    bw = int(SIZE * rnd.uniform(0.25, 0.4))
    bh = int(SIZE * rnd.uniform(0.25, 0.4))
    d.rectangle([40, 40, 40 + bw, 40 + bh], fill=(200, 198, 192), outline=(60, 60, 60), width=2)
    # Surface parking: rows of stalls over a share of the remaining lot
    y = 60 + bh
    rows = max(1, int(surface_share * 10))
    for r in range(rows):
        top = y + r * 52
        if top + 40 > SIZE - 30:
            break
        d.rectangle([40, top, SIZE - 40, top + 40], fill=(55, 55, 58))
        x = 44
        while x < SIZE - 44:
            d.line([x, top, x, top + 40], fill=(245, 245, 245), width=2)
            if rnd.random() < 0.6:  # parked car
                d.rectangle([x + 4, top + 6, x + 14, top + 34], fill=rnd.choice([(30, 60, 140), (200, 200, 205), (150, 20, 20), (20, 20, 20)]))
            x += 18
    d.text((SIZE - 230, SIZE - 18), "SCHEMATIC PLACEHOLDER TILE", fill=(255, 255, 0))
    return img


def main() -> None:
    config.TILES_DIR.mkdir(parents=True, exist_ok=True)
    with open(config.COSTAR_CSV, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if row["costar_id"] in SKIP:
                continue
            lat, lng = float(row["lat"]), float(row["lng"])
            older = int(row["year_built"]) < 1985
            share = 0.75 if older else 0.35
            path = config.TILES_DIR / f"{lat:.5f}_{lng:.5f}.png"
            draw_tile(i, share).save(path)
            print("wrote", path.name)


if __name__ == "__main__":
    main()
