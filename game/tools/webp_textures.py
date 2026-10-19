"""Convert the nature kit's shared PNG textures to WebP.

The kit keeps its textures as separate files shared across every prop, so
converting them once here (and repointing the glTF `uri` fields) keeps them
shared at runtime instead of being duplicated into each model. PNG -> WebP
takes the texture payload from ~21 MB down to a few MB.
"""
import sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def convert(root: Path, quality: int = 88) -> None:
    before = sum(p.stat().st_size for p in root.glob("*.png"))
    for png in sorted(root.glob("*.png")):
        webp = png.with_suffix(".webp")
        with Image.open(png) as im:
            im.load()
            im.save(webp, "WEBP", quality=quality, method=6)
        png.unlink()
    after = sum(p.stat().st_size for p in root.glob("*.webp"))
    print(f"  textures: {before/1e6:.1f} MB PNG -> {after/1e6:.1f} MB WebP")

    # repoint the glTF image URIs; only image URIs ever end in `.png"`
    patched = 0
    for gltf in sorted(root.glob("*.gltf")):
        text = gltf.read_text(encoding="utf-8")
        if '.png"' not in text:
            continue
        gltf.write_text(text.replace('.png"', '.webp"'), encoding="utf-8")
        patched += 1
    print(f"  repointed {patched} glTF files")


if __name__ == "__main__":
    convert(Path(sys.argv[1]))
