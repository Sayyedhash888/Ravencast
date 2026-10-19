import * as THREE from 'three';

/**
 * Orbiting third-person camera with terrain/prop collision.
 *
 * The camera is described as a yaw/pitch/distance orbit around a follow point.
 * Instead of a physics raycast it walks the boom back toward the player in
 * steps, rejecting any position that ends up inside a collider or under the
 * forest floor — cheap, and stable with instanced geometry.
 */
export class CameraRig {
  constructor(camera, input, world) {
    this.camera = camera;
    this.input = input;
    this.world = world;

    this.yaw = 0;
    this.pitch = 0.26;
    this.distance = 5.4;
    this.baseDistance = 5.4;
    this.sprintDistance = 6.2;
    this.minDistance = 1.6;

    this.followHeight = 1.45;
    this.position = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._follow = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._probe = new THREE.Vector3();
    this._initialised = false;

    this.baseFov = camera.fov;
    this.fovKick = camera.fov;

    this.shoulder = 0.55;
  }

  /** Forward vector on the XZ plane — what "W" pushes against. */
  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Right vector on the XZ plane. */
  get right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  snapTo(targetPos) {
    this._follow.copy(targetPos);
    this._follow.y += this.followHeight;
    this._initialised = true;
    this._apply(1);
  }

  update(dt, targetPos, { sprinting = false, frozen = false } = {}) {
    if (!frozen) {
      const mouse = this.input.mouse;
      // drag right -> the view sweeps right, so the world slides left
      this.yaw -= mouse.dx;
      this.pitch += mouse.dy;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.30, 1.12);

      // zoom
      if (mouse.wheel !== 0) {
        this.baseDistance = THREE.MathUtils.clamp(this.baseDistance + mouse.wheel * 0.6, 3.0, 9.0);
      }
    }

    this._follow.copy(targetPos);
    this._follow.y += this.followHeight;
    if (!this._initialised) {
      this.position.copy(this._follow);
      this._initialised = true;
    }

    const targetDistance = sprinting ? this.sprintDistance : this.baseDistance;
    this.distance += (targetDistance - this.distance) * Math.min(1, dt * 3.2);

    const targetFov = this.baseFov + (sprinting ? 6 : 0);
    this.fovKick += (targetFov - this.fovKick) * Math.min(1, dt * 3);
    this.camera.fov = this.fovKick;
    this.camera.updateProjectionMatrix();

    this._apply(dt);
  }

  _apply(dt) {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const dir = this._desired.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();

    // right-hand shoulder offset so the player is not dead-centre
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let dist = this.distance;
    const smoothing = Math.min(1, dt * 12);

    // walk the boom in until the camera is clear of geometry
    for (let t = 1.0; t >= 0.18; t -= 0.06) {
      const d = this.distance * t;
      this._probe.copy(this._follow).addScaledVector(dir, d);
      this._probe.x += rightX * this.shoulder * t;
      this._probe.z += rightZ * this.shoulder * t;

      const floor = this.world.groundAt(this._probe.x, this._probe.z) + 0.7;
      if (this._probe.y < floor) continue;
      if (this.world.colliders.blocked(this._probe.x, this._probe.z, 0.45)) continue;

      dist = d;
      break;
    }
    dist = Math.max(this.minDistance, dist);

    this._probe.copy(this._follow).addScaledVector(dir, dist);
    this._probe.x += rightX * this.shoulder;
    this._probe.z += rightZ * this.shoulder;
    this._probe.y = Math.max(this._probe.y, this.world.groundAt(this._probe.x, this._probe.z) + 0.6);

    // the guild is a sealed room: keep the boom below the ceiling beams and
    // inside the walls, otherwise a high pitch puts the camera in the rafters
    if (this.world.area === 'guild' && this.world.guild) {
      const [ox, oy, oz] = this.world.origin;
      const { halfW, halfD, height } = this.world.guild.bounds;
      this._probe.y = Math.min(this._probe.y, oy + height - 0.85);
      this._probe.x = THREE.MathUtils.clamp(this._probe.x, ox - halfW + 0.7, ox + halfW - 0.7);
      this._probe.z = THREE.MathUtils.clamp(this._probe.z, oz - halfD + 0.7, oz + halfD - 0.7);
    }

    this.position.lerp(this._probe, smoothing);
    this.camera.position.copy(this.position);

    this.lookAt.copy(this._follow).addScaledVector(dir, -0.8);
    this.camera.lookAt(this.lookAt);
  }
}
