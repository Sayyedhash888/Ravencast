import * as THREE from 'three';
import { PlacementBatch, loadModels, mulberry32, scatterPoints, trs, smoothstep } from './Placement.js';
import { REGIONS, terrainHeight, terrainSlope } from './Regions.js';

/**
 * The three mission regions, dressed with the nature kit.
 *
 * The kit does not separate its environments into folders — the biome is
 * implied by which bark/leaf/rock texture a model is wired to (see
 * tools/kit_textures.py). So the sets below are grouped by measured texture,
 * not by filename:
 *
 *   forest   Bark_NormalTree + Leaves_NormalTree / Leaf_Pine  -> green canopy, pines
 *   blight   Bark_TwistedTree + Leaves_TwistedTree, DeadTree  -> red autumn, bare trunks
 *   desert   DeadTree + oversized Rocks_Diffuse outcrops      -> mesas, dry scrub
 *
 * `size` is a target extent in metres, not a multiplier: the kit has no
 * consistent authoring scale, so a grass tuft (1.9 m) and a twisted tree
 * (19 m) need the same treatment to land at believable sizes.
 */

const P = {
  // shared
  rocks: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'],
  pebbles: ['Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3', 'Pebble_Square_1', 'Pebble_Square_2'],
  pathRocks: ['RockPath_Round_Small_1', 'RockPath_Round_Small_2', 'RockPath_Square_Small_1', 'RockPath_Square_Wide'],
  dryGrass: ['Grass_Wispy_Short', 'Grass_Wispy_Tall'],
  lushGrass: ['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall'],
  deadTrees: ['DeadTree_1', 'DeadTree_2', 'DeadTree_3', 'DeadTree_4'],
  petals: ['Petal_1', 'Petal_2', 'Petal_3', 'Petal_4', 'Petal_5'],
  clover: ['Clover_1', 'Clover_2'],
  undergrowth: ['Fern_1', 'Plant_1', 'Plant_1_Big', 'Plant_7', 'Plant_7_Big'],
  flowers: ['Flower_3_Group', 'Flower_4_Group', 'Flower_3_Single', 'Flower_4_Single'],
  mushrooms: ['Mushroom_Common', 'Mushroom_Laetiporus'],
  canopy: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5'],
  pines: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_4'],
  twisted: ['TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_4', 'TwistedTree_5'],
  bushes: ['Bush_Common', 'Bush_Common_Flowers'],
};

/** All nature models any biome can use — loaded once, shared by all three. */
export const BIOME_MODELS = [...new Set(Object.values(P).flat())];

const BIOME_CONFIG = {
  forest: {
    canopy: { names: P.canopy, count: 150, size: [11, 17], solid: 0.75, castShadow: true },
    pines: { names: P.pines, count: 70, size: [12, 19], solid: 0.75, castShadow: true },
    bushes: { names: P.bushes, count: 110, size: [1.1, 2.2], castShadow: false },
    undergrowth: { names: P.undergrowth, count: 180, size: [0.5, 1.2], castShadow: false },
    grass: { names: P.lushGrass, count: 1700, size: [0.34, 0.8], castShadow: false },
    clover: { names: P.clover, count: 400, size: [0.12, 0.3], castShadow: false },
    flowers: { names: P.flowers, count: 240, size: [0.35, 0.75], castShadow: false },
    mushrooms: { names: P.mushrooms, count: 90, size: [0.22, 0.55], castShadow: false },
    rocks: { names: P.rocks, count: 55, size: [1.0, 2.6], solid: 1.1, castShadow: true },
    pebbles: { names: P.pebbles, count: 350, size: [0.1, 0.3], castShadow: false },
  },

  blight: {
    // the twisted trees are ~10k triangles each, the heaviest model in the kit
    twisted: { names: P.twisted, count: 95, size: [10, 17], solid: 0.7, castShadow: true },
    deadTrees: { names: P.deadTrees, count: 70, size: [9, 15], solid: 0.6, castShadow: true },
    bushes: { names: P.bushes, count: 50, size: [0.8, 1.6], castShadow: false },
    undergrowth: { names: P.undergrowth, count: 90, size: [0.5, 1.1], castShadow: false },
    grass: { names: P.dryGrass, count: 1100, size: [0.3, 0.75], castShadow: false },
    // fallen leaves: the petal models are ~0.46 m across, so a target extent
    // near their own size keeps them reading as litter rather than foliage
    petals: { names: P.petals, count: 500, size: [0.22, 0.5], castShadow: false },
    rocks: { names: P.rocks, count: 60, size: [1.0, 3.0], solid: 1.1, castShadow: true },
    pebbles: { names: P.pebbles, count: 260, size: [0.1, 0.3], castShadow: false },
  },

  desert: {
    // mesas: the same rock models blown up to form outcrops, as in the kit's
    // own desert preview
    rocks: { names: ['Rock_Medium_3', 'Rock_Medium_1'], count: 45, size: [6, 15], solid: 3.4, castShadow: true },
    boulders: { names: P.rocks, count: 70, size: [1.2, 3.4], solid: 1.3, castShadow: true },
    deadTrees: { names: P.deadTrees, count: 45, size: [6, 11], solid: 0.55, castShadow: true },
    grass: { names: P.dryGrass, count: 700, size: [0.28, 0.6], castShadow: false },
    pebbles: { names: P.pebbles, count: 420, size: [0.12, 0.35], castShadow: false },
    pathRocks: { names: P.pathRocks, count: 160, size: [0.9, 1.8], castShadow: false },
  },
};

const CHUNK = 8;

export async function buildBiomes(scene, assets, { seed = 777, onProgress = () => {} } = {}) {
  const models = await loadModels(
    assets,
    BIOME_MODELS.map((name) => ({ kit: 'nature', name })),
    (p) => onProgress(p * 0.5),
  );

  const colliders = [];
  const meshes = [];
  const summaries = [];
  const regions = [];

  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    const built = buildOne(scene, models, region, seed + i * 101, colliders);
    meshes.push(...built);
    regions.push({ id: region.id, center: region.center, radius: region.radius, meshes: built });
    summaries.push({ region, placements: built.length });
    onProgress(0.5 + ((i + 1) / REGIONS.length) * 0.5);
  }

  return { colliders, meshes, summaries, regions };
}

function buildOne(scene, models, region, seed, colliders) {
  const rng = mulberry32(seed);
  const batch = new PlacementBatch(scene);
  const [cx, cz] = region.center;
  const R = region.radius;
  const config = BIOME_CONFIG[region.biome];

  // extents, measured once per model
  const extents = new Map();
  for (const [key, model] of models) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    extents.set(key, Math.max(size.x, size.y, size.z, 0.001));
  }

  const place = (kit, name, x, z, yaw, scale, castShadow) =>
    batch.add(kit, name, trs(x, terrainHeight(x, z), z, yaw, scale),
      { castShadow, receiveShadow: true });

  const runSet = (set, radius, minDist, tiltAmount = 0.05) => {
    const pts = scatterPoints(rng, set.count, 0, radius, minDist);
    const buckets = new Map();
    for (const p of pts) {
      const name = set.names[Math.floor(rng() * set.names.length)];
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(p);
    }
    for (const [name, list] of buckets) {
      const sourceExtent = extents.get(`nature/${name}`) || 1;
      for (const p of list) {
        const x = cx + p.x;
        const z = cz + p.z;
        const d = Math.hypot(p.x, p.z);
        // fade props out at the region edge so biomes blend into grassland
        const edge = 1 - smoothstep(radius * 0.82, radius, d);
        if (edge < 0.999 && rng() > edge) continue;
        // keep things off cliffs
        if (set.solid && terrainSlope(x, z) > 0.55) continue;

        const target = set.size[0] + rng() * (set.size[1] - set.size[0]);
        const scale = target / sourceExtent;
        const tilt = set.solid ? tiltAmount : tiltAmount * 1.6;
        batch.add('nature', name,
          trs(x, terrainHeight(x, z) - (set.sink || 0), z,
            rng() * Math.PI * 2, scale,
            tilt * (rng() - 0.5) * 2, tilt * (rng() - 0.5) * 2),
          { castShadow: set.castShadow, receiveShadow: true });

        if (set.solid) colliders.push({ x, z, r: set.solid * Math.min(1.6, scale * 0.6 + 0.5) });
      }
    }
  };

  for (const [key, set] of Object.entries(config)) {
    // big things get spacing so they do not intersect; ground cover does not
    const spacing = set.solid ? 7 : (set.count > 800 ? 0 : 1.6);
    runSet({ ...set, key }, R, spacing);
  }

  return batch.flush(models);
}
