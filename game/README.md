# Ravenshold — Guild of the Wildwood

A third-person action-RPG built with [three.js](https://threejs.org/), assembled
entirely from eight asset packs by [Quaternius](https://quaternius.com) and Fab.

You arrive at Ravenshold, the last walled town before the wild. You register at
the guild, take contracts on the three regions beyond the walls, and spend what
you earn on steel, shields and training.

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/`.

---

## Evolution from JetBrains Academy Baseline

This project began as the **JetBrains Academy: Build a Game with an AI Coding Agent** course baseline (`Tode the Frog` 3D starter). Through a progressive 5-stage architecture migration, it was transformed from a minimal single-character demo into a full-scale open-world 3D action RPG:

1. **Stage 0: Course Baseline Setup**
   - Preserved original course foundation (`tode.glb`, frog controller baseline, Three.js 0.181 canvas skeleton, basic HTML shell).
2. **Stage 1: Toolchain & Build Pipeline Modernisation**
   - Upgraded to Vite 8 modern bundler pipeline and Three.js 0.186 toolchain.
   - Preserved course metadata and configuration standards.
   - Introduced asset pipeline tooling (`@gltf-transform/cli`, Python texture optimizers, asset extraction scripts).
3. **Stage 2: Rigged Character Controller, Combat & Core Entities**
   - Deprecated static frog meshes in favour of modular rigged humanoid character models (`Base_Male`, `Base_Female`, modular hairstyles and fantasy outfits).
   - Dynamic head grafting system (`Head.js`) mounting modular heads to rigged body armatures.
   - Full 3-hit melee sword combat combo, guard/block damage reduction, directional dodge roll with invulnerability frames, stamina management, and hit feedback (floating damage numbers, impact sparks).
   - Core enemy AI state machines (`Imp`, `Puglin`) with pursuit, attack windups, recovery, and hit staggers.
4. **Stage 3: World Generation, Multi-Biome Environment & Guild RPG Loop**
   - Continuous 600m open world comprising 3 distinct biomes: **Wildwood** (temperate pine forest), **Emberwood** (blighted autumnal redwoods), and **Sunscorch Flats** (arid acacia desert).
   - The fortified city of **Ravenshold** with procedural modular houses, marketplace, perimeter stone walls, watchtowers, and gates.
   - Fully dressed instanced **Guild Interior** safe zone (`GuildInterior.js`) housing guild master, quest contracts board, quartermaster shop, and rest hearth.
   - Quest contracts and progression loop: contract acceptance, hunt tracking, gold/XP rewards, stat upgrades (Damage, Health, Endurance), and weapon/shield tiers.
5. **Stage 4: Engine Polish, Audio Architecture, Mobile Controls & Performance**
   - Multi-tier Graphics presets (Low, Medium, High) with dynamic resolution scaling (0.6×–1.5×), distance chunk culling, and sector-based instancing.
   - Spatial and procedural audio engine (`Audio.js`): 3 dynamic music beds (`town`, `combat`, `boss`) with smooth crossfading, Foley footsteps, and sword swishes.
   - Complete mobile & tablet touch controller (`TouchControls.js`): responsive virtual dual-stick, ABXY action pad, and camera orbit.
   - Multi-slot local save state system (`Saves.js`) with manual branch management.

---

## The loop

1. **Register** — walk into the guild hall on the north side of the square and
   sign the ledger. The receptionist asks for your name.
2. **Take a contract** — the board on the west wall posts one job per region,
   at one of three difficulties. Only one contract at a time.
3. **Travel out** — open the map (`M`) and step to a waystone, or walk out the
   gate and follow the road. The city sits at the centre; the three regions are
   roughly 170 m out in different directions.
4. **Fight** — entering the contract's region spawns one finite pack: the kills
   you still need plus four extra (a 6-kill contract gets 10 monsters), or a
   Warden and three guards for an elite contract. Nothing respawns; the pack
   scatters when the contract is met, and the city and guild are safe zones.
5. **Return and spend** — hand the contract to the receptionist for gold and xp,
   then visit Bors the quartermaster. Walking into the hall is also a full rest:
   health and stamina refill as you come through the gate.

A compass pill at the top of the screen always points at the next stop (the
mission board, Maren, the guild door or the contract region) with the distance.
The map on `M` draws the same route as a dashed line.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move relative to camera |
| Mouse | Orbit camera |
| Left Click | Sword attack (3-step combo: slash, backhand, overhead) |
| Right Click | Guard (reduces incoming damage, drains stamina per hit) |
| Space | Dodge roll in movement direction (invulnerability window) |
| Shift | Sprint |
| `E` | Interact (open doors, talk to NPCs, inspect board) |
| `M` | Toggle world map & waystones |
| `Esc` | Pause / close menus |

Mobile devices automatically activate on-screen virtual thumbsticks and touch buttons.

## World layout

The map is a 600 m circle divided into four areas:

```
                  Emberwood (blight)
                          ^
                          |
   Wildwood (forest) <-- City --> Sunscorch Flats (desert)
```

- **The City of Ravenshold** — sits at the centre (radius 55 m), enclosed by a
  stone curtain wall with four gates. Inside are timber-and-plaster houses, a
  cobbled market square, market stalls, carts and the guild hall.
- **Wildwood** — rolling green hills, dense pine forests, ferns, rocks and
  wild mushrooms. Home to standard Imp and Puglin packs.
- **Emberwood** — dark earth, red-leafed trees, fallen logs, blighted barrows
  and ancient ruins. Higher proportion of agile Imps.
- **Sunscorch Flats** — sandstone dust, plateaus, acacia trees, dried shrubs
  and cacti. Heavily guarded by armored Puglin brutes.

## Architecture & Code Layout

```
src/
  engine/
    Engine.js       Three.js renderer, render loop, resize observer
    Input.js        keyboard, pointer lock, mouse look, action timers
    Audio.js        WebAudio synthesizer, sound effects and music beds
  game/
    Assets.js       GLTF loading, kit manifest, clip caching
    CameraRig.js    third-person spring camera with raycast collision
    Character.js    base skinned mesh animator and locomotion controller
    Player.js       combo state machine, guarding, roll, stamina
    Enemy.js        monster state machine (idle, patrol, chase, attack, hurt, die)
    Npc.js          animated townsfolk and guild officers
    Sword.js        procedural steel blades, heater shields, hand bone binding
    Head.js         modular head grafting onto character outfits
    Effects.js      damage numbers, particle bursts, weapon trails
    Graphics.js     quality presets (Low, Medium, High), dynamic resolution
    Progression.js  gold ledger, stat upgrades, weapon and shield tiers
    Missions.js     mission board contracts, difficulty scaling, kill tracking
    Saves.js        localStorage multi-slot persistence
    Dialogue.js     dialogue queue and interactive text input
    Cutscene.js     opening cinematic sequence and camera splines
    Game.js         top-level game orchestrator and state transitions
    world/
      Regions.js       biome boundaries, elevation heightfield, ground mesh
      Placement.js     spatial hash grid, instancing batches, noise scatter
      Collision.js     static colliders (spheres, oriented boxes)
      City.js          modular procedural architecture and road network
      Biomes.js        vegetation and prop placement rules per biome
      GuildInterior.js detailed indoor guild hall scene
      World.js         scene assembly, atmosphere, sky, sun, weather
  ui/
    UI.js           DOM HUD, health/stamina bars, compass, dialogs, map
    TouchControls.js mobile dual thumbstick and ABXY action pad
  tools/            verification, asset processing, and smoke testing
  public/assets/    optimised 3D models, textures, audio, and licenses
```

## Performance & Optimization

- **GPU Instancing**: Thousands of vegetation, prop, and building modules are batched into single draw calls via `PlacementBatch`.
- **Frustum & Distance Culling**: Sectors and distant biome chunks are dynamically culled based on camera view distance.
- **Dynamic Resolution**: Engine automatically downsamples or supersamples canvas resolution (0.6× to 1.5×) to maintain stable frame rates.
- **Asset Optimization**: 470 MB of source kit assets compressed to ~39 MB using WebP textures and glTF-Transform mesh deduplication.

## Verifying

Verify build and gameplay cleanly:

```bash
npm run build
npm run preview --port 4173

# Headless smoke test and validation
python tools/smoke_test.py
```

## Credits & Licenses

All 3D assets and audio originate from CC0 / open licenses (details in `public/assets/licenses/`):
- **Quaternius**: Universal Animation Libraries, Modular Fantasy Characters, Stylized Nature, Medieval Village, Fantasy Props.
- **Kenney**: RPG Audio SFX (CC0).
- **OpenGameArt**: Swishes Sound Pack (CC0).
- **Fab**: Bestiary Dungeon Monsters Kit.
