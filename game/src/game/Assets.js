import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildHeadLibrary } from './Head.js';

/**
 * Everything the packs contain shares one UE5-style skeleton
 * (root, pelvis, spine_01..03, neck_01, Head, clavicle_l/r, upperarm/lowerarm/hand,
 * fingers, thigh/calf/foot/ball). Because the bone names line up exactly, a clip
 * authored for one model binds straight onto any other — that is what lets the
 * player's sword swings drive the monsters and the guild NPCs alike.
 *
 * Three of the packs (nature, village, props) are flat folders of small glTF
 * models sharing a handful of WebP textures, so they go through one generic
 * `kit()` loader; the characters and monsters are self-contained GLBs.
 */

const CHARACTERS = {
  ranger: 'assets/chars/Male_Ranger.glb',
  rangerF: 'assets/chars/Female_Ranger.glb',
  peasantM: 'assets/chars/Male_Peasant.glb',
  peasantF: 'assets/chars/Female_Peasant.glb',
};

const CREATURES = {
  imp: 'assets/monsters/Imp.glb',
  puglin: 'assets/monsters/Puglin.glb',
};

// the outfits ship clothing only; these bodies supply the heads, eyes, brows
// and hair that fit the same skeleton (see Head.js)
const BASE_HEADS = {
  maleHead: 'assets/chars/Base_Male.glb',
  femaleHead: 'assets/chars/Base_Female.glb',
};

const HAIR = {
  buzzed: 'assets/chars/Hair_Buzzed.glb',
  buzzedF: 'assets/chars/Hair_BuzzedFemale.glb',
  parted: 'assets/chars/Hair_SimpleParted.glb',
  buns: 'assets/chars/Hair_Buns.glb',
  long: 'assets/chars/Hair_Long.glb',
  beard: 'assets/chars/Hair_Beard.glb',
};

const ANIMATION_LIBS = {
  anim1: 'assets/anim/UAL1_Standard.glb',
  anim2: 'assets/anim/UAL2_Standard.glb',
};

const KITS = {
  nature: 'assets/nature/',
  village: 'assets/village/',
  props: 'assets/props/',
};

export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.gltf = {};
    /** lib -> Map<clipName, AnimationClip> */
    this.clips = { UAL1: new Map(), UAL2: new Map() };
    this.kitCache = new Map();
  }

  async load(onProgress = () => {}) {
    const entries = [
      ...Object.entries(ANIMATION_LIBS),
      ...Object.entries(CHARACTERS),
      ...Object.entries(CREATURES),
      ...Object.entries(BASE_HEADS),
      ...Object.entries(HAIR),
    ];
    let completed = 0;
    const partial = new Map();

    const report = () => {
      let sum = completed;
      for (const v of partial.values()) sum += v;
      onProgress(Math.min(1, sum / entries.length));
    };

    await Promise.all(entries.map(async ([key, url]) => {
      this.gltf[key] = await this._load(url, (f) => {
        partial.set(key, f);
        report();
      });
      partial.delete(key);
      completed++;
      report();
    }));

    this._indexClips(this.gltf.anim1, 'UAL1');
    this._indexClips(this.gltf.anim2, 'UAL2');

    // a broken head library should not take the whole world down; the smoke
    // test checks for heads explicitly
    try {
      this.heads = buildHeadLibrary({
        male: this.gltf.maleHead,
        female: this.gltf.femaleHead,
        hair: {
          buzzed: this.gltf.buzzed,
          buzzedF: this.gltf.buzzedF,
          parted: this.gltf.parted,
          buns: this.gltf.buns,
          long: this.gltf.long,
          beard: this.gltf.beard,
        },
      });
    } catch (err) {
      console.error('[Assets] head library failed:', err);
      this.heads = null;
    }
    return this;
  }

  _load(url, onProgress) {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        resolve,
        (e) => { if (e.total) onProgress(e.loaded / e.total); },
        (err) => reject(new Error(`Failed to load ${url}: ${err?.message || err}`)),
      );
    });
  }

  _indexClips(gltf, lib) {
    const map = this.clips[lib];
    for (const clip of gltf.animations) {
      // namespaced copies so two libraries can't collide on e.g. A_TPose
      clip.name = `${lib}:${clip.name}`;
      map.set(clip.name, clip);
    }
  }

  /** Fetch a clip by library + author-given name, e.g. clip('UAL1', 'Idle_Loop'). */
  clip(lib, name) {
    const found = this.clips[lib].get(`${lib}:${name}`);
    if (!found) console.warn(`[Assets] missing clip ${lib}:${name}`);
    return found || null;
  }

  // -------------------------------------------------------------- characters

  /**
   * Deep clone of a character/monster with shadows wired up.
   *
   * `hideParts` drops meshes by name. Hoods are handled by Head.js, which
   * hides any piece that would bury the grafted face.
   */
  instantiate(key, { hideParts = null } = {}) {
    const source = this.gltf[key];
    if (!source) throw new Error(`Unknown model "${key}"`);
    const root = this._prepareClone(source.scene, { skin: true });
    if (hideParts) {
      const patterns = hideParts.map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));
      root.traverse((o) => {
        if (!o.isMesh) return;
        if (patterns.some((re) => re.test(o.name))) o.visible = false;
      });
    }
    return root;
  }

  _prepareClone(scene, { skin = false } = {}) {
    const root = cloneSkinned(scene);
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // skinned bounds are unreliable while animating
      o.frustumCulled = !skin;
      const cloneMat = (m) => {
        const c = m.clone();
        c.side = THREE.FrontSide;
        return c;
      };
      if (Array.isArray(o.material)) o.material = o.material.map(cloneMat);
      else if (o.material) o.material = cloneMat(o.material);
    });
    return root;
  }

  // --------------------------------------------------------------- flat kits

  /**
   * Load a static model from one of the flat kits (nature / village / props).
   * Cached and shared: instances are drawn with InstancedMesh or cloned, so the
   * caller must not mutate the returned object.
   */
  kit(kitName, name) {
    const key = `${kitName}/${name}`;
    if (this.kitCache.has(key)) return this.kitCache.get(key);
    const promise = this._load(`${KITS[kitName]}${name}.gltf`, () => {}).then((gltf) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          // cutout foliage is authored as single-sided planes; it needs to be
          // visible from both sides once scattered around the player
          if (m.transparent || m.alphaTest > 0) {
            m.side = THREE.DoubleSide;
            m.alphaTest = Math.max(m.alphaTest, 0.35);
            m.depthWrite = true;
          }
        }
      });
      return scene;
    });
    this.kitCache.set(key, promise);
    return promise;
  }

  /** Load several kit models in parallel; returns { name: Object3D }. */
  async kitSet(kitName, names, onProgress = null) {
    let done = 0;
    const list = await Promise.all(names.map(async (n) => {
      const m = await this.kit(kitName, n);
      done++;
      if (onProgress) onProgress(done / names.length);
      return m;
    }));
    const out = {};
    names.forEach((n, i) => { out[n] = list[i]; });
    return out;
  }
}

/**
 * SkeletonUtils.clone, inlined — it is the one thing we need from that module
 * and this keeps the dependency surface to plain three.
 */
function cloneSkinned(source) {
  const sourceLookup = new Map();
  const cloneLookup = new Map();

  const clone = source.clone();
  parallelTraverse(source, clone, (a, b) => {
    sourceLookup.set(b, a);
    cloneLookup.set(a, b);
  });

  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const srcMesh = sourceLookup.get(node);
    const srcBones = srcMesh.skeleton.bones;
    node.skeleton = srcMesh.skeleton.clone();
    node.bindMatrix.copy(srcMesh.bindMatrix);
    node.skeleton.bones = srcBones.map((bone) => cloneLookup.get(bone));
    node.bind(node.skeleton, node.bindMatrix);
  });

  return clone;
}

function parallelTraverse(a, b, cb) {
  cb(a, b);
  for (let i = 0; i < a.children.length; i++) {
    parallelTraverse(a.children[i], b.children[i], cb);
  }
}

/**
 * Which way does this model face? The toe bone sits ahead of the ankle, so
 * foot -> ball gives us forward without guessing at export conventions.
 * Returns the yaw to apply so the model's forward becomes +Z.
 */
export function computeFacingOffset(root) {
  const foot = root.getObjectByName('foot_l');
  const ball = root.getObjectByName('ball_l');
  if (!foot || !ball) return 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  foot.getWorldPosition(a);
  ball.getWorldPosition(b);
  const forward = b.sub(a);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) return 0;
  forward.normalize();
  return -Math.atan2(forward.x, forward.z);
}

/** World-space height of a model, used for camera framing and hitboxes. */
export function measureHeight(root) {
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root);
  return { height: box.max.y - box.min.y, min: box.min, max: box.max };
}

export { CHARACTERS, CREATURES, KITS };
