from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parent
photos = Path(r"C:\Projects\smart-notes\Docs\Upgrades\Photos-1-001-small")
items = [
    ("08", "PXL_20261012_212400809.jpg", (0, 80, 1280, 780), "08-split.png", (0, 0, 1440, 900)),
    ("09", "PXL_20261012_212404962.MP.jpg", (0, 80, 1280, 780), "09-companion-overlay.png", (0, 0, 1440, 900)),
]

for number, filename, crop, screenshot, shot_crop in items:
    reference = Image.open(photos / filename).convert("RGB").crop(crop)
    preview = Image.open(root / screenshot).convert("RGB").crop(shot_crop)
    canvas = Image.new("RGB", (2420, 950), "white")
    for x, source, label in [
        (0, reference, f"Fork photo #{number}"),
        (1210, preview, "SN-295 desktop preview"),
    ]:
        fitted = ImageOps.contain(source, (1180, 900))
        canvas.paste(fitted, (x + (1180 - fitted.width) // 2, 40 + (900 - fitted.height) // 2))
        ImageDraw.Draw(canvas).text((x + 20, 14), label, fill="black")
    canvas.save(root / f"{number}-side-by-side.png")
    print(f"wrote {number}-side-by-side.png")
