import * as THREE from 'three';

/**
 * Static world collision.
 *
 * Props and trees are fine as circles, but buildings are rotated rectangles —
 * approximating a 4x12 m house with a circle either lets the player walk
 * through the ends or shoves them off the sides. So both shapes are supported
 * and everything that moves resolves against the same set.
 */

const _clamp = THREE.MathUtils.clamp;

export class ColliderSet {
  constructor() {
    this.circles = [];
    this.boxes = [];
    /** Everything, for the camera probe and coarse queries. */
    this.all = [];
  }

  addCircle(x, z, r) {
    const c = { type: 0, x, z, r };
    this.circles.push(c);
    this.all.push(c);
    return c;
  }

  /** Oriented rectangle: half-width along local X, half-depth along local Z. */
  addBox(x, z, hw, hd, yaw = 0) {
    const b = { type: 1, x, z, hw, hd, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw) };
    this.boxes.push(b);
    this.all.push(b);
    return b;
  }

  get length() { return this.all.length; }

  /**
   * Push a point (with the given radius) out of anything it overlaps.
   * Mutates and returns `p`. Runs in place rather than iterating to a fixed
   * point — one pass per frame is enough at these speeds.
   */
  resolve(p, radius) {
    const circles = this.circles;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 < 1e-8) {
        // dead centre: pick an arbitrary direction rather than dividing by zero
        p.x = c.x + min;
        continue;
      }
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }

    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      resolveBox(p, radius, boxes[i]);
    }
    return p;
  }

  /** Would a point of the given radius overlap anything? For camera probing. */
  blocked(x, z, radius = 0.35) {
    for (let i = 0; i < this.circles.length; i++) {
      const c = this.circles[i];
      const dx = x - c.x;
      const dz = z - c.z;
      const min = c.r + radius;
      if (dx * dx + dz * dz < min * min) return true;
    }
    for (let i = 0; i < this.boxes.length; i++) {
      if (boxOverlaps(this.boxes[i], x, z, radius)) return true;
    }
    return false;
  }
}

function boxOverlaps(b, x, z, radius) {
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * b.cos - dz * b.sin;
  const lz = dx * b.sin + dz * b.cos;
  const cx = _clamp(lx, -b.hw, b.hw);
  const cz = _clamp(lz, -b.hd, b.hd);
  const px = lx - cx;
  const pz = lz - cz;
  return px * px + pz * pz < radius * radius;
}

function resolveBox(p, radius, b) {
  const dx = p.x - b.x;
  const dz = p.z - b.z;

  // into the box's local frame (yaw about Y)
  const lx = dx * b.cos - dz * b.sin;
  const lz = dx * b.sin + dz * b.cos;

  const cx = _clamp(lx, -b.hw, b.hw);
  const cz = _clamp(lz, -b.hd, b.hd);
  let px = lx - cx;
  let pz = lz - cz;
  const d2 = px * px + pz * pz;

  let nx = lx;
  let nz = lz;

  if (d2 > 1e-9) {
    if (d2 >= radius * radius) return; // clear of it
    const d = Math.sqrt(d2);
    const push = radius - d;
    nx = lx + (px / d) * push;
    nz = lz + (pz / d) * push;
  } else {
    // centre is inside the rectangle: leave by the nearest face
    const ox = b.hw - Math.abs(lx);
    const oz = b.hd - Math.abs(lz);
    if (ox < oz) nx = Math.sign(lx || 1) * (b.hw + radius);
    else nz = Math.sign(lz || 1) * (b.hd + radius);
  }

  // back to world space
  p.x = b.x + nx * b.cos + nz * b.sin;
  p.z = b.z - nx * b.sin + nz * b.cos;
}
