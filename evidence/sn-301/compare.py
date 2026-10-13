from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

root = Path(__file__).resolve().parent
photos = Path(r"C:\Projects\smart-notes\Docs\Upgrades\Photos-1-001-small")
items = [
    ("01", "PXL_20261012_212109368.jpg", (200, 260, 1060, 1060), "01-server-tab-desktop.png", "SN-301 desktop (running)"),
    ("01-stopped", "PXL_20261012_212109368.jpg", (200, 260, 1060, 1060), "02-server-stopped-desktop.png", "SN-301 desktop after Stop (Start enabled)"),
]

for name, photo_name, crop, screenshot, label in items:
    reference = Image.open(photos / photo_name).convert("RGB").crop(crop)
    preview = Image.open(root / screenshot).convert("RGB")
    canvas = Image.new("RGB", (2420, 950), "white")
    for x, source, caption in [
        (0, reference, "Fork photo #1"),
        (1210, preview, label),
    ]:
        fitted = ImageOps.contain(source, (1180, 900))
        canvas.paste(fitted, (x + (1180 - fitted.width) // 2, 40 + (900 - fitted.height) // 2))
        ImageDraw.Draw(canvas).text((x + 20, 14), caption, fill="black")
    canvas.save(root / f"{name}-side-by-side.png")
    print(f"wrote {name}-side-by-side.png")
