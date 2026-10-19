"""Headless verification for Ravenshold.

Walks the whole loop: boot, intro cutscene, guild registration, taking a
contract, travelling out, killing things, turning the contract in, and spending
the reward on upgrades and steel.

Game logic is driven through the game's own API rather than by waiting on
wall-clock time, because software rasterisation only manages a fraction of a
frame per second and the engine clamps dt per frame. Only the UI transitions
(setTimeout-based) need real time.

    python tools/smoke_test.py [--url http://localhost:4173] [--shots]
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
    ap.add_argument("--headful", action="store_true")
    args = ap.parse_args()

    errors: list[str] = []
    failures: list[str] = []

    def check(ok, label, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' - ' + detail) if detail else ''}")
        if not ok:
            failures.append(label)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headful, args=[
            "--use-gl=angle", "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl",
        ])
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: (errors.append(str(e)), print("  !! pageerror:", e)))
        page.on("console", lambda m: (errors.append(m.text), print("  !! console.error:", m.text))
                if m.type == "error" else None)

        def shot(name):
            if not args.shots:
                return
            SHOTS.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SHOTS / name), timeout=300_000)

        print(f"-> loading {args.url}")
        # the software renderer is slow; keep logic checks on the cheap preset
        page.add_init_script("try { localStorage.setItem('wildwood.graphics.v2', 'low'); } catch (e) {}")
        page.goto(args.url, wait_until="load", timeout=60_000)
        page.wait_for_function(
            "() => { const w = window.__wildwood;"
            " return !!(w && w.game && w.game.player && w.game.world && w.game.world.city); }",
            timeout=300_000,
        )

        # ------------------------------------------------------------- world
        print("\nworld")
        info = page.evaluate("""() => {
          const w = window.__wildwood;
          const g = w.game;
          return {
            houses: g.world.city.houses.length,
            gateTowers: g.world.city.gateTowers.length,
            collidersWorld: g.world.worldColliders.length,
            collidersInterior: g.world.interiorColliders.length,
            npcs: g.npcs.length,
            biomes: g.world.biomes.summaries.map(s => s.region.id),
            guildMeshes: g.world.guild.meshes.length,
            guildLights: g.world.guild.lights.length,
            clipsUAL1: w.assets.clips.UAL1.size,
            clipsUAL2: w.assets.clips.UAL2.size,
            outfits: Object.keys(w.assets.gltf).filter(k => ['ranger','rangerF','peasantM','peasantF'].includes(k)).length,
            hasEnvironment: !!w.engine.scene.environment,
            headLibrary: !!(w.assets.heads && w.assets.heads.male && w.assets.heads.female),
            headTextured: (() => {
              const b = g.player.model.getObjectByName('Head');
              if (!b) return false;
              let textured = false;
              b.traverse(o => { if (o.isMesh && o.name === 'head_skin') textured = !!o.material.map; });
              return textured;
            })(),
            playerHeadVerts: (() => {
              const b = g.player.model.getObjectByName('Head');
              if (!b) return 0;
              let n = 0;
              b.traverse(o => { if (o.isMesh) n += o.geometry.attributes.position.count; });
              return n;
            })(),
            npcHeads: g.npcs.filter(n => {
              const b = n.model.getObjectByName('Head');
              return !!b && b.children.some(o => o.isMesh);
            }).length,
            hoodVisible: (() => {
              let visible = false;
              g.player.model.traverse(o => {
                if (o.isMesh && /head_hood/i.test(o.name)) visible = visible || o.visible;
              });
              return visible;
            })(),
            drawCalls: w.engine.renderer.info.render.calls,
            triangles: w.engine.renderer.info.render.triangles,
          };
        }""")
        print("  " + json.dumps(info))
        check(info["houses"] >= 10, "city built", f"{info['houses']} houses")
        check(len(info["biomes"]) == 3, "three biomes built", ", ".join(info["biomes"]))
        check(info["npcs"] >= 6, "guild NPCs spawned", str(info["npcs"]))
        check(info["guildMeshes"] > 40, "guild interior furnished", f"{info['guildMeshes']} meshes")
        check(info["outfits"] == 4, "all four outfits loaded", str(info["outfits"]))
        check(info["clipsUAL1"] == 43 and info["clipsUAL2"] == 43, "animation libraries loaded")
        check(info["collidersInterior"] > 0, "guild interior is sealed")
        check(info["hasEnvironment"], "environment map built")
        check(info["headLibrary"], "base-character head library built")
        check(info["headTextured"], "player head uses the base-character skin texture")
        check(info["playerHeadVerts"] > 300, "player has a modelled head", f"{info['playerHeadVerts']} verts")
        check(info["npcHeads"] >= info["npcs"], "every guild NPC has a head", f"{info['npcHeads']}/{info['npcs']}")
        check(not info["hoodVisible"], "ranger hood hides so the face shows")
        shot("s1-title.png")

        # ----------------------------------------------------------- cutscene
        print("\nintro cutscene")
        # the title only appears once boot (including the shader warm-up) is done
        page.wait_for_function(
            "() => { const t = document.getElementById('screen-title');"
            " return !!(t && !t.classList.contains('hidden')"
            " && window.__wildwood.game.state === 'title'); }",
            timeout=300_000,
        )
        page.click("#btn-start")
        page.wait_for_function("() => window.__wildwood.game.state === 'playing'", timeout=60_000)
        cut = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { active: !!(g.cutscene && g.cutscene.active), beats: g.cutscene ? g.cutscene.beats.length : 0,
                   blocked: g.blocked };
        }""")
        check(cut["active"] and cut["beats"] > 0, "intro cutscene started", f"{cut['beats']} beats")
        check(cut["blocked"], "player is held during the cutscene")

        page.evaluate("() => window.__wildwood.game.cutscene.skip()")
        page.wait_for_timeout(400)
        after = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { active: g.cutscene.active, blocked: g.blocked,
                   objective: document.getElementById('tracker-title').textContent };
        }""")
        check(not after["active"], "cutscene is skippable")
        check(after["objective"] == "Enter the Guild hall", "objective points at the guild", after["objective"])

        # -------------------------------------------------------- registration
        print("\nguild registration")
        page.evaluate("() => window.__wildwood.game.enterGuild()")
        page.wait_for_function("() => window.__wildwood.game.world.area === 'guild'", timeout=30000)
        page.wait_for_timeout(600)
        reg = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { area: g.world.area, dialogue: g.dialogue.active,
                   speaker: g.dialogue.current?.speaker || null,
                   isInput: g.dialogue.isInput };
        }""")
        check(reg["area"] == "guild", "entered the guild interior")
        check(reg["dialogue"], "registration dialogue started", str(reg["speaker"]))

        # advance to the name prompt
        page.evaluate("""() => {
          const g = window.__wildwood.game;
          for (let i = 0; i < 10 && g.dialogue.active && !g.dialogue.isInput; i++) g.dialogue.next();
        }""")
        prompt = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { isInput: g.dialogue.isInput,
                   visible: !document.getElementById('dialogue-input').classList.contains('hidden') };
        }""")
        check(prompt["isInput"], "registration asks for a name")
        check(prompt["visible"], "name field is shown")
        shot("s2-registration.png")

        # Reproduce exactly what a player does: type into the field, press
        # Enter. The original bug recorded the name but never advanced, so
        # asserting on the name alone missed it — the dialogue must move past
        # the input line.
        before = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { isInput: g.dialogue.isInput, index: g.dialogue.index };
        }""")
        page.fill("#dialogue-field", "Ash")
        page.keyboard.press("Enter")
        page.wait_for_timeout(250)
        named = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return {
            isInput: g.dialogue.isInput,
            index: g.dialogue.index,
            active: g.dialogue.active,
            name: g.player.name,
            text: document.getElementById('dialogue-text').textContent,
            fieldHidden: document.getElementById('dialogue-input').classList.contains('hidden'),
          };
        }""")
        print("  " + json.dumps(named))
        check(before["isInput"], "registration asks for a name")
        check(named["name"] == "Ash", "player name recorded", named["name"])
        check(named["index"] > before["index"] and not named["isInput"],
              "Enter advances past the input line",
              f"index {before['index']} -> {named['index']}")
        check(named["fieldHidden"], "name field hidden after confirming")
        check(named["active"], "dialogue continues after registration input")

        # the Confirm button must take the same path
        button_ok = page.evaluate("""() => {
          const g = window.__wildwood.game;
          const d = g.dialogue;
          // put a throwaway input line in front of the queue and click Confirm
          const before = { index: d.index, active: d.active };
          d.lines.splice(d.index, 0, {
            input: true, speaker: 'You', label: 'test', required: true,
            onSubmit: () => {},
          });
          document.getElementById('dialogue-submit').click();
          return { before, index: d.index, isInput: d.isInput };
        }""")
        check(button_ok["index"] > button_ok["before"]["index"] and not button_ok["isInput"],
              "Confirm button advances past the input line",
              f"index {button_ok['before']['index']} -> {button_ok['index']}")

        page.evaluate("() => window.__wildwood.game.dialogue.skip()")
        page.wait_for_timeout(300)

        # ------------------------------------------------------------ contract
        print("\ncontracts")
        page.evaluate("() => window.__wildwood.game.openBoard()")
        page.wait_for_timeout(300)
        board = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { open: g.ui.panelOpen, offers: g.missions.offers.length,
                   cards: document.querySelectorAll('#panel-body .card').length };
        }""")
        check(board["open"], "mission board opens")
        check(board["offers"] == 3, "one contract per region", str(board["offers"]))
        check(board["cards"] >= 3, "contract cards rendered", str(board["cards"]))
        shot("s3-board.png")

        accepted = page.evaluate("""() => {
          const g = window.__wildwood.game;
          const id = g.missions.offers[0].id;
          g.missions.accept(id);
          g.ui.closePanel();
          g.blocked = false;
          const m = g.missions.active;
          return { regionId: m.regionId, type: m.type, target: m.target, title: m.title };
        }""")
        print("  " + json.dumps(accepted))
        check(accepted["regionId"] in ("forest", "blight", "desert"), "contract accepted",
              f"{accepted['title']} ({accepted['type']})")

        # -------------------------------------------------------------- travel
        print("\ntravel and combat")
        page.evaluate("(id) => window.__wildwood.game.travelTo(id)", accepted["regionId"])
        page.wait_for_timeout(1200)
        travel = page.evaluate("""() => {
          const g = window.__wildwood.game;
          const p = g.player.root.position;
          const r = g.world.regionAt(p.x, p.z);
          return { area: g.world.area, region: r ? r.id : null,
                   pos: [+p.x.toFixed(0), +p.z.toFixed(0)] };
        }""")
        check(travel["area"] == "world", "left the guild")
        check(travel["region"] == accepted["regionId"], "arrived in the contract region",
              f"{travel['region']} at {travel['pos']}")
        shot("s4-region.png")

        fight = page.evaluate("""() => {
          const g = window.__wildwood.game;
          const p = g.player;
          const region = g.world.regionAt(p.root.position.x, p.root.position.z);

          // spawn a monster in front of the player and swing at it
          const yaw = p.root.rotation.y;
          const x = p.root.position.x + Math.sin(yaw) * 8;
          const z = p.root.position.z + Math.cos(yaw) * 8;
          const e = g._spawnEnemy('imp', x, z);
          e.state = 'chase';
          e.root.position.set(
            p.root.position.x + Math.sin(yaw) * 2.0,
            p.root.position.y,
            p.root.position.z + Math.cos(yaw) * 2.0);

          const before = { hp: e.health, progress: g.missions.active.progress, kills: g.kills };
          g.resolvePlayerSwing(p,
            { key: 'attack1', damageScale: 1, range: 2.6, arc: 1.9, knock: 2 }, new Set());
          const mid = { hp: e.health };

          e.health = 1;
          g.resolvePlayerSwing(p,
            { key: 'attack1', damageScale: 1, range: 2.6, arc: 1.9, knock: 2 }, new Set());

          return { before, mid,
                   after: { hp: e.health, state: e.state, progress: g.missions.active.progress,
                            kills: g.kills, spawnRegion: region ? region.id : null } };
        }""")
        print("  " + json.dumps(fight))
        check(fight["mid"]["hp"] < fight["before"]["hp"], "sword damages monsters")
        check(fight["after"]["state"] == "dead", "monster dies")
        check(fight["after"]["progress"] > fight["before"]["progress"],
              "kill advances the contract",
              f"{fight['before']['progress']} -> {fight['after']['progress']}")

        # ------------------------------------------------------- turn it in
        print("\nreward and upgrades")
        page.evaluate("""() => {
          const g = window.__wildwood.game;
          g.missions.active.progress = g.missions.active.target;
        }""")
        complete = page.evaluate("() => window.__wildwood.game.missions.isComplete")
        check(complete, "contract reads as complete")

        page.evaluate("() => window.__wildwood.game.travelTo('city')")
        page.wait_for_function("() => window.__wildwood.game.world.area === 'world'", timeout=30000)
        page.evaluate("() => window.__wildwood.game.enterGuild()")
        page.wait_for_function("() => window.__wildwood.game.world.area === 'guild'", timeout=30000)

        # stand at the desk and hand it in
        page.evaluate("""() => {
          const g = window.__wildwood.game;
          const [ox, oy, oz] = [1200, 0, 0];
          g.player.root.position.set(ox + 0.2, oy, oz + 2.4);
          g.player.velocity.set(0, 0, 0);
          g.dialogue.skip();
          g.blocked = false;
          g._interact();
        }""")
        page.wait_for_timeout(300)
        paid = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { gold: g.progression.gold, active: !!g.missions.active,
                   dialogue: g.dialogue.active,
                   speaker: g.dialogue.current?.speaker || null };
        }""")
        check(paid["gold"] > 0, "contract paid out", f"{paid['gold']} gold")
        check(not paid["active"], "contract cleared from the log")

        # ------------------------------------------------------------- shop
        page.evaluate("""() => {
          const g = window.__wildwood.game;
          g.dialogue.skip();
          g.progression.gold = 5000;
          g.openShop();
        }""")
        page.wait_for_timeout(300)
        shop = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { open: g.ui.panelOpen,
                   rows: document.querySelectorAll('#panel-body .card').length,
                   attack: g.progression.attackDamage,
                   maxHp: g.progression.maxHealth,
                   weapon: g.progression.weapon,
                   swordName: g.player.sword?.name };
        }""")
        check(shop["open"], "quartermaster panel opens")
        check(shop["rows"] >= 4, "shop lists upgrades and equipment", f"{shop['rows']} rows")
        shot("s5-shop.png")

        bought = page.evaluate("""() => {
          const g = window.__wildwood.game;
          const p = g.progression;
          const before = { attack: p.attackDamage, maxHp: p.maxHealth, weapon: p.weapon,
                           bladeChildren: g.player.sword.children.length };
          p.buyUpgrade('attack');
          p.buyUpgrade('health');
          p.buyWeapon('iron');
          g.applyEquipment();
          return { before,
                   after: { attack: p.attackDamage, maxHp: p.maxHealth, weapon: p.weapon,
                            gold: p.gold, bladeChildren: g.player.sword.children.length } };
        }""")
        print("  " + json.dumps(bought))
        check(bought["after"]["attack"] > bought["before"]["attack"], "attack upgrade applies",
              f"{bought['before']['attack']} -> {bought['after']['attack']}")
        check(bought["after"]["maxHp"] > bought["before"]["maxHp"], "health upgrade applies",
              f"{bought['before']['maxHp']} -> {bought['after']['maxHp']}")
        check(bought["after"]["weapon"] == "iron", "weapon tier purchased", bought["after"]["weapon"])
        check(bought["after"]["bladeChildren"] > 0, "new blade is attached to the hand")

        shield = page.evaluate("""() => {
          const g = window.__wildwood.game;
          g.progression.buyShield('kite');
          g.applyEquipment();
          return { shield: g.progression.shield,
                   mitigation: g.progression.guardMitigation,
                   attached: !!(g.player.model.getObjectByName('shield')) };
        }""")
        check(shield["attached"], "shield attached to the off hand", shield["shield"])
        check(shield["mitigation"] > 0.4, "shield improves guard", f"{shield['mitigation']:.2f}")

        # ---------------------------------------------------------- leaving
        page.evaluate("() => window.__wildwood.game.exitGuild()")
        page.wait_for_function("() => window.__wildwood.game.world.area === 'world'", timeout=30000)
        left = page.evaluate("""() => {
          const g = window.__wildwood.game;
          return { area: g.world.area,
                   pos: [+g.player.root.position.x.toFixed(0), +g.player.root.position.z.toFixed(0)] };
        }""")
        check(left["area"] == "world", "left the guild hall", str(left["pos"]))

        page.wait_for_timeout(1500)
        shot("s6-city.png")
        browser.close()

    print()
    if errors:
        print(f"FAIL - {len(errors)} page error(s)")
        for e in errors[:20]:
            print("   ", e)
        return 1
    if failures:
        print(f"FAIL - {len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("OK - all checks passed, no page errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
