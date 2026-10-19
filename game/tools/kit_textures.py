"""Map each nature model to the textures it uses.

The kit's three environments are not separated into folders — they are implied
by which bark/leaf/rock texture a model is wired to. This prints that mapping
so biome assignment is based on the art rather than on filenames.

    python tools/kit_textures.py nature
"""
import argparse
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "public" / "assets"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("kit", nargs="?", default="nature")
    args = ap.parse_args()

    root = ASSETS / args.kit
    groups: dict[str, list[str]] = {}
    for path in sorted(root.glob("*.gltf")):
        gltf = json.loads(path.read_text(encoding="utf-8"))
        uris = tuple(sorted({Path(i.get("uri", "")).stem for i in gltf.get("images", [])}))
        groups.setdefault(uris, []).append(path.stem)

    for uris, models in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"\n[{len(models)} models]  {', '.join(uris) or '(no textures)'}")
        for m in models:
            print(f"    {m}")


if __name__ == "__main__":
    main()
