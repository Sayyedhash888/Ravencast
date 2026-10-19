import * as THREE from 'three';

/**
 * Shared world-building primitives: deterministic noise, a batching instancer,
 * and rejection-sampled scatter.
 *
 * The kits are built from a small number of models repeated hundreds of times
 * (one tree model, one wall module, one cobble tile), so almost everything in
 * the world is drawn as an InstancedMesh. Batches are additionally split into
 * angular sectors: a single instanced mesh spanning the whole map has a
 * bounding sphere the size of the map and can never be culled, so it is
 * submitted every frame in both the main and the shadow pass.
 */

/** Deterministic RNG so the world looks the same on every reload. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 2D value noise. */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const h = (a, b) => {
    let n = a * 374761393 + b * 668265263 + seed * 1442695040888963407;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal noise, a few octaves of valueNoise. */
export function fbm(x, y, seed = 0, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, y * f, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return sum / norm;
}

export function smoothstep(edge0, edge1, x) {
  return THREE.MathUtils.smoothstep(x, edge0, edge1);
}

/** Rejection-sampled positions in an annulus, optionally with spacing. */
export function scatterPoints(rng, count, rMin, rMax, minDist = 0, existing = []) {
  const pts = [];
  const minSq = minDist * minDist;
  let guard = count * 60;
  while (pts.length < count && guard-- > 0) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng() * (rMax * rMax - rMin * rMin) + rMin * rMin);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    let ok = true;
    if (minSq > 0) {
      for (let i = 0; i < pts.length && ok; i++) {
        const dx = pts[i].x - x;
        const dz = pts[i].z - z;
        if (dx * dx + dz * dz < minSq) ok = false;
      }
      for (let i = 0; i < existing.length && ok; i++) {
        const dx = existing[i].x - x;
        const dz = existing[i].z - z;
        if (dx * dx + dz * dz < minSq) ok = false;
      }
    }
    if (ok) pts.push({ x, z, r });
  }
  return pts;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Compose a TRS matrix, with an optional lean for settling things on slopes. */
export function trs(x, y, z, yaw = 0, scale = 1, tiltX = 0, tiltZ = 0) {
  _e.set(tiltX, yaw, tiltZ);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.set(scale.x, scale.y, scale.z);
  return new THREE.Matrix4().compose(_v, _q, _s);
}

/** Flatten a loaded kit model into drawable primitives with local transforms. */
export function collectPrimitives(root) {
  root.updateWorldMatrix(true, true);
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    // the model root is unparented, so its matrixWorld is identity and each
    // child's matrixWorld is already the local-to-model transform we want
    out.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
  });
  return out;
}

/** Cached primitive lists, since the same model is placed thousands of times. */
const primitiveCache = new Map();
export function primitivesOf(kit, name, model) {
  const key = `${kit}/${name}`;
  let prims = primitiveCache.get(key);
  if (!prims) {
    prims = collectPrimitives(model);
    primitiveCache.set(key, prims);
  }
  return prims;
}

const CHUNKS = 8;

/**
 * Collects placements and flushes them into instanced meshes, grouped by model,
 * shadow flags and angular sector.
 */
export class PlacementBatch {
  constructor(scene) {
    this.scene = scene;
    this.entries = new Map(); // key -> { kit, name, prims, cast, receive, items: [] }
  }

  /**
   * @param {string} kit    'nature' | 'village' | 'props'
   * @param {string} name   model name within the kit
   * @param {THREE.Matrix4} matrix world transform
   */
  add(kit, name, matrix, { castShadow = true, receiveShadow = true } = {}) {
    const key = `${kit}/${name}/${castShadow ? 1 : 0}${receiveShadow ? 1 : 0}`;
    let group = this.entries.get(key);
    if (!group) {
      group = { kit, name, castShadow, receiveShadow, items: [] };
      this.entries.set(key, group);
    }
    group.items.push(matrix);
  }

  /** Convenience: place a model at a position with yaw/scale/tilt. */
  place(kit, name, x, y, z, yaw = 0, scale = 1, opts = null) {
    this.add(kit, name, trs(x, y, z, yaw, scale, opts?.tiltX || 0, opts?.tiltZ || 0), opts || undefined);
  }

  /** Build the meshes. `models` maps "kit/name" -> loaded Object3D. */
  flush(models) {
    const created = [];
    for (const group of this.entries.values()) {
      const model = models.get(`${group.kit}/${group.name}`);
      if (!model) {
        console.warn(`[Placement] missing model ${group.kit}/${group.name}`);
        continue;
      }
      const prims = primitivesOf(group.kit, group.name, model);

      // sectoring only pays for models the frustum can actually reject. Biome
      // ground cover (grass, pebbles, petals) already had map-sized sector
      // bounds, so merging it saves draw calls without losing culling; the city
      // keeps its sectors because whole streets are culled per frame.
      let modelTris = 0;
      for (const p of prims) {
        modelTris += (p.geometry.index
          ? p.geometry.index.count
          : p.geometry.attributes.position.count) / 3;
      }
      const chunks = (group.kit === 'nature' && modelTris < 1200) ? 1 : CHUNKS;

      // bucket by angular sector so the frustum has something to reject
      const sectors = new Map();
      for (const m of group.items) {
        const x = m.elements[12];
        const z = m.elements[14];
        const a = Math.atan2(z, x);
        const s = chunks === 1 ? 0
          : Math.min(chunks - 1, Math.max(0, Math.floor(((a + Math.PI) / (Math.PI * 2)) * chunks)));
        if (!sectors.has(s)) sectors.set(s, []);
        sectors.get(s).push(m);
      }

      for (const items of sectors.values()) {
        for (const prim of prims) {
          const inst = new THREE.InstancedMesh(prim.geometry, prim.material, items.length);
          for (let i = 0; i < items.length; i++) {
            _m.multiplyMatrices(items[i], prim.matrix);
            inst.setMatrixAt(i, _m);
          }
          inst.instanceMatrix.needsUpdate = true;
          inst.castShadow = group.castShadow;
          inst.receiveShadow = group.receiveShadow;
          inst.computeBoundingSphere();
          inst.frustumCulled = true;
          inst.name = `${group.name}`;
          // remembered so a graphics preset can thin heavy scatter by draw range
          inst.userData.fullCount = items.length;
          inst.userData.tris = (prim.geometry.index
            ? prim.geometry.index.count
            : prim.geometry.attributes.position.count) / 3;
          this.scene.add(inst);
          created.push(inst);
        }
      }
    }
    this.entries.clear();
    return created;
  }
}

/** Load every model a builder will need, keyed "kit/name" for the batch. */
export async function loadModels(assets, requests, onProgress = null) {
  const models = new Map();
  let done = 0;
  const total = requests.length;
  await Promise.all(requests.map(async ({ kit, name }) => {
    const model = await assets.kit(kit, name);
    models.set(`${kit}/${name}`, model);
    done++;
    if (onProgress) onProgress(done / total);
  }));
  return models;
}
