import * as THREE from 'three';
import { buildGround, terrainHeight, regionAt, biomeWeights, CITY, REGIONS } from './Regions.js';
import { ColliderSet } from './Collision.js';
import { buildCity } from './City.js';
import { buildBiomes } from './Biomes.js';
import { buildGuildInterior, INTERIOR_ORIGIN } from './GuildInterior.js';

/**
 * Assembles and owns the world: one terrain, one city, three biome regions and
 * a sealed guild interior parked off-map.
 *
 * The interior is a separate area with its own collider set, so "where am I"
 * is a single switch rather than something every system has to reason about.
 * The sky dome and sun are re-anchored to the camera/player each frame, which
 * is what lets the interior sit a kilometre away without falling outside the
 * sky sphere.
 */

const SUN_DIR = new THREE.Vector3(-0.55, 0.62, -0.42).normalize();

const DEFAULT_SKY = [0x3f6a93, 0xf2d3a2, 0xc9bb9a];
const SKY_TINTS = {
  forest: { tint: 0xd8e4d0, fog: 0xc4d2b8, density: 0.0090 },
  blight: { tint: 0xd8a882, fog: 0xb08a6a, density: 0.0105 },
  desert: { tint: 0xffeccc, fog: 0xe4cfa0, density: 0.0060 },
  grassland: { tint: 0xffffff, fog: 0xc9bb9a, density: 0.0062 },
  city: { tint: 0xffffff, fog: 0xc9bb9a, density: 0.0058 },
};

export class World {
  constructor(scene, assets, renderer) {
    this.scene = scene;
    this.assets = assets;
    this.renderer = renderer;

    this.area = 'world';
    this.worldColliders = new ColliderSet();
    this.interiorColliders = new ColliderSet();
    this.colliders = this.worldColliders;

    /** Metres beyond which whole chunks (city / biome regions) stop drawing. */
    this.drawDistance = 340;
    this._chunkTimer = 0;
    this._chunkPos = new THREE.Vector3(1e9, 0, 1e9);
    // set whenever something changes visibility behind the culler's back
    this._chunksDirty = true;
    this.detailScale = 1;

    this.origin = INTERIOR_ORIGIN;
    this._fogColour = new THREE.Color(0xc9bb9a);
    this._targetFog = new THREE.Color(0xc9bb9a);
    this._skyTint = new THREE.Color(0xffffff);
    this._targetTint = new THREE.Color(0xffffff);
    this._targetDensity = 0.0062;
  }

  // ------------------------------------------------------------------ build

  async build({ seed = 20261017, onProgress = () => {} } = {}) {
    const scene = this.scene;

    // --- sky, re-anchored to the camera every frame
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(420, 32, 20),
      new THREE.MeshBasicMaterial({
        map: makeSkyTexture(),
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeSunTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
      transparent: true,
    }));
    this.sunSprite.scale.set(150, 150, 1);
    this.sunSprite.renderOrder = -999;
    scene.add(this.sunSprite);

    scene.fog = new THREE.FogExp2(0xc9bb9a, 0.0062);

    if (this.renderer) {
      scene.environment = buildEnvironment(this.renderer, this.sky);
      scene.environmentIntensity = 0.75;
    }

    // --- lighting
    this.sun = new THREE.DirectionalLight(0xffd9a0, 3.0);
    this.sun.position.copy(SUN_DIR).multiplyScalar(90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const cam = this.sun.shadow.camera;
    cam.left = -42; cam.right = 42; cam.top = 42; cam.bottom = -42;
    cam.near = 1; cam.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xc6dcf0, 0x5c5a3a, 0.62);
    scene.add(this.hemi);

    this.fill = new THREE.DirectionalLight(0xffc98a, 0.5);
    this.fill.position.set(40, 18, 30);
    scene.add(this.fill);

    // --- ground
    this.ground = buildGround(seed);
    scene.add(this.ground);
    onProgress(0.05);

    // --- city
    this.city = await buildCity(scene, this.assets, {
      seed: seed ^ 0x51ed,
      onProgress: (p) => onProgress(0.05 + p * 0.3),
    });
    for (const b of this.city.colliders) {
      if (b.r !== undefined) this.worldColliders.addCircle(b.x, b.z, b.r);
      else this.worldColliders.addBox(b.x, b.z, b.hw, b.hd, b.yaw);
    }

    // --- biomes
    this.biomes = await buildBiomes(scene, this.assets, {
      seed: seed ^ 0x9e37,
      onProgress: (p) => onProgress(0.35 + p * 0.45),
    });
    for (const c of this.biomes.colliders) {
      this.worldColliders.addCircle(c.x, c.z, c.r);
    }

    // --- guild interior (separate area, its own colliders)
    this.guild = await buildGuildInterior(scene, this.assets, {
      onProgress: (p) => onProgress(0.8 + p * 0.2),
    });
    for (const c of this.guild.colliders) {
      this.interiorColliders.addBox(c.x, c.z, c.hw, c.hd, c.yaw);
    }
    // the interior is sealed: a ring of colliders keeps the player inside
    {
      const [ox, , oz] = INTERIOR_ORIGIN;
      const { halfW, halfD } = this.guild.bounds;
      const t = 1.0;
      this.interiorColliders.addBox(ox, oz - halfD - t, halfW + 4, t, 0);
      this.interiorColliders.addBox(ox, oz + halfD + t, halfW + 4, t, 0);
      this.interiorColliders.addBox(ox - halfW - t, oz, t, halfD + 4, 0);
      this.interiorColliders.addBox(ox + halfW + t, oz, t, halfD + 4, 0);
    }

    onProgress(1);
    return this;
  }

  // ------------------------------------------------------------------ areas

  get heightAt() {
    return this.area === 'guild'
      ? (x, z) => INTERIOR_ORIGIN[1]
      : terrainHeight;
  }

  /** Ground height at a point, honouring the current area. */
  groundAt(x, z) {
    return this.area === 'guild' ? INTERIOR_ORIGIN[1] : terrainHeight(x, z);
  }

  enterGuild() {
    this.area = 'guild';
    // the hall is sealed, but tile gaps would otherwise show the pale sky
    // through the ceiling; a dark backdrop keeps them invisible
    if (!this._bgActive) {
      this._bgActive = true;
      this._bgSaved = this.scene.background;
      this.scene.background = new THREE.Color(0x2a2118);
    }
    this.colliders = this.interiorColliders;
    this.sky.visible = false;
    this.sunSprite.visible = false;
    this.ground.visible = false;
    for (const m of this.city.meshes) m.visible = false;
    for (const m of this.biomes.meshes) m.visible = false;
    this._chunksDirty = true;
    this.setInteriorLighting(true);
  }

  exitGuild() {
    this.area = 'world';
    if (this._bgActive) {
      this._bgActive = false;
      this.scene.background = this._bgSaved;
      this._bgSaved = undefined;
    }
    this.colliders = this.worldColliders;
    this.sky.visible = true;
    this.sunSprite.visible = true;
    this.ground.visible = true;
    this.setInteriorLighting(false);
    // visibility is restored by the first update tick; mark the cache stale so
    // the culler re-applies it even if the player has not moved
    this._chunksDirty = true;
    this._chunkTimer = 0;
  }

  setInteriorLighting(inside) {
    this.sun.intensity = inside ? 0.35 : 3.0;
    this.hemi.intensity = inside ? 0.28 : 0.62;
    this.fill.intensity = inside ? 0.1 : 0.5;
    // the hall is lit by its lamps; a sun shadow pass indoors only costs a
    // depth-program compile and a full shadow render for no visible gain
    this.sun.castShadow = !inside;
    // hidden lamps also drop out of the shader entirely: point lights are
    // per-fragment work for every material in the scene, even far away
    for (const l of this.guild.lights) l.visible = inside;
  }

  /** Where the player lands when entering / leaving the guild. */
  get guildEntryPoint() {
    const [ox, oy, oz] = INTERIOR_ORIGIN;
    return new THREE.Vector3(ox, oy, oz + this.guild.bounds.halfD - 4.5);
  }

  get guildExitTrigger() {
    const [ox, oy, oz] = INTERIOR_ORIGIN;
    return new THREE.Vector3(ox, oy, oz + this.guild.bounds.halfD - 1.2);
  }

  // ----------------------------------------------------------------- update

  update(dt, rawDt, playerPos, camera) {
    // keep the sky centred on the viewer
    this.sky.position.copy(camera.position);
    this.sunSprite.position.copy(camera.position).addScaledVector(SUN_DIR, 330);

    // shadow frustum follows the player so shadows work anywhere in the world
    this.sun.position.copy(playerPos).addScaledVector(SUN_DIR, 90);
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();

    this._updateAtmosphere(dt, playerPos);

    // chunk visibility only needs rechecking a few times a second
    this._chunkTimer -= dt;
    if (this._chunkTimer <= 0) {
      this._chunkTimer = 0.45;
      this._updateChunks(playerPos, false);
    }
  }

  /**
   * Distance culling by chunk. The city and each biome are separate mesh
   * groups, so a region more than `drawDistance` away can be switched off
   * wholesale — in a mission region that hides the other two biomes (and
   * most of their triangles) without touching what is in front of the player.
   * Frustum culling still runs per instanced sector on top of this.
   */
  _updateChunks(playerPos, force) {
    if (this.area === 'guild') return;

    const moved = force || this._chunksDirty
      || Math.hypot(playerPos.x - this._chunkPos.x, playerPos.z - this._chunkPos.z) > 12;
    const d = this.drawDistance;

    // biome groups: distance to the ring, not to its centre
    for (const region of this.biomes.regions) {
      const dist = Math.hypot(playerPos.x - region.center[0], playerPos.z - region.center[1]) - region.radius;
      const visible = dist < d;
      if (moved || region._visible !== visible) {
        region._visible = visible;
        for (const m of region.meshes) m.visible = visible;
      }
    }

    // the city is a disc of small sectors; gate the whole disc, then cull each
    // street chunk beyond the draw distance (biome sectors are too coarse for
    // that, which is what the region gate above is for)
    const cityDist = Math.hypot(playerPos.x, playerPos.z) - CITY.radius;
    const cityVisible = cityDist < d;
    if (moved || this._cityVisible !== cityVisible) {
      this._cityVisible = cityVisible;
      for (const m of this.city.meshes) {
        if (!cityVisible) { m.visible = false; continue; }
        const s = m.boundingSphere;
        m.visible = !s
          || Math.hypot(s.center.x - playerPos.x, s.center.z - playerPos.z) - s.radius < d;
      }
    }

    this._chunkPos.copy(playerPos);
    this._chunksDirty = false;
  }

  /**
   * Thinning factors for biome scatter. The instanced meshes stay as they are;
   * we only shorten the draw range, which is free and drops real triangles.
   * The nature kit's grass tufts are ~600 triangles each and make up most of a
   * biome's triangle count, so ground cover gets its own, much harder factor.
   */
  setDetail(scale, groundScale = scale) {
    this.detailScale = scale;
    const ground = /Grass|Clover|Flower|Petal|Mushroom|Pebble|Fern|Plant|Bush/i;
    for (const m of this.biomes.meshes) {
      if (!m.isInstancedMesh) continue;
      const full = m.userData.fullCount ?? m.count;
      const factor = ground.test(m.name) ? groundScale : scale;
      m.count = Math.max(1, Math.floor(full * factor));
    }
  }

  _updateAtmosphere(dt, playerPos) {
    if (this.area === 'guild') {
      this._targetFog.setHex(0x2a2118);
      this._targetTint.setHex(0xffffff);
      this._targetDensity = 0.012;
    } else {
      const weights = biomeWeights(playerPos.x, playerPos.z);
      const inCity = Math.hypot(playerPos.x, playerPos.z) < CITY.wallRadius;
      const key = inCity ? 'city' : (weights.length
        ? weights.reduce((a, b) => (b[1] > a[1] ? b : a))[0].biome
        : 'grassland');
      const look = SKY_TINTS[key] || SKY_TINTS.grassland;
      this._targetFog.setHex(look.fog);
      this._targetTint.setHex(look.tint);
      this._targetDensity = look.density;
    }

    const k = Math.min(1, dt * 1.1);
    this.scene.fog.color.lerp(this._targetFog, k);
    this.scene.fog.density += (this._targetDensity - this.scene.fog.density) * k;
    this.sky.material.color.lerp(this._targetTint, k);
  }

  /** Region the player is currently in, or null. */
  regionAt(x, z) {
    return regionAt(x, z);
  }

  /** Keep an actor on the map. The interior is bounded by its own walls. */
  clampToWorld(p, margin = 0) {
    if (this.area === 'guild') {
      const [ox, , oz] = INTERIOR_ORIGIN;
      const { halfW, halfD } = this.guild.bounds;
      // only actors actually in the room belong to it; anything still out in
      // the world must not be teleported indoors by the interior clamp
      if (Math.abs(p.x - ox) > halfW * 2.5 || Math.abs(p.z - oz) > halfD * 2.5) return;
      p.x = THREE.MathUtils.clamp(p.x, ox - halfW + 1 + margin, ox + halfW - 1 - margin);
      p.z = THREE.MathUtils.clamp(p.z, oz - halfD + 1 + margin, oz + halfD - 1 - margin);
      return;
    }
    const r = Math.hypot(p.x, p.z);
    const max = 300 - margin;
    if (r > max) {
      const s = max / r;
      p.x *= s;
      p.z *= s;
    }
  }
}

// --------------------------------------------------------------------- sky

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, '#2c4f77');
  g.addColorStop(0.28, '#5b83a8');
  g.addColorStop(0.52, '#a8b7ad');
  g.addColorStop(0.62, '#f2d3a2');
  g.addColorStop(0.70, '#d8bd93');
  g.addColorStop(1.00, '#8e8567');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeSunTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,244,214,1)');
  g.addColorStop(0.12, 'rgba(255,226,170,0.85)');
  g.addColorStop(0.35, 'rgba(255,196,120,0.28)');
  g.addColorStop(1.0, 'rgba(255,180,90,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Bake an environment map from the sky dome so metals have something to
 * reflect — without it the sword and every metal-trimmed surface renders black.
 */
function buildEnvironment(renderer, skyMesh) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const sky = skyMesh.clone();
  sky.position.set(0, 0, 0);
  sky.visible = true;
  envScene.add(sky);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(400, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x53612f }),
  );
  floor.position.y = -2;
  envScene.add(floor);

  const target = pmrem.fromScene(envScene, 0.02, 0.1, 1200);
  pmrem.dispose();
  return target.texture;
}
