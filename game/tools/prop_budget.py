"""Report per-model triangle counts and real-world dimensions for a kit.

The kits have no consistent authoring scale between pieces — a grass tuft is
1.9 m and a twisted tree 19 m; a village wall module and a roof section differ
too — so the scatter and building code needs measured extents to work from.

    python tools/prop_budget.py [assets/nature|assets/village|assets/props]
    python tools/prop_budget.py assets/village --grep Wall,Roof,Floor,Corner
"""
import argparse
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "public" / "assets"


def metrics(gltf: dict):
    tris = 0
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "indices" in prim:
                tris += gltf["accessors"][prim["indices"]]["count"] // 3
            else:
                tris += gltf["accessors"][prim["attributes"]["POSITION"]]["count"] // 3
            acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            if "min" in acc:
                for i in range(3):
                    lo[i] = min(lo[i], acc["min"][i])
                    hi[i] = max(hi[i], acc["max"][i])
    return tris, (hi[0] - lo[0]), (hi[1] - lo[1]), (hi[2] - lo[2]), tuple(lo), tuple(hi)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("kit", nargs="?", default="nature", help="kit folder under public/assets")
    ap.add_argument("--grep", default=None, help="comma-separated substrings to filter by")
    ap.add_argument("--sort", default="name", choices=["name", "height", "tris"])
    args = ap.parse_args()

    root = ASSETS / args.kit
    if not root.is_dir():
        raise SystemExit(f"no such kit: {root}")

    needles = [s.strip().lower() for s in args.grep.split(",")] if args.grep else None

    rows = []
    for path in sorted(root.glob("*.gltf")):
        if needles and not any(n in path.stem.lower() for n in needles):
            continue
        tris, w, h, d, lo, hi = metrics(json.loads(path.read_text(encoding="utf-8")))
        rows.append((path.stem, w, h, d, tris, lo, hi))

    if args.sort == "height":
        rows.sort(key=lambda r: -r[2])
    elif args.sort == "tris":
        rows.sort(key=lambda r: -r[4])

    print(f"--- {args.kit} ({len(rows)} models) ---")
    print(f"{'model':<38} {'width':>7} {'height':>7} {'depth':>7} {'minY':>7} {'tris':>7}")
    for name, w, h, d, tris, lo, hi in rows:
        print(f"{name:<38} {w:>7.2f} {h:>7.2f} {d:>7.2f} {lo[1]:>7.3f} {tris:>7}")
    print(f"\ntotal triangles: {sum(r[4] for r in rows):,}")


if __name__ == "__main__":
    main()
