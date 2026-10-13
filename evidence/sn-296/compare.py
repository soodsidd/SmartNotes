from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parent
photos = Path(r"C:\Projects\smart-notes\Docs\Upgrades\Photos-1-001-small")
items = [
    ("11", "PXL_20261012_212447217.jpg", (0, 200, 1200, 1160), "11-empty-box.png"),
    ("16", "PXL_20261012_212540536.jpg", (0, 180, 1200, 1140), "16-table-box.png"),
]

for number, photo_name, crop, screenshot in items:
    reference = Image.open(photos / photo_name).convert("RGB").crop(crop)
    preview = Image.open(root / screenshot).convert("RGB")
    canvas = Image.new("RGB", (2420, 950), "white")
    for x, source, label in [
        (0, reference, f"Fork photo #{number}"),
        (1210, preview, "SN-296 desktop preview"),
    ]:
        fitted = ImageOps.contain(source, (1180, 900))
        canvas.paste(fitted, (x + (1180 - fitted.width) // 2, 40 + (900 - fitted.height) // 2))
        ImageDraw.Draw(canvas).text((x + 20, 14), label, fill="black")
    canvas.save(root / f"{number}-side-by-side.png")
    print(f"wrote {number}-side-by-side.png")
