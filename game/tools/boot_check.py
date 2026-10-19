"""Quick boot check: does the game load, build the world and render?

    python tools/boot_check.py [--shots]
"""
import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:4173")
    ap.add_argument("--shots", action="store_true")
    ap.add_argument("--seconds", type=float, default=4.0)
    args = ap.parse_args()

    errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl",
        ])
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: (errors.append(str(e)), print("  !! pageerror:", e)))
        page.on("console", lambda m: (errors.append(m.text), print("  !! console.error:", m.text))
                if m.type == "error" else None)

        print(f"-> loading {args.url}")
        page.goto(args.url, wait_until="load", timeout=60_000)

        try:
            page.wait_for_function(
                "() => { const w = window.__wildwood;"
                " return !!(w && w.game && w.game.player && w.game.world && w.game.world.city); }",
                timeout=300_000,
            )
        except Exception:
            print("FAIL: never finished booting")
            print(json.dumps(page.evaluate("""() => {
              const t = document.getElementById('loader-text');
              return { loaderText: t ? t.textContent : null };
            }"""), indent=1))
            browser.close()
            return 1

        info = page.evaluate("""() => {
          const w = window.__wildwood;
          const g = w.game;
          return {
            area: g.world.area,
            cityHouses: g.game ? null : g.world.city.houses.length,
            collidersWorld: g.world.worldColliders.length,
            collidersInterior: g.world.interiorColliders.length,
            npcs: g.npcs.length,
            biomes: g.world.biomes.summaries.map(s => s.region.id),
            guildMeshes: g.world.guild.meshes.length,
            sceneChildren: w.engine.scene.children.length,
            drawCalls: w.engine.renderer.info.render.calls,
            triangles: w.engine.renderer.info.render.triangles,
            state: g.state,
          };
        }""")
        print("-> booted:", json.dumps(info, indent=1))

        # let it run a few frames of the title orbit
        page.wait_for_timeout(int(args.seconds * 1000))
        if args.shots:
            SHOTS.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOTS / "boot-title.png"), timeout=240_000)
            print("-> wrote boot-title.png")

        browser.close()

    if errors:
        print(f"FAIL: {len(errors)} error(s)")
        return 1
    print("OK: booted with no errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
