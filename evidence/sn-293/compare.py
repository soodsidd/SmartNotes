from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

root = Path(__file__).resolve().parent
photos = Path(r"C:\Projects\smart-notes\Docs\Upgrades\Photos-1-001-small")
items = [
    ("02", "PXL_20261012_212222564.jpg", (0, 180, 1200, 760), "02-insert-menu.png"),
    ("03", "PXL_20261012_212226871.jpg", (0, 230, 1200, 1120), "03-attach-paper.png"),
    ("04", "PXL_20261012_212308711.jpg", (0, 0, 1200, 980), "04-create-paper.png"),
]

for number, filename, crop, screenshot in items:
    reference = Image.open(photos / filename).convert("RGB").crop(crop)
    preview = Image.open(root / screenshot).convert("RGB")
    canvas = Image.new("RGB", (2420, 950), "white")
    for x, source, label in [
        (0, reference, f"Fork photo #{number}"),
        (1210, preview, "SN-293 desktop preview"),
    ]:
        fitted = ImageOps.contain(source, (1180, 900))
        canvas.paste(fitted, (x + (1180 - fitted.width) // 2, 40 + (900 - fitted.height) // 2))
        ImageDraw.Draw(canvas).text((x + 20, 14), label, fill="black")
    canvas.save(root / f"{number}-side-by-side.png")
