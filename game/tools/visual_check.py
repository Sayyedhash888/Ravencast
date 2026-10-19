"""Walk the world and capture a screenshot of each place.

Boots the game, starts a run, then teleports the player to each landmark and
captures the render. Used to check the city, the guild interior and all three
biomes actually look right.

    python tools/visual_check.py
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)

PLACE_JS = """(spec) => {
  const w = window.__wildwood;
  const g = w.game;
  const p = g.player;

  if (spec.area === 'guild') {
    g.world.enterGuild();
    const entry = g.world.guildEntryPoint;
    p.root.position.set(entry.x + (spec.dx || 0), entry.y, entry.z + (spec.dz || 0));
  } else {
    g.world.exitGuild();
    p.root.position.set(spec.x, g.world.groundAt(spec.x, spec.z), spec.z);
  }
  p.root.rotation.y = spec.yaw;
  p.velocity.set(0, 0, 0);
  p.impulse.set(0, 0, 0);

  // the boom sits opposite the facing direction: camera offset is -facing
  g.cameraRig.yaw = spec.yaw + Math.PI;
  g.cameraRig.pitch = spec.pitch ?? 0.24;
  g.cameraRig.baseDistance = spec.dist ?? 5.4;
  g.cameraRig.snapTo(p.root.position);

  g.blocked = false;
  g.player.frozen = false;
  if (g.cutscene) g.cutscene.active = false;
  g.dialogue.skip();
  g.ui.showGame();
  g.ui.setRegion(spec.label || '');
  return {
    area: g.world.area,
    pos: [+p.root.position.x.toFixed(1), +p.root.position.z.toFixed(1)],
    cam: [+g.engine.camera.position.x.toFixed(1), +g.engine.camera.position.y.toFixed(1), +g.engine.camera.position.z.toFixed(1)],
  };
}"""

# `yaw` is the player's facing; the camera is placed behind it automatically.
PI = 3.14159
SHOTS_SPEC = [
    dict(name="w1-city-plaza", label="Ravenshold", x=0, z=26, yaw=PI, pitch=0.22),
    dict(name="w2-city-guild", label="Ravenshold", x=0, z=-18, yaw=PI, pitch=0.18),
    dict(name="w3-guild-interior", area="guild", label="Guild hall", dx=0, dz=0, yaw=PI, pitch=0.16, dist=6.5),
    dict(name="w4-forest", label="Wildwood", x=0, z=-110, yaw=PI, pitch=0.20),
    dict(name="w5-blight", label="Emberwood", x=118, z=66, yaw=1.077, pitch=0.20),
    dict(name="w6-desert", label="Sunscorch Flats", x=-118, z=66, yaw=-1.077, pitch=0.20),
]


def main() -> int:
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

        page.goto("http://localhost:4173", wait_until="load", timeout=60_000)
        page.wait_for_function(
            "() => { const w = window.__wildwood;"
            " return !!(w && w.game && w.game.player && w.game.world && w.game.world.city); }",
            timeout=300_000,
        )
        print("-> booted")

        # enter a run and drop the intro so control is free
        page.wait_for_function(
            "() => { const t = document.getElementById('screen-title');"
            " return !!(t && !t.classList.contains('hidden')"
            " && window.__wildwood.game.state === 'title'); }",
            timeout=300_000,
        )
        page.click("#btn-start")
        page.wait_for_function("() => window.__wildwood.game.state === 'playing'", timeout=60_000)
        page.evaluate("""() => {
          const g = window.__wildwood.game;
          if (g.cutscene) { g.cutscene.active = false; g.cutscene.beats = []; }
          g.blocked = false;
          g.player.frozen = false;
        }""")

        SHOTS.mkdir(parents=True, exist_ok=True)
        for spec in SHOTS_SPEC:
            info = page.evaluate(PLACE_JS, spec)
            print(f"-> {spec['name']}: {json.dumps(info)}")
            page.wait_for_timeout(2600)  # let the renderer settle
            page.screenshot(path=str(SHOTS / f"{spec['name']}.png"), timeout=300_000)
            print(f"   wrote {spec['name']}.png")

        browser.close()

    if errors:
        print(f"FAIL: {len(errors)} error(s)")
        return 1
    print("OK: captured all locations with no errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
