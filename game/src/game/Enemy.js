import * as THREE from 'three';
import { Character } from './Character.js';
import { computeFacingOffset, measureHeight } from './Assets.js';

/**
 * Monsters. None of the bestiary exports ship their own animation, so every
 * state is driven by clips from the Universal Animation Library retargeted by
 * bone name — `Zombie_Scratch` for a claw swipe, `Death01` for the fall.
 *
 * AI is a small explicit state machine: spawn -> chase -> windup -> strike ->
 * recover, with hurt and dead interrupts.
 */

export const ENEMY_TYPES = {
  imp: {
    id: 'imp',
    label: 'Imp',
    model: 'imp',
    health: 44,
    speed: 4.9,
    damage: 9,
    scale: 1.0,
    mass: 1.0,
    radius: 0.62,
    attackRange: 2.3,
    attackCooldown: 1.15,
    windup: 0.46,
    strike: 0.14,
    recover: 0.52,
    turnSpeed: 8,
    knockback: 1.0,
    score: 100,
    gore: 0x7a2f4a,
    deathColor: 0x9a5a7a,
    clip: {
      idle: ['UAL2', 'Zombie_Idle_Loop'],
      walk: ['UAL2', 'Zombie_Walk_Fwd_Loop'],
      attack: ['UAL2', 'Zombie_Scratch'],
      hurt: ['UAL1', 'Hit_Chest'],
      death: ['UAL1', 'Death01'],
    },
    walkRate: 1.5,
  },

  puglin: {
    id: 'puglin',
    label: 'Puglin',
    model: 'puglin',
    health: 108,
    speed: 3.1,
    damage: 17,
    scale: 1.0,
    mass: 2.6,
    radius: 0.72,
    attackRange: 2.4,
    attackCooldown: 1.9,
    windup: 0.62,
    strike: 0.16,
    recover: 0.85,
    turnSpeed: 4.6,
    knockback: 0.42,
    score: 240,
    gore: 0x5d6b2a,
    deathColor: 0x86a04a,
    clip: {
      idle: ['UAL1', 'Idle_Loop'],
      walk: ['UAL1', 'Jog_Fwd_Loop'],
      attack: ['UAL1', 'Punch_Cross'],
      hurt: ['UAL1', 'Hit_Head'],
      death: ['UAL1', 'Death01'],
    },
    walkRate: 1.15,
  },

  warden: {
    id: 'warden',
    label: 'Glade Warden',
    model: 'imp',
    health: 420,
    speed: 3.9,
    damage: 27,
    scale: 2.1,
    mass: 9,
    radius: 1.35,
    attackRange: 4.0,
    attackCooldown: 2.3,
    windup: 0.78,
    strike: 0.2,
    recover: 1.0,
    turnSpeed: 3.2,
    knockback: 0.1,
    score: 1500,
    boss: true,
    gore: 0x8a2f3a,
    deathColor: 0xc06a5a,
    clip: {
      idle: ['UAL2', 'Zombie_Idle_Loop'],
      walk: ['UAL1', 'Sprint_Loop'],
      attack: ['UAL2', 'Sword_Heavy_Combo'],
      hurt: ['UAL2', 'Hit_Knockback'],
      death: ['UAL1', 'Death01'],
    },
    walkRate: 0.85,
  },
};

const STATE = {
  SPAWN: 'spawn',
  IDLE: 'idle',
  CHASE: 'chase',
  WINDUP: 'windup',
  STRIKE: 'strike',
  RECOVER: 'recover',
  HURT: 'hurt',
  DEAD: 'dead',
};

export class Enemy extends Character {
  constructor({ assets, world, game, type }) {
    const def = ENEMY_TYPES[type];
    const model = assets.instantiate(def.model);
    super({
      model,
      assets,
      facingOffset: computeFacingOffset(model),
      height: measureHeight(model).height,
    });

    this.def = def;
    this.type = type;
    this.world = world;
    this.game = game;
    this.effects = game.effects;
    this.audio = game.audio;

    this.root.scale.setScalar(def.scale);

    this.materials = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!this.materials.includes(m)) {
          this.materials.push(m);
          m.userData.baseEmissive = m.emissive ? m.emissive.clone() : new THREE.Color(0, 0, 0);
          m.userData.baseEmissiveIntensity = m.emissiveIntensity ?? 1;
        }
      }
    });

    this.velocity = new THREE.Vector3();
    this.impulse = new THREE.Vector3();
    this.wander = Math.random() * Math.PI * 2;
    this.maxHealth = def.health;
    this.active = false;
  }

  get radius() { return this.def.radius; }
  get healthFraction() { return this.health / (this.maxHealth || this.def.health); }
  get attackRange() { return this.def.attackRange; }

  spawn(x, z) {
    const d = this.def;
    this.maxHealth = d.health;
    this.health = this.maxHealth;
    this.state = STATE.SPAWN;
    this.stateTime = 0;
    this.cooldown = 0.35 + Math.random() * 0.5;
    this.flash = 0;
    this.deathTimer = 0;
    this.velocity.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
    this.wander = Math.random() * Math.PI * 2;
    this.active = true;

    this.root.position.set(x, this.world.groundAt(x, z), z);
    this.root.rotation.y = Math.atan2(-x, -z); // face the middle of the glade
    this.root.visible = true;
    this.setOpacity(1);
    this.setEmissive(0);

    const clip = this.assets.clip(...d.clip.idle);
    this.play('idle', { clip, fade: 0.2, restart: true, speed: 1 });
    this.effects.dust(x, this.root.position.y, z, 12, d.deathColor);
  }

  despawn() {
    this.active = false;
    this.root.visible = false;
  }

  setOpacity(v) {
    for (const m of this.materials) {
      m.transparent = v < 0.999;
      m.opacity = v;
      m.depthWrite = v > 0.5;
    }
  }

  setEmissive(amount) {
    for (const m of this.materials) {
      if (!m.emissive) continue;
      const base = m.userData.baseEmissive;
      m.emissive.setRGB(
        base.r + (1.0 - base.r) * amount,
        base.g + (0.72 - base.g) * amount,
        base.b + (0.35 - base.b) * amount,
      );
      m.emissiveIntensity = m.userData.baseEmissiveIntensity + amount * 2.2;
    }
  }

  // --------------------------------------------------------------- damage

  takeDamage(amount, sourceX, sourceZ, knockback = 2, isCrit = false) {
    if (!this.active || this.state === STATE.DEAD || this.state === STATE.SPAWN) return false;

    this.health -= amount;
    this.flash = 1;
    this.setEmissive(0.9);

    const dx = this.root.position.x - sourceX;
    const dz = this.root.position.z - sourceZ;
    const len = Math.hypot(dx, dz) || 1;
    const push = (knockback / this.def.mass) * this.def.knockback;
    this.impulse.x += (dx / len) * push;
    this.impulse.z += (dz / len) * push;

    this.effects.gore(
      this.root.position.x + (dx / len) * 0.4,
      this.root.position.y + this.height * 0.55 * this.def.scale,
      this.root.position.z + (dz / len) * 0.4,
      dx / len, dz / len,
      this.def.gore,
    );

    if (this.health <= 0) {
      this._die(sourceX, sourceZ);
      return true;
    }

    // bosses shrug off staggers
    if (this.def.boss || Math.random() < 0.35) return true;

    this.state = STATE.HURT;
    this.stateTime = 0;
    this.hurtDuration = 0.34;
    const clip = this.assets.clip(...this.def.clip.hurt);
    this.play('hurt', { clip, fade: 0.06, loop: false, speed: 1.5, restart: true });
    return true;
  }

  _die(sourceX, sourceZ) {
    this.state = STATE.DEAD;
    this.stateTime = 0;
    this.deathTimer = 0;
    this.velocity.set(0, 0, 0);

    const dx = this.root.position.x - sourceX;
    const dz = this.root.position.z - sourceZ;
    const len = Math.hypot(dx, dz) || 1;
    this.impulse.x += (dx / len) * (4.5 / this.def.mass);
    this.impulse.z += (dz / len) * (4.5 / this.def.mass);

    const clip = this.assets.clip(...this.def.clip.death);
    this.play('death', { clip, fade: 0.1, loop: false, speed: this.def.boss ? 0.8 : 1.1, restart: true });

    this.effects.dissipate(
      this.root.position.x,
      this.root.position.y + this.height * 0.4,
      this.root.position.z,
      this.def.deathColor,
      this.def.scale,
    );
    this.audio.enemyDeath(!!this.def.boss);
  }

  // --------------------------------------------------------------- update

  update(dt) {
    if (!this.active) return;

    this.stateTime += dt;
    // hit flash: ramp back down, and make sure we land exactly on the base
    // emissive once it expires
    const wasFlashing = this.flash > 0;
    this.flash = Math.max(0, this.flash - dt * 7);
    if (wasFlashing || this.flash > 0) this.setEmissive(this.flash * 0.9);

    if (this.state === STATE.DEAD) {
      this.deathTimer += dt;
      this._applyPhysics(dt, 0.6);
      // sink into the ground as the corpse fades
      if (this.deathTimer > 0.9) {
        const t = Math.min(1, (this.deathTimer - 0.9) / 1.3);
        this.setOpacity(1 - t);
        this.root.position.y -= dt * 0.35 * this.def.scale;
        if (t >= 1) {
          this.despawn();
          this.game.onEnemyRemoved(this);
        }
      }
      super.update(dt);
      return;
    }

    if (this.state === STATE.SPAWN) {
      if (this.stateTime >= 0.55) {
        this.state = STATE.CHASE;
        this.stateTime = 0;
      }
      this._applyPhysics(dt, 0.2);
      super.update(dt);
      return;
    }

    const player = this.game.player;
    const px = player.root.position.x;
    const pz = player.root.position.z;
    const dx = px - this.root.position.x;
    const dz = pz - this.root.position.z;
    const dist = Math.hypot(dx, dz);

    this.cooldown = Math.max(0, this.cooldown - dt);

    switch (this.state) {
      case STATE.HURT:
        if (this.stateTime >= (this.hurtDuration ?? 0.34)) {
          this.state = STATE.CHASE;
          this.stateTime = 0;
        }
        this._steer(dt, 0);
        break;

      case STATE.WINDUP:
        this.setEmissive(Math.min(0.85, 0.35 + Math.sin(this.stateTime * 26) * 0.35));
        this._steer(dt, 0.15);
        if (this.stateTime >= this.def.windup) {
          this.state = STATE.STRIKE;
          this.stateTime = 0;
          this._strike();
        }
        break;

      case STATE.STRIKE:
        this._steer(dt, 0.1);
        if (this.stateTime >= this.def.strike) {
          this.state = STATE.RECOVER;
          this.stateTime = 0;
        }
        break;

      case STATE.RECOVER:
        this._steer(dt, 0.35);
        if (this.stateTime >= this.def.recover) {
          this.state = STATE.CHASE;
          this.stateTime = 0;
        }
        break;

      default: {
        // chase / idle: close the gap, then attack
        if (dist <= this.attackRange && this.cooldown <= 0 && player.canAct !== false && !player.dead) {
          this.state = STATE.WINDUP;
          this.stateTime = 0;
          const clip = this.assets.clip(...this.def.clip.attack);
          this.play('attack', { clip, fade: 0.1, loop: false, speed: 1 / Math.max(0.35, this.def.windup + this.def.strike) * 0.55 + 0.6, restart: true });
          this.audio.swing(0.7);
        } else {
          this.state = STATE.CHASE;
          this._steer(dt, dist > this.attackRange ? 1 : 0.25);
        }
      }
    }

    // face the player while engaged
    if (dist > 0.01) this.turnToward(dx, dz, this.def.turnSpeed * dt);

    this._animate(dt, dist);
    super.update(dt);
  }

  /** Move toward the player, keeping clear of neighbours. */
  _steer(dt, throttle) {
    const player = this.game.player;
    const px = player.root.position.x;
    const pz = player.root.position.z;

    let dirX = px - this.root.position.x;
    let dirZ = pz - this.root.position.z;
    const dist = Math.hypot(dirX, dirZ) || 1;
    dirX /= dist;
    dirZ /= dist;

    // separation so packs do not merge into one silhouette
    let sepX = 0;
    let sepZ = 0;
    const others = this.game.enemies;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === this || !o.active || o.state === STATE.DEAD) continue;
      const ox = this.root.position.x - o.root.position.x;
      const oz = this.root.position.z - o.root.position.z;
      const d2 = ox * ox + oz * oz;
      const minD = (this.radius + o.radius) * 1.35;
      if (d2 < minD * minD && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        const w = (1 - d / minD) * 1.6;
        sepX += (ox / d) * w;
        sepZ += (oz / d) * w;
      }
    }

    // stand-off: stop crowding into the player's centre
    const stopAt = this.attackRange * 0.72;
    if (dist < stopAt) {
      const back = (stopAt - dist) / stopAt;
      dirX -= dirX * back * 1.4;
      dirZ -= dirZ * back * 1.4;
    }

    let wishX = dirX * throttle + sepX;
    let wishZ = dirZ * throttle + sepZ;
    const len = Math.hypot(wishX, wishZ);
    if (len > 1e-4) {
      wishX /= len;
      wishZ /= len;
      const speed = this.def.speed * Math.min(1, len);
      const a = Math.min(1, 14 * dt);
      this.velocity.x += (wishX * speed - this.velocity.x) * a;
      this.velocity.z += (wishZ * speed - this.velocity.z) * a;
    } else {
      this.velocity.x -= this.velocity.x * Math.min(1, 10 * dt);
      this.velocity.z -= this.velocity.z * Math.min(1, 10 * dt);
    }

    this._applyPhysics(dt, 1);
  }

  _strike() {
    const player = this.game.player;
    const px = player.root.position.x;
    const pz = player.root.position.z;
    const dx = px - this.root.position.x;
    const dz = pz - this.root.position.z;
    const dist = Math.hypot(dx, dz);

    this.cooldown = this.def.attackCooldown * (0.85 + Math.random() * 0.35);

    const reach = this.attackRange + 0.7;
    if (dist > reach) return;

    // must be roughly in front
    const facing = this.root.rotation.y;
    const toPlayer = Math.atan2(dx, dz);
    let diff = toPlayer - facing;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > 1.5) return;

    const hitX = this.root.position.x + (dx / (dist || 1)) * this.radius;
    const hitZ = this.root.position.z + (dz / (dist || 1)) * this.radius;
    const blocked = player.takeDamage(this.def.damage, this.root.position.x, this.root.position.z);

    if (!blocked) {
      // dodged — show the miss so the player can read it
      this.effects.dust(hitX, this.world.groundAt(hitX, hitZ), hitZ, 6);
    }
  }

  _applyPhysics(dt, controlScale) {
    const p = this.root.position;
    p.x += (this.velocity.x + this.impulse.x) * dt * controlScale;
    p.z += (this.velocity.z + this.impulse.z) * dt * controlScale;

    const decay = Math.max(0, 1 - 6 * dt);
    this.impulse.x *= decay;
    this.impulse.z *= decay;

    this.world.colliders.resolve(p, this.radius);
    this.world.clampToWorld(p, this.radius);
    p.y = this.world.groundAt(p.x, p.z);
  }

  _animate(dt, dist) {
    const d = this.def;
    if (this.state === STATE.WINDUP || this.state === STATE.STRIKE || this.state === STATE.RECOVER) return;

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.state === STATE.HURT) return;

    if (speed > 0.35) {
      const clip = this.assets.clip(...d.clip.walk);
      const rate = THREE.MathUtils.clamp(speed / d.speed, 0.6, 1.4) * d.walkRate;
      this.play('walk', { clip, fade: 0.24, sync: true, speed: rate });
    } else {
      const clip = this.assets.clip(...d.clip.idle);
      this.play('idle', { clip, fade: 0.3 });
    }
  }
}
