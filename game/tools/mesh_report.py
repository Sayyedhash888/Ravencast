"""Per-mesh vertical extents for a packed GLB.

Used to answer questions like "does this outfit actually contain head
geometry?" without loading it in a browser.

    python tools/mesh_report.py public/assets/chars/Male_Ranger.glb
    python tools/mesh_report.py public/assets/chars/*.glb
"""
import json
import sys
from pathlib import Path


def read_glb(path: Path) -> dict:
    b = path.read_bytes()
    if b[:4] != b"glTF":
        raise SystemExit(f"{path} is not a GLB")
    length = int.from_bytes(b[12:16], "little")
    return json.loads(b[20:20 + length].decode("utf-8").rstrip("\x00 "))


def report(path: Path) -> None:
    j = read_glb(path)
    print(f"--- {path.name} ---")

    lo_all, hi_all = 1e9, -1e9
    for mesh in j.get("meshes", []):
        lo, hi = 1e9, -1e9
        tris = 0
        for prim in mesh.get("primitives", []):
            acc = j["accessors"][prim["attributes"]["POSITION"]]
            if "min" in acc:
                lo = min(lo, acc["min"][1])
                hi = max(hi, acc["max"][1])
            if "indices" in prim:
                tris += j["accessors"][prim["indices"]]["count"] // 3
        lo_all, hi_all = min(lo_all, lo), max(hi_all, hi)
        print(f"   {mesh.get('name','?'):<34} y {lo:6.3f} .. {hi:6.3f}   {tris:>6} tris")
    print(f"   {'(all meshes)':<34} y {lo_all:6.3f} .. {hi_all:6.3f}")

    for node in j.get("nodes", []):
        if node.get("name") in ("Head", "neck_01", "root"):
            t = node.get("translation")
            print(f"   bone {node['name']:<29} translation {t}")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        report(Path(arg))
