import * as THREE from 'three';
import { PlacementBatch, loadModels, mulberry32, trs } from './Placement.js';

/**
 * The guild hall interior.
 *
 * Built as a sealed room parked far outside the world (see INTERIOR_ORIGIN)
 * rather than carved into the city block, so the city can stay a pure exterior
 * build. Entering and leaving is a fade + teleport triggered at the door, which
 * is how the player "walks in" without the room needing a visible opening.
 *
 * Everything is furnished from the Fantasy Props MegaKit.
 */

export const INTERIOR_ORIGIN = [1200, 0, 0];
export const ROOM = {
  width: 18,    // X
  depth: 24,    // Z
  wallHeight: 3.12,
  module: 2.0,
  wallDepth: 0.41,
};

export const GUILD_VILLAGE_MODELS = [
  'Wall_Plaster_Straight', 'Corner_Interior_Big',
  'Floor_WoodDark', 'Floor_WoodLight', 'Wall_Arch', 'Door_4_Round',
  'DoorFrame_Round_WoodDark',
];

export const GUILD_PROP_MODELS = [
  'Bookcase_2', 'BookGroup_Small_1', 'Book_Stack_1', 'Shelf_Arch',
  'Table_Large', 'Bench', 'Chair_1',
  'Chandelier', 'CandleStick_Triple', 'Lantern_Wall', 'Banner_1',
  'Chest_Wood', 'Barrel', 'Crate_Wooden',
  'WeaponStand', 'Sword_Bronze', 'Shield_Wooden', 'Dummy', 'Workbench',
  'Anvil', 'Whetstone', 'Scroll_1', 'Scroll_2',
  'Coin_Pile_2', 'Chalice', 'Mug', 'Cage_Small', 'Peg_Rack',
  'Key_Gold', 'Stall_Empty',
];

/**
 * Build the hall. Returns colliders, the furniture anchors the game needs
 * (desk, mission board, forge) and the spots NPCs should occupy.
 */
export async function buildGuildInterior(scene, assets, { onProgress = () => {} } = {}) {
  const rng = mulberry32(9182);
  const batch = new PlacementBatch(scene);
  const colliders = [];
  const [ox, oy, oz] = INTERIOR_ORIGIN;

  const models = await loadModels(assets, [
    ...GUILD_VILLAGE_MODELS.map((name) => ({ kit: 'village', name })),
    ...GUILD_PROP_MODELS.map((name) => ({ kit: 'props', name })),
  ], (p) => onProgress(p * 0.8));

  /** Local-space placer; the room sits at INTERIOR_ORIGIN with floor at y=oy. */
  const place = (kit, name, lx, ly, lz, yaw = 0, scale = 1, o = undefined) =>
    batch.add(kit, name, trs(ox + lx, oy + ly, oz + lz, yaw, scale), o);

  const halfW = ROOM.width / 2;
  const halfD = ROOM.depth / 2;
  const inset = ROOM.wallDepth / 2;
  const nX = Math.round(ROOM.width / ROOM.module);
  const nZ = Math.round(ROOM.depth / ROOM.module);

  // ------------------------------------------------------------------ shell
  for (let i = 0; i < nX; i++) {
    const lx = -halfW + ROOM.module / 2 + i * ROOM.module;
    for (const front of [true, false]) {
      place('village', 'Wall_Plaster_Straight', lx, 0, (front ? 1 : -1) * (halfD - inset),
            front ? 0 : Math.PI);
    }
  }
  for (let i = 0; i < nZ; i++) {
    const lz = -halfD + ROOM.module / 2 + i * ROOM.module;
    for (const right of [true, false]) {
      place('village', 'Wall_Plaster_Straight', (right ? 1 : -1) * (halfW - inset), 0, lz,
            right ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  // corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      place('village', 'Corner_Interior_Big', sx * (halfW - inset), 0, sz * (halfD - inset));
    }
  }

  // floor and ceiling
  for (let ix = 0; ix < nX; ix++) {
    for (let iz = 0; iz < nZ; iz++) {
      const lx = -halfW + ROOM.module / 2 + ix * ROOM.module;
      const lz = -halfD + ROOM.module / 2 + iz * ROOM.module;
      place('village', rng() < 0.15 ? 'Floor_WoodLight' : 'Floor_WoodDark', lx, 0, lz);
      // ceiling tiles, flipped so the beams read from below
      place('village', 'Floor_WoodDark', lx, ROOM.wallHeight, lz, Math.PI);
    }
  }

  // the gate you leave through: frame + leaf on the inside face of the +Z
  // wall, turned to face the hall. The old leaf faced outward and sat inside
  // the wall, so from inside the exit read as a blank wall.
  const gateZ = halfD - ROOM.wallDepth - 0.02;
  place('village', 'DoorFrame_Round_WoodDark', 0, 0, gateZ + 0.02, Math.PI);
  place('village', 'Door_4_Round', 0, 0, gateZ - 0.04, Math.PI);
  place('props', 'Lantern_Wall', -1.9, 1.9, halfD - 0.45, Math.PI);
  place('props', 'Lantern_Wall', 1.9, 1.9, halfD - 0.45, Math.PI);

  // (the plaster overhang pieces that used to ring the ceiling poked through
  // the planks as pale wedges; the flat timber ceiling reads cleaner)

  // ------------------------------------------------------------- furniture
  const anchor = (lx, ly, lz, yaw, name, kit = 'props', scale = 1) => {
    place(kit, name, lx, ly, lz, yaw, scale);
    return { x: ox + lx, y: oy + ly, z: oz + lz, yaw };
  };

  // --- reception desk, straight ahead of the entrance
  const deskZ = 2.0;
  anchor(-1.5, 0, deskZ, 0, 'Table_Large');
  anchor(1.6, 0, deskZ, 0, 'Table_Large');
  colliders.push({ x: ox, z: oz + deskZ, hw: 2.9, hd: 0.7, yaw: 0 });
  anchor(-1.2, 0.85, deskZ - 0.2, 0, 'Scroll_1');
  anchor(0.3, 0.85, deskZ - 0.1, 0.4, 'Scroll_2');
  anchor(1.9, 0.85, deskZ - 0.2, 0, 'Coin_Pile_2');
  anchor(0.9, 0.85, deskZ + 0.2, 0, 'Key_Gold');
  anchor(-2.6, 0, deskZ - 1.6, 0, 'Chair_1');

  // --- mission board on the left wall
  // a plank floor tile stood on its side reads as a board; the banner that used
  // to hang here looked like cloth, not like something to interact with
  const board = { x: ox - halfW + 0.42, y: oy + 1.5, z: oz - 3.5, yaw: Math.PI / 2 };
  place('village', 'Wall_Arch', -halfW + inset, 0, -3.5, Math.PI / 2);
  batch.add('village', 'Floor_WoodDark',
            trs(ox - halfW + 0.42, oy + 1.48, oz - 3.5, 0, 0.82, 0, -Math.PI / 2));
  // pinned contracts, angled so the board reads as used rather than staged
  for (const [ly, lz, tilt, scale, name] of [
    [1.12, -3.95, 0.16, 2.2, 'Scroll_2'],
    [1.50, -3.10, -0.12, 2.0, 'Scroll_1'],
    [1.86, -3.78, 0.22, 1.7, 'Scroll_2'],
  ]) {
    anchor(-halfW + 0.50, ly, lz, Math.PI / 2 + tilt, name, 'props', scale);
  }
  // lanterns either side make it the brightest spot on that wall
  anchor(-halfW + 0.24, 1.95, -1.95, Math.PI / 2, 'Lantern_Wall');
  anchor(-halfW + 0.24, 1.95, -5.05, Math.PI / 2, 'Lantern_Wall');
  anchor(-halfW + 1.2, 0, -5.4, 0, 'Crate_Wooden');
  anchor(-halfW + 1.0, 0, -1.6, 0.3, 'Barrel');

  // --- forge / upgrade counter on the right wall
  const forge = anchor(halfW - 1.4, 0, -2.0, -Math.PI / 2, 'Workbench');
  anchor(halfW - 1.3, 0, -4.0, -Math.PI / 2, 'Anvil');
  anchor(halfW - 1.5, 0, -5.6, -Math.PI / 2, 'Whetstone');
  anchor(halfW - 1.1, 0, 0.2, -Math.PI / 2, 'WeaponStand');
  anchor(halfW - 1.1, 0, 1.8, -Math.PI / 2, 'WeaponStand');
  anchor(halfW - 0.7, 1.6, -0.8, -Math.PI / 2, 'Shield_Wooden');
  anchor(halfW - 0.7, 1.5, 0.8, -Math.PI / 2, 'Sword_Bronze');
  colliders.push({ x: ox + halfW - 1.4, z: oz - 3.2, hw: 1.2, hd: 3.4, yaw: 0 });

  // --- reading tables down the middle
  const tableSpots = [[-5.5, -8.5, 0.1], [4.5, -9.5, -0.15], [-4.0, -14.0, 0.05], [5.0, -15.5, 0.2]];
  for (const [lx, lz, yaw] of tableSpots) {
    anchor(lx, 0, lz, yaw, 'Table_Large');
    anchor(lx - 1.9, 0, lz, yaw, 'Bench');
    anchor(lx + 1.9, 0, lz, yaw + Math.PI, 'Bench');
    anchor(lx, 0.85, lz, yaw, rng() < 0.5 ? 'Mug' : 'Chalice');
    if (rng() < 0.6) anchor(lx + 0.7, 0.85, lz + 0.2, yaw, 'Book_Stack_1');
    colliders.push({ x: ox + lx, z: oz + lz, hw: 1.6, hd: 0.8, yaw });
  }

  // --- library along the back wall
  for (let i = 0; i < 6; i++) {
    const lx = -6.5 + i * 2.6;
    anchor(lx, 0, -halfD + 0.9, 0, i % 2 === 0 ? 'Bookcase_2' : 'Shelf_Arch');
    if (i % 2 === 1) anchor(lx, 1.7, -halfD + 0.9, 0, 'BookGroup_Small_1');
  }
  anchor(-8.0, 0, -halfD + 2.2, Math.PI / 4, 'Chest_Wood');
  anchor(8.0, 0, -halfD + 2.2, -Math.PI / 4, 'Cage_Small');
  anchor(6.6, 0, -halfD + 3.4, 0, 'Peg_Rack');

  // --- training corner
  anchor(-7.5, 0, -18.5, 0.6, 'Dummy');
  anchor(-6.0, 0, -20.0, -0.4, 'Dummy');
  anchor(-8.6, 0, -20.6, 1.1, 'Crate_Wooden');
  anchor(7.6, 0, -20.0, 0, 'Stall_Empty');

  // (random floor clutter was removed: kit prop pivots vary, so loose props
  // could float or intersect tables; the fixed furniture reads cleaner)

  // --- hanging light: chandeliers + candles
  const chandeliers = [[0, -2.5], [0, -11], [0, -19]];
  for (const [lx, lz] of chandeliers) {
    anchor(lx, ROOM.wallHeight - 0.15, lz, 0, 'Chandelier');
  }
  for (const lx of [-6, -2, 2, 6]) {
    anchor(lx, 0.86, -5.6, 0, 'CandleStick_Triple');
  }
  anchor(-halfW + 0.8, 1.4, 6.5, Math.PI / 2, 'Banner_1');
  anchor(halfW - 0.8, 1.4, 6.5, -Math.PI / 2, 'Banner_1');

  const meshes = batch.flush(models);

  // solid backing above the planks: small tile gaps at the eaves otherwise
  // show the pale sky through the ceiling
  const cap = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM.width + 2, ROOM.depth + 2),
    new THREE.MeshBasicMaterial({ color: 0x1b120b, side: THREE.DoubleSide }),
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.set(ox, oy + ROOM.wallHeight + 0.08, oz);
  scene.add(cap);
  meshes.push(cap);

  // ------------------------------------------------------------- lighting
  const lights = [];
  const lamp = (lx, ly, lz, intensity = 9, distance = 16, colour = 0xffb066) => {
    const light = new THREE.PointLight(colour, intensity, distance, 2);
    light.position.set(ox + lx, oy + ly, oz + lz);
    light.castShadow = false;
    scene.add(light);
    lights.push(light);
    return light;
  };
  // keep the lamps clear of the chandelier meshes and the ceiling, otherwise
  // the fixture blows out and the ceiling turns into a hot orange disc
  lamp(0, 2.05, -2.5, 9, 18);
  lamp(0, 2.05, -11, 8, 18);
  lamp(0, 2.05, -19, 7, 16);
  lamp(-5, 1.5, -6, 4, 9);
  lamp(5.4, 1.5, -4, 4, 9);
  lamp(0, 1.8, 4.0, 5, 12);

  onProgress(1);

  return {
    colliders,
    meshes,
    lights,
    origin: INTERIOR_ORIGIN,
    bounds: { halfW, halfD, height: ROOM.wallHeight },
    anchors: {
      desk: { x: ox, z: oz + deskZ, yaw: Math.PI },   // receptionist faces +Z... see NPC setup
      board,
      forge,
      entrance: { x: ox, z: oz + halfD - 1.5 },
      exitDoor: { x: ox, z: oz + halfD - 1.0 },
    },
    /**
     * Where NPCs stand. `yaw` is the facing direction in radians about Y.
     * Positions are local to the room; the NPC builder adds the origin.
     */
    npcSpots: [
      { role: 'receptionist', x: 0.2, z: deskZ - 1.1, yaw: 0, outfit: 'peasantF' },
      { role: 'quartermaster', x: halfW - 2.6, z: -2.0, yaw: -Math.PI / 2, outfit: 'peasantM' },
      { role: 'board', x: -halfW + 2.2, z: -6.2, yaw: Math.PI / 2, outfit: 'rangerF' },
      { role: 'table1', x: -5.5, z: -8.5, yaw: Math.PI, outfit: 'peasantM' },
      { role: 'table2', x: 4.5, z: -9.5, yaw: 0, outfit: 'peasantF' },
      { role: 'library', x: 2.0, z: -halfD + 1.8, yaw: 0, outfit: 'ranger' },
      { role: 'training', x: -6.6, z: -17.0, yaw: 0.4, outfit: 'rangerF' },
      { role: 'idle', x: 5.8, z: 6.0, yaw: -2.4, outfit: 'peasantM' },
    ],
  };
}
