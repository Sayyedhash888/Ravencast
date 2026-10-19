import * as THREE from 'three';

/**
 * All the juice: sparks, gore, slash arcs, ground shockwaves and floating
 * damage numbers.
 *
 * Particles live in one pooled buffer and are advanced on the CPU — with a few
 * hundred alive at once that is far cheaper than a draw call per burst.
 */

const PARTICLE_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = dot(d, d) * 4.0;
    if (r > 1.0) discard;
    float a = pow(1.0 - r, 1.6) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

class ParticlePool {
  constructor(scene, max = 1400) {
    this.max = max;
    this.count = 0;

    this.position = new Float32Array(max * 3);
    this.color = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);

    // cpu-only state
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, { life = 0.5, size = 0.12, color = 0xffd9a0, gravity = 9, drag = 2.5 } = {}) {
    // recycle the oldest slot when full
    const i = this.count < this.max ? this.count++ : (this._recycle = ((this._recycle || 0) + 1) % this.max);

    const i3 = i * 3;
    this.position[i3] = x;
    this.position[i3 + 1] = y;
    this.position[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;

    const c = new THREE.Color(color);
    this.color[i3] = c.r;
    this.color[i3 + 1] = c.g;
    this.color[i3 + 2] = c.b;

    this.baseSize[i] = size;
    this.size[i] = size;
    this.alpha[i] = 1;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;

    this.geometry.setDrawRange(0, this.count);
  }

  update(dt) {
    if (this.count === 0) return;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;

      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.gravity[i] * dt;
      this.vel[i3 + 2] *= d;

      this.position[i3] += this.vel[i3] * dt;
      this.position[i3 + 1] += this.vel[i3 + 1] * dt;
      this.position[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * t;
      this.size[i] = this.baseSize[i] * (0.45 + t * 0.75);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- textures

function crescentTexture() {
  const w = 256;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');

  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.42, 'rgba(255,255,255,1)');
  v.addColorStop(0.58, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  // taper the ends so it reads as a swing rather than a bar
  ctx.globalCompositeOperation = 'destination-in';
  const hgrad = ctx.createLinearGradient(0, 0, w, 0);
  hgrad.addColorStop(0.0, 'rgba(255,255,255,0)');
  hgrad.addColorStop(0.16, 'rgba(255,255,255,0.9)');
  hgrad.addColorStop(0.5, 'rgba(255,255,255,1)');
  hgrad.addColorStop(0.86, 'rgba(255,255,255,0.75)');
  hgrad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = hgrad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.95)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ----------------------------------------------------------------- effects

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.particles = new ParticlePool(scene, 1600);

    this.crescentTex = crescentTexture();
    this.ringTex = ringTexture();

    this.arcs = [];
    this.rings = [];
    this._buildArcPool(6);
    this._buildRingPool(10);

    this.floaters = [];
    this.floaterHost = document.getElementById('floaters');
    this._floaterPool = [];
    this._projected = new THREE.Vector3();

    this.flashEl = document.getElementById('flash');
    this.flash = 0;

    /** Particle-count scale set by the graphics preset (1 = full). */
    this.density = 1;
  }

  /** Scale a burst size by the graphics preset, never below one particle. */
  _count(n) {
    return Math.max(1, Math.round(n * this.density));
  }

  _buildArcPool(n) {
    const geo = new THREE.PlaneGeometry(2.9, 1.05);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.crescentTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, 0, 1.25);
      group.add(mesh);
      group.visible = false;
      this.scene.add(group);
      this.arcs.push({ group, mesh, mat, t: 1, duration: 0.22 });
    }
  }

  _buildRingPool(n) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.ringTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, t: 1, duration: 0.45, size: 3 });
    }
  }

  // ------------------------------------------------------------- spawners

  /** Sparks + gore at an impact point, thrown away from `dirX/dirZ`. */
  impact(x, y, z, dirX, dirZ, { heavy = false, color = 0xffd08a } = {}) {
    const n = this._count(heavy ? 26 : 14);
    for (let i = 0; i < n; i++) {
      const spread = 0.55;
      const vx = dirX * (1.4 + Math.random() * 2.6) + (Math.random() - 0.5) * spread * 3;
      const vy = 1.2 + Math.random() * 2.8;
      const vz = dirZ * (1.4 + Math.random() * 2.6) + (Math.random() - 0.5) * spread * 3;
      this.particles.spawn(x, y, z, vx, vy, vz, {
        life: 0.28 + Math.random() * 0.3,
        size: heavy ? 0.14 : 0.1,
        color,
        gravity: 11,
        drag: 2.2,
      });
    }
    this.shockwave(x, 0.06, z, heavy ? 2.6 : 1.6, color);
  }

  /** Dark ichor spray for a wounded monster. */
  gore(x, y, z, dirX, dirZ, color = 0x6d2b3a) {
    for (let i = 0; i < this._count(16); i++) {
      this.particles.spawn(
        x, y, z,
        dirX * (0.8 + Math.random() * 2.2) + (Math.random() - 0.5) * 2,
        0.8 + Math.random() * 2.4,
        dirZ * (0.8 + Math.random() * 2.2) + (Math.random() - 0.5) * 2,
        { life: 0.4 + Math.random() * 0.35, size: 0.13, color, gravity: 13, drag: 1.6 },
      );
    }
  }

  /** Dissolve puff when something dies. */
  dissipate(x, y, z, color = 0x8a6b9a, scale = 1) {
    for (let i = 0; i < this._count(30); i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.7 * scale;
      this.particles.spawn(
        x + Math.cos(a) * r, y + Math.random() * 1.2 * scale, z + Math.sin(a) * r,
        Math.cos(a) * 0.7, 0.9 + Math.random() * 1.4, Math.sin(a) * 0.7,
        { life: 0.6 + Math.random() * 0.5, size: 0.2 * scale, color, gravity: -1.2, drag: 1.1 },
      );
    }
    this.shockwave(x, 0.05, z, 3.2 * scale, color);
  }

  /** Dust kicked up by footsteps / dodges. */
  dust(x, y, z, amount = 6, color = 0xb9a884) {
    for (let i = 0; i < this._count(amount); i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.spawn(
        x + Math.cos(a) * 0.25, y + 0.06, z + Math.sin(a) * 0.25,
        Math.cos(a) * 0.8, 0.5 + Math.random() * 0.8, Math.sin(a) * 0.8,
        { life: 0.35 + Math.random() * 0.3, size: 0.16, color, gravity: -0.4, drag: 2.6 },
      );
    }
  }

  /** Sword trail arc, anchored to an actor's yaw. */
  slash(x, y, z, yaw, { scale = 1, duration = 0.22, tilt = 0 } = {}) {
    const arc = this.arcs.find((a) => a.t >= 1) || this.arcs[0];
    arc.group.position.set(x, y, z);
    arc.group.rotation.set(0, yaw, 0);
    arc.mesh.rotation.z = tilt;
    arc.baseScale = scale;
    arc.group.scale.setScalar(scale);
    arc.t = 0;
    arc.duration = duration;
    arc.group.visible = true;
  }

  shockwave(x, y, z, size = 2, color = 0xffffff) {
    const ring = this.rings.find((r) => r.t >= 1) || this.rings[0];
    ring.mesh.position.set(x, y, z);
    ring.size = size;
    ring.t = 0;
    ring.mat.color.set(color);
    ring.mesh.visible = true;
  }

  /** Short white screen flash, used for heavy impacts and player damage. */
  screenFlash(amount = 0.35) {
    this.flash = Math.max(this.flash, amount);
  }

  /** Floating damage number anchored to a world position. */
  number(worldPos, text, kind = 'enemy') {
    let entry = this._floaterPool.find((f) => !f.active);
    if (!entry) {
      if (this._floaterPool.length > 44) return;
      const el = document.createElement('div');
      this.floaterHost.appendChild(el);
      entry = { el, active: false, life: 0, maxLife: 1, pos: new THREE.Vector3(), drift: 0 };
      this._floaterPool.push(entry);
    }
    entry.el.className = `floater ${kind}`;
    entry.el.textContent = text;
    entry.pos.copy(worldPos);
    entry.life = 0;
    entry.maxLife = kind === 'crit' ? 1.15 : 0.95;
    entry.drift = (Math.random() - 0.5) * 40;
    entry.active = true;
    entry.el.style.opacity = '1';
  }

  // --------------------------------------------------------------- update

  update(dt, rawDt) {
    this.particles.update(dt);

    for (const arc of this.arcs) {
      if (arc.t >= 1) { arc.group.visible = false; continue; }
      arc.t = Math.min(1, arc.t + rawDt / arc.duration);
      const e = 1 - Math.pow(1 - arc.t, 3);
      arc.mat.opacity = Math.sin(arc.t * Math.PI) * 0.95;
      arc.group.scale.setScalar((arc.baseScale ?? 1) * (0.72 + e * 0.5));
    }

    for (const ring of this.rings) {
      if (ring.t >= 1) { ring.mesh.visible = false; continue; }
      ring.t = Math.min(1, ring.t + rawDt / ring.duration);
      const s = ring.size * (0.35 + ring.t * 0.9);
      ring.mesh.scale.set(s, 1, s);
      ring.mat.opacity = (1 - ring.t) * 0.7;
    }

    this._updateFloaters(dt);

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - rawDt * 2.6);
      this.flashEl.style.opacity = String(this.flash);
    }
  }

  _updateFloaters(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const f of this._floaterPool) {
      if (!f.active) continue;
      f.life += dt;
      if (f.life >= f.maxLife) {
        f.active = false;
        f.el.style.opacity = '0';
        continue;
      }
      const t = f.life / f.maxLife;
      this._projected.copy(f.pos);
      this._projected.y += 0.45 + t * 1.15;
      this._projected.project(this.camera);

      if (this._projected.z > 1) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = (this._projected.x * 0.5 + 0.5) * w + f.drift * t;
      const y = (-this._projected.y * 0.5 + 0.5) * h;
      f.el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      f.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }

  clearFloaters() {
    for (const f of this._floaterPool) {
      f.active = false;
      f.el.style.opacity = '0';
    }
  }
}
