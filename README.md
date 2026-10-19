# Ravenshold — Guild of the Wildwood
### JetBrains Academy: Build a Game with an AI Coding Agent Challenge

[![official JetBrains project](http://jb.gg/badges/official.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Live Demo](https://img.shields.io/badge/Live_Demo-Cloudflare_Workers-F38020?style=flat&logo=cloudflare)](https://ravenhold.sayyedhash88.workers.dev/)

**Live Game Link:** [https://ravenhold.sayyedhash88.workers.dev/](https://ravenhold.sayyedhash88.workers.dev/)

A third-person open-world action-RPG built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/), progressively evolved from the JetBrains Academy course starter into a fully featured 3D survival arena and guild contracts game.

---

## Quick Start: How to Run the Game

You can run the game directly from the **workspace root** or from the **`game/` subfolder**:

### Option 1: Running from Workspace Root (Default)

```bash
# 1. Install dependencies (if not already installed)
npm --prefix game install

# 2. Start the development server (Hot Module Reload)
npm run dev

# 3. Open your browser at http://localhost:5173
```

#### Production Build & Preview:
```bash
# Build production bundle
npm run build

# Preview production build on http://localhost:4173
npm run preview
```

---

### Option 2: Running from the `game/` Directory

```bash
cd game
npm install

# Start Dev Server
npm run dev          # http://localhost:5173

# Production Build & Preview
npm run build
npm run preview      # http://localhost:4173
```

---

## Controls

| Input | Action |
| --- | --- |
| `W`, `A`, `S`, `D` | Move character relative to camera |
| **Mouse Drag** | 360° camera orbit |
| **Left Click** | Sword attack (3-step combo: slash, backhand, overhead) |
| **Right Click** | Guard with shield (reduces damage, consumes stamina) |
| **Space** | Dodge roll with invulnerability window |
| **Shift** | Sprint (boosts movement speed) |
| `E` | Interact (talk to receptionist/quartermaster, check mission board, enter doors) |
| `M` | Open World Map & Fast Travel Waystones |
| `Esc` | Pause game / Settings / Save branches |

> **Mobile & Tablet:** Touch controls (virtual dual thumbsticks and ABXY buttons) activate automatically on touch-enabled devices.

---

## Gameplay Loop

1. **Register at the Guild:** Enter the Guild Hall on the north side of the Ravenshold town square and sign the ledger with your name.
2. **Accept a Contract:** Head to the mission board on the west wall and select an active contract across one of three biomes (Wildwood, Emberwood, or Sunscorch Flats).
3. **Travel & Waystones:** Use the compass marker or press `M` to view the map and travel out through the city gates (or fast-travel via discovered waystones).
4. **Combat & Survival:** Hunt designated monster packs (`Imps`, `Puglins`, and regional `Wardens`) using sword combos, timed guards, and dodge rolls.
5. **Turn in & Upgrade:** Return to the Guild Hall to hand in completed contracts for Gold and XP. Visit Quartermaster Bors to upgrade damage, health, stamina, and acquire tier-upgraded swords and shields.

---

## World Biomes

The map spans a 600-meter open terrain divided into distinct zones:
- **Ravenshold City (Center):** Fortified stone hub with modular timber houses, marketplace, guild hall, and safe zones.
- **Wildwood (West):** Lush temperate pine forest with mossy boulders, rolling hills, and Imp scout skirmishes.
- **Emberwood (North):** Blighted red-leafed wilderness with ancient burial grounds and aggressive monsters.
- **Sunscorch Flats (East):** Arid canyon and acacia desert guarded by armored Puglin brutes.

---

## Progressive Architecture Evolution

The repository demonstrates a realistic 5-stage progressive Git commit history migrating from the initial course baseline into the finished 3D RPG:

```text
* feat(engine): add sfx/music, graphics presets, save branches, and mobile touch controls
* feat(world): expand play area into 3 biomes, guild hub, and quest contracts
* refactor(core): replace frog controller with rigged character model and combat system
* build: configure Vite pipeline, Three.js toolchain, and build scripts
* feat: initial commit from JetBrains Academy course baseline
```

- **Stage 0 (`feat: initial commit from JetBrains Academy course baseline`):** Course lessons, task specs, Jest test runner, and initial frog game shell (`tode.glb`).
- **Stage 1 (`build: configure Vite pipeline...`):** Vite 8 pipeline, Three.js 0.186 dependencies, asset extraction tools, and smoke tests.
- **Stage 2 (`refactor(core): replace frog controller...`):** Modular rigged humanoid characters, dynamic head grafting, 3-hit combo combat, stamina, and monster AI.
- **Stage 3 (`feat(world): expand play area...`):** 3-biome world generation, modular procedural city, guild interior, dialogue, and mission board contracts.
- **Stage 4 (`feat(engine): add sfx/music...`):** WebAudio SFX engine, 3 dynamic music beds, graphics presets (Low/Med/High), dynamic resolution (0.6×–1.5×), touch controls, and save state slots.

---

## Verification & Tooling

Headless gameplay tests and smoke testing suite:

```bash
# Build and serve production preview
npm run build
npm run preview

# In another terminal:
python game/tools/smoke_test.py
python game/tools/boot_check.py
python game/tools/visual_check.py
```
