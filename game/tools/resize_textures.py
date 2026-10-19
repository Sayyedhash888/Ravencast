"""Downscale the oversized source textures in place.

The packs ship 2K-4K PNGs (a single normal map is 14 MB) which is far more
than a stylised low-poly game needs. Textures are shared between props, so
resizing once here shrinks every model that references them.
"""
import sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def resize_tree(root: Path, max_size: int, min_bytes: int = 200_000) -> None:
    saved = 0
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            continue
        before = path.stat().st_size
        if before < min_bytes:
            continue
        with Image.open(path) as im:
            im.load()
            w, h = im.size
            if max(w, h) <= max_size:
                continue
            scale = max_size / max(w, h)
            new = (max(1, round(w * scale)), max(1, round(h * scale)))
            resized = im.resize(new, Image.LANCZOS)
        resized.save(path, optimize=True)
        after = path.stat().st_size
        saved += before - after
        print(f"  {path.name:<34} {w}x{h} -> {new[0]}x{new[1]}  "
              f"{before/1e6:6.2f} -> {after/1e6:5.2f} MB")
    print(f"  saved {saved/1e6:.1f} MB")


if __name__ == "__main__":
    target = Path(sys.argv[1])
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1024
    print(f"Resizing textures under {target} to max {size}px")
    resize_tree(target, size)
