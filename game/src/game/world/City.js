import * as THREE from 'three';
import { trs, PlacementBatch, loadModels, mulberry32, smoothstep } from './Placement.js';
import { CITY, terrainHeight, terrainSlope } from './Regions.js';

/**
 * Ravenshold — the hub city, assembled from the Medieval Village MegaKit.
 *
 * That kit is a true modular set, so instead of hand-placing 176 piece types
 * the city is generated: `buildHouse()` emits a rectangular shell of wall
 * modules on a 2 m grid, a roof picked to match the footprint, and interior
 * floors. Everything the kit provides is quantised, which makes this possible:
 *
 *   wall module   2.00 x 3.12 x 0.41   (so buildings are even metres wide)
 *   floor tile    2.00 x 2.00
 *   roof          Roof_RoundTiles_{span}x{length}, ridge height set by span
 *
 * The roof naming is in metres, so a house's footprint directly selects its
 * roof; `ROOF_SIZES` is exactly the set the kit ships.
 */

const MODULE = {
  wallWidth: 2.0,
  wallHeight: 3.12,
  wallDepth: 0.41,
  floor: 2.0,
};

/** Footprints the kit ships a matching roof for: [span, length] in metres. */
const ROOF_SIZES = [
  [4, 4], [4, 6], [4, 8],
  [6, 4], [6, 6], [6, 8], [6, 10], [6, 12], [6, 14],
  [8, 8], [8, 10], [8, 12], [8, 14],
];

export const CITY_VILLAGE_MODELS = [
  // walls
  'Wall_UnevenBrick_Straight', 'Wall_UnevenBrick_Window_Wide_Round', 'Wall_UnevenBrick_Window_Wide_Flat',
  'Wall_UnevenBrick_Door_Flat', 'Wall_UnevenBrick_Door_Round',
  'Wall_Plaster_Straight', 'Wall_Plaster_Straight_Base',
  'Wall_Plaster_Window_Wide_Flat', 'Wall_Plaster_Window_Wide_Round', 'Wall_Plaster_Window_Thin_Round',
  'Wall_Plaster_Door_Flat', 'Wall_Plaster_Door_Round', 'Wall_Arch',
  // corners, floors, roofs
  'Corner_Exterior_Brick', 'Corner_Exterior_Wood',
  'Floor_Brick', 'Floor_RedBrick', 'Floor_WoodDark', 'Floor_WoodLight',
  'Roof_RoundTiles_4x4', 'Roof_RoundTiles_4x6', 'Roof_RoundTiles_4x8',
  'Roof_RoundTiles_6x4', 'Roof_RoundTiles_6x6', 'Roof_RoundTiles_6x8',
  'Roof_RoundTiles_6x10', 'Roof_RoundTiles_6x12', 'Roof_RoundTiles_6x14',
  'Roof_RoundTiles_8x8', 'Roof_RoundTiles_8x10', 'Roof_RoundTiles_8x12', 'Roof_RoundTiles_8x14',
  'Roof_Tower_RoundTiles', 'Roof_Front_Brick4', 'Roof_Front_Brick6',
  // doors, stairs, dressing
  'Door_1_Round', 'Door_4_Round', 'Door_8_Round',
  'Stairs_Exterior_Straight', 'Stairs_Exterior_Platform',
  'Prop_WoodenFence_Single', 'Prop_WoodenFence_Extension1',
  'Prop_Crate', 'Prop_Chimney', 'Prop_Chimney2', 'Prop_Vine1', 'Prop_Vine2', 'Prop_Vine4',
  'Prop_Wagon', 'Prop_MetalFence_Simple',
];

export const CITY_PROP_MODELS = [
  'Stall_Empty', 'Stall_Cart_Empty', 'Barrel', 'Barrel_Apples', 'Crate_Wooden',
  'Bag', 'FarmCrate_Apple', 'FarmCrate_Carrot', 'Bucket_Wooden_1',
  'Torch_Metal', 'Lantern_Wall', 'Chain_Coil', 'Anvil', 'Anvil_Log', 'Cauldron',
  'Banner_1', 'Banner_1_Cloth', 'Chest_Wood', 'WeaponStand', 'Dummy', 'Whetstone',
  'Pot_1', 'Rope_1', 'Sack', 'Shelf_Small_Bottles',
].filter((n) => n !== 'Sack'); // not in the kit; kept explicit for clarity

// ------------------------------------------------------------------- houses

/**
 * Emit one rectangular house.
 *
 * Walls run the full footprint on all four sides and simply overlap at the
 * corners — the kit's corner quoins are ~3k triangles each, which is far too
 * much to spend on every corner of every house when an overlap is invisible.
 */
function buildHouse(batch, models, opts) {
  const {
    x, z, yaw = 0, span, length, floors = 2,
    stoneBase = true, doorModule = 0, windowsPerFloor = 2,
    rng = Math.random, quoins = false, chimney = false, vines = false,
  } = opts;

  const base = trs(x, terrainHeight(x, z), z, yaw, 1);
  const local = new THREE.Matrix4();
  const place = (kit, name, lx, ly, lz, lyaw = 0, scale = 1, o = undefined) => {
    local.copy(trs(lx, ly, lz, lyaw, scale));
    batch.add(kit, name, new THREE.Matrix4().multiplyMatrices(base, local), o);
  };

  const halfW = span / 2;
  const halfD = length / 2;
  const inset = MODULE.wallDepth / 2;
  const nX = Math.round(span / MODULE.wallWidth);
  const nZ = Math.round(length / MODULE.wallWidth);

  for (let f = 0; f < floors; f++) {
    const y = f * MODULE.wallHeight;
    const ground = f === 0;

    const solid = ground && stoneBase ? 'Wall_UnevenBrick_Straight' : 'Wall_Plaster_Straight';
    const window = ground && stoneBase
      ? (rng() < 0.5 ? 'Wall_UnevenBrick_Window_Wide_Round' : 'Wall_UnevenBrick_Window_Wide_Flat')
      : (rng() < 0.5 ? 'Wall_Plaster_Window_Wide_Flat' : 'Wall_Plaster_Window_Wide_Round');
    const doorWall = ground && stoneBase ? 'Wall_UnevenBrick_Door_Round' : 'Wall_Plaster_Door_Round';

    // decide which modules are windows so they do not clump
    const pickWindows = (count) => {
      const set = new Set();
      let guard = 40;
      while (set.size < count && guard-- > 0) set.add(Math.floor(rng() * 99));
      return set;
    };
    const frontWindows = pickWindows(windowsPerFloor);
    const backWindows = pickWindows(windowsPerFloor);

    // front (+Z) and back (-Z)
    for (let i = 0; i < nX; i++) {
      const lx = -halfW + MODULE.wallWidth / 2 + i * MODULE.wallWidth;
      for (const front of [true, false]) {
        let name = solid;
        if (front && ground && i === doorModule) name = doorWall;
        else if ((front ? frontWindows : backWindows).has(i)) name = window;
        place('village', name, lx, y, (front ? 1 : -1) * (halfD - inset), front ? 0 : Math.PI);
      }
    }

    // sides (+X / -X)
    for (let i = 0; i < nZ; i++) {
      const lz = -halfD + MODULE.wallWidth / 2 + i * MODULE.wallWidth;
      for (const right of [true, false]) {
        const name = (i === 1 && !ground) ? window : solid;
        place('village', name, (right ? 1 : -1) * (halfW - inset), y, lz,
              right ? Math.PI / 2 : -Math.PI / 2);
      }
    }

    if (quoins) {
      const quoin = 'Corner_Exterior_Brick';
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          place('village', quoin, sx * (halfW - inset), y, sz * (halfD - inset));
        }
      }
    }

    // interior floor deck
    const floorName = ground ? 'Floor_RedBrick' : 'Floor_WoodDark';
    for (let ix = 0; ix < nX; ix++) {
      for (let iz = 0; iz < nZ; iz++) {
        place('village', floorName,
          -halfW + MODULE.floor / 2 + ix * MODULE.floor,
          y + 0.01,
          -halfD + MODULE.floor / 2 + iz * MODULE.floor);
      }
    }
  }

  // Where the door sits along the front face. Needed both for the door leaf
  // and for the exterior door position the city hands back for the guild
  // entrance, so it is declared at function scope.
  const doorX = -halfW + MODULE.wallWidth / 2 + doorModule * MODULE.wallWidth;

  // the actual door leaf, sitting in the wall opening
  if (doorModule >= 0) {
    place('village', rng() < 0.5 ? 'Door_1_Round' : 'Door_8_Round', doorX, 0, halfD - inset * 0.6);
  }

  // roof: the footprint selects it directly
  const roofName = `Roof_RoundTiles_${span}x${length}`;
  if (ROOF_SIZES.some(([s, l]) => s === span && l === length)) {
    place('village', roofName, 0, floors * MODULE.wallHeight, 0);
  } else {
    // fall back to the nearest shipped size
    const [s, l] = nearestRoof(span, length);
    place('village', `Roof_RoundTiles_${s}x${l}`, 0, floors * MODULE.wallHeight, 0);
  }

  if (chimney) {
    place('village', rng() < 0.5 ? 'Prop_Chimney' : 'Prop_Chimney2',
      halfW * 0.55, floors * MODULE.wallHeight + 0.6, -halfD * 0.5);
  }

  if (vines) {
    const vine = `Prop_Vine${[1, 2, 4][Math.floor(rng() * 3)]}`;
    place('village', vine, -halfW + 0.25, 0, halfD * 0.3, Math.PI / 2);
  }

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const toWorld = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const [cx, cz] = toWorld(0, 0);

  return {
    // a rectangle collider is a far better fit than a circle for a long house
    collider: { x: cx, z: cz, hw: halfW + 0.25, hd: halfD + 0.25, yaw },
    center: [cx, cz],
    doorWorld: toWorld(doorX, halfD + 0.6),
    span, length, floors,
  };
}

function nearestRoof(span, length) {
  let best = ROOF_SIZES[0];
  let bestD = Infinity;
  for (const [s, l] of ROOF_SIZES) {
    const d = Math.abs(s - span) * 2 + Math.abs(l - length);
    if (d < bestD) { bestD = d; best = [s, l]; }
  }
  return best;
}

// --------------------------------------------------------------------- city

/**
 * Build Ravenshold. Returns the collider set plus the landmarks the rest of
 * the game needs (guild door, waystone, spawn point).
 */
export async function buildCity(scene, assets, { seed = 4242, onProgress = () => {} } = {}) {
  const rng = mulberry32(seed);
  const batch = new PlacementBatch(scene);
  const colliders = [];
  const addBox = (b) => colliders.push(b);

  const models = await loadModels(assets, [
    ...CITY_VILLAGE_MODELS.map((name) => ({ kit: 'village', name })),
    ...CITY_PROP_MODELS.map((name) => ({ kit: 'props', name })),
  ], (p) => onProgress(p * 0.7));

  const place = (kit, name, x, y, z, yaw = 0, scale = 1, o = undefined) =>
    batch.add(kit, name, trs(x, y, z, yaw, scale), o);

  // -------------------------------------------------------------- pavement
  const cobble = (cx, cz, radius, tile = 'Floor_Brick') => {
    const step = MODULE.floor;
    const n = Math.ceil(radius / step) + 1;
    for (let ix = -n; ix <= n; ix++) {
      for (let iz = -n; iz <= n; iz++) {
        const x = cx + ix * step;
        const z = cz + iz * step;
        const d = Math.hypot(x - cx, z - cz);
        if (d > radius) continue;
        // ragged edge so the paving does not read as a perfect disc
        if (d > radius - step * 0.9 && rng() < 0.45) continue;
        const name = rng() < 0.14 ? 'Floor_RedBrick' : tile;
        place('village', name, x, terrainHeight(x, z) + 0.02, z, Math.floor(rng() * 4) * (Math.PI / 2));
      }
    }
  };

  // plaza
  cobble(0, 0, 15);

  // radial streets: gate at angle 0, two flanks, guild on the -Z axis
  const STREET_ANGLES = [0, Math.PI / 2, -Math.PI / 2];
  for (const a of STREET_ANGLES) {
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    for (let r = 15; r < CITY.wallRadius; r += 1.6) {
      for (let o = -2.6; o <= 2.6; o += 1.6) {
        const x = dx * r + Math.cos(a) * o;
        const z = dz * r - Math.sin(a) * o;
        if (rng() < 0.08) continue;
        place('village', rng() < 0.12 ? 'Floor_RedBrick' : 'Floor_Brick',
          x, terrainHeight(x, z) + 0.02, z, Math.floor(rng() * 4) * (Math.PI / 2));
      }
    }
  }

  // ------------------------------------------------------------ curtain wall
  const wallR = CITY.wallRadius;
  const circumference = 2 * Math.PI * wallR;
  const segments = Math.round(circumference / MODULE.wallWidth);
  const gateHalf = CITY.gateWidth / 2 + 1.2;

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.sin(a) * wallR;
    const z = Math.cos(a) * wallR;

    // leave a gap for the gate
    const along = Math.atan2(Math.sin(a - CITY.gateAngle), Math.cos(a - CITY.gateAngle)) * wallR;
    if (Math.abs(along) < gateHalf) continue;

    const yaw = a; // wall faces outward, radially
    for (let level = 0; level < 2; level++) {
      const y = terrainHeight(x, z) + level * MODULE.wallHeight;
      const name = level === 0 ? 'Wall_UnevenBrick_Straight' : 'Wall_Plaster_Straight';
      place('village', name, x, y, z, yaw);
    }
    // crenellation-ish: a short upper course every few segments
    if (i % 3 === 0) {
      place('village', 'Wall_Plaster_Straight', x, terrainHeight(x, z) + MODULE.wallHeight * 2, z, yaw);
    }

    const tx = x - Math.sin(a) * 0.5;
    const tz = z - Math.cos(a) * 0.5;
    addBox({ x: tx, z: tz, hw: 0.35, hd: 1.05, yaw });
  }

  // gate towers
  const gateTowers = [];
  for (const sign of [-1, 1]) {
    const a = CITY.gateAngle + sign * (gateHalf + 2.2) / wallR;
    const tx = Math.sin(a) * wallR;
    const tz = Math.cos(a) * wallR;
    gateTowers.push([tx, tz]);

    const size = 2; // modules
    for (let level = 0; level < 3; level++) {
      const y = terrainHeight(tx, tz) + level * MODULE.wallHeight;
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const lx = -size + MODULE.wallWidth / 2 + i * MODULE.wallWidth;
          const lz = -size + MODULE.wallWidth / 2 + j * MODULE.wallWidth;
          place('village', 'Wall_UnevenBrick_Straight', tx + lx, y, tz + lz, a);
        }
      }
    }
    place('village', 'Roof_Tower_RoundTiles', tx, terrainHeight(tx, tz) + 3 * MODULE.wallHeight, tz, a);
    addBox({ x: tx, z: tz, hw: 2.2, hd: 2.2, yaw: a });
  }

  // a torch either side of the gate
  for (const sign of [-1, 1]) {
    const a = CITY.gateAngle + sign * (gateHalf - 0.6) / wallR;
    const tx = Math.sin(a) * (wallR - 0.5);
    const tz = Math.cos(a) * (wallR - 0.5);
    place('props', 'Torch_Metal', tx, terrainHeight(tx, tz) + 2.4, tz, a + Math.PI);
  }

  // -------------------------------------------------------------- guild hall
  // the landmark: bigger, quoined, with banners and a courtyard
  const guildSpan = 8;
  const guildLength = 12;
  const guildX = 0;
  const guildZ = -30;
  const guildYaw = 0; // door faces +Z, toward the plaza

  const guild = buildHouse(batch, models, {
    x: guildX, z: guildZ, yaw: guildYaw,
    span: guildSpan, length: guildLength, floors: 2,
    stoneBase: true, doorModule: 1, windowsPerFloor: 3,
    rng, quoins: true, chimney: false,
  });
  addBox(guild.collider);

  // banners flanking the entrance + a weapon stand outside
  {
    const c = Math.cos(guildYaw);
    const s = Math.sin(guildYaw);
    const put = (kit, name, lx, ly, lz, lyaw = 0) =>
      place(kit, name, guildX + lx * c + lz * s, terrainHeight(guildX, guildZ) + ly, guildZ - lx * s + lz * c, guildYaw + lyaw);

    put('props', 'Banner_1', -2.4, 4.2, guildLength / 2 + 0.35);
    put('props', 'Banner_1', 2.4, 4.2, guildLength / 2 + 0.35);
    put('props', 'WeaponStand', -4.6, 0, guildLength / 2 + 1.2, 0.4);
    put('props', 'Dummy', 5.2, 0, guildLength / 2 + 1.4, -0.5);
    put('props', 'Crate_Wooden', 4.4, 0, guildLength / 2 + 2.6, 0.3);
    put('props', 'Barrel', 5.0, 0, guildLength / 2 + 3.3, 0);
    put('props', 'Anvil', -5.2, 0, guildLength / 2 + 2.8, 0.6);
    // a paved forecourt
    for (let ix = -4; ix <= 4; ix++) {
      for (let iz = 0; iz <= 4; iz++) {
        const lx = ix * MODULE.floor;
        const lz = guildLength / 2 + 2 + iz * MODULE.floor;
        place('village', 'Floor_Brick',
          guildX + lx * c + lz * s, terrainHeight(guildX + lx, guildZ + lz) + 0.02, guildZ - lx * s + lz * c);
      }
    }
  }

  // ------------------------------------------------------------------ houses
  const houses = [];
  const skipZone = { x: guildX, z: guildZ, r: 13 };

  for (const a of STREET_ANGLES) {
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const px = Math.cos(a);
    const pz = -Math.sin(a);

    for (const side of [-1, 1]) {
      for (const r of [23, 31, 38]) {
        const jitter = (rng() - 0.5) * 3;
        const cx = dx * (r + jitter) + px * side * 8.5;
        const cz = dz * (r + jitter) + pz * side * 8.5;
        if (Math.hypot(cx - skipZone.x, cz - skipZone.z) < skipZone.r) continue;
        if (Math.hypot(cx, cz) > CITY.wallRadius - 6) continue;
        if (terrainSlope(cx, cz) > 0.35) continue;

        // faces back toward the street
        const yaw = a + (side > 0 ? Math.PI : 0) + Math.PI / 2;
        const [span, length] = pickFootprint(rng);

        const h = buildHouse(batch, models, {
          x: cx, z: cz, yaw,
          span, length, floors: 1 + (rng() < 0.55 ? 1 : 0),
          stoneBase: true,
          doorModule: Math.floor(rng() * (span / 2)),
          windowsPerFloor: 1 + Math.floor(rng() * 2),
          rng, quoins: false,
          chimney: rng() < 0.7,
          vines: rng() < 0.3,
        });
        addBox(h.collider);
        houses.push(h);
      }
    }
  }

  // ------------------------------------------------ market + street dressing
  const marketSpots = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = 9 + rng() * 3;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const yaw = a + Math.PI;
    place('props', rng() < 0.4 ? 'Stall_Cart_Empty' : 'Stall_Empty', x, terrainHeight(x, z), z, yaw);
    place('props', rng() < 0.5 ? 'Barrel' : 'Crate_Wooden',
      x + Math.cos(a) * 1.4, terrainHeight(x, z), z - Math.sin(a) * 1.4, rng() * 3);
    if (rng() < 0.6) {
      place('props', rng() < 0.5 ? 'FarmCrate_Apple' : 'FarmCrate_Carrot',
        x - Math.cos(a) * 1.2, terrainHeight(x, z), z + Math.sin(a) * 1.2, rng() * 3);
    }
    marketSpots.push([x, z]);
    addBox({ x, z, hw: 1.1, hd: 0.7, yaw });
  }

  // crates, barrels and fences scattered along the streets
  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const r = 6 + rng() * (CITY.wallRadius - 10);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (Math.hypot(x - guildX, z - guildZ) < 11) continue;
    const y = terrainHeight(x, z);
    const pick = rng();
    const yaw = rng() * 3;
    if (pick < 0.3) {
      place('village', 'Prop_Crate', x, y, z, yaw);
      addBox({ x, z, hw: 0.6, hd: 0.6, yaw });
    } else if (pick < 0.5) {
      place('props', 'Barrel', x, y, z, yaw);
      addBox({ x, z, hw: 0.4, hd: 0.4, yaw });
    } else if (pick < 0.62) {
      place('props', 'Bag', x, y, z, yaw);
    } else if (pick < 0.72) {
      // wagons are 4 m long; without a collider the camera boom parks inside
      place('village', 'Prop_Wagon', x, y, z, yaw);
      addBox({ x, z, hw: 1.1, hd: 2.1, yaw });
    } else if (pick < 0.82) {
      place('props', 'Chain_Coil', x, y, z, yaw);
    } else if (pick < 0.9) {
      place('props', 'Cauldron', x, y, z, yaw);
      addBox({ x, z, hw: 0.5, hd: 0.5, yaw });
    } else {
      place('props', 'Pot_1', x, y, z, yaw);
    }
  }

  // wooden fences ringing the inner edge of the wall
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 + 0.02;
    const r = CITY.wallRadius - 3.5;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const along = Math.atan2(Math.sin(a - CITY.gateAngle), Math.cos(a - CITY.gateAngle)) * r;
    if (Math.abs(along) < gateHalf + 2) continue;
    place('village', 'Prop_WoodenFence_Extension1', x, terrainHeight(x, z), z, a);
  }

  const created = batch.flush(models);
  onProgress(1);

  return {
    colliders,
    houses,
    gateTowers,
    guild: {
      ...guild,
      doorWorld: guild.doorWorld,
      center: [guildX, guildZ],
    },
    spawnPoint: [0, 16],
    marketSpots,
    meshes: created,
    modelNames: new Set([...CITY_VILLAGE_MODELS, ...CITY_PROP_MODELS]),
    /** world position of the gate opening */
    gate: [Math.sin(CITY.gateAngle) * CITY.wallRadius, Math.cos(CITY.gateAngle) * CITY.wallRadius],
  };
}

/** Footprints that the kit has a roof for. */
function pickFootprint(rng) {
  const [span, length] = ROOF_SIZES[Math.floor(rng() * ROOF_SIZES.length)];
  return [span, length];
}
