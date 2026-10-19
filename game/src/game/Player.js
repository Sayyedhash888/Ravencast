import * as THREE from 'three';
import { Character } from './Character.js';
import { computeFacingOffset, measureHeight } from './Assets.js';
import { attachSword, replaceSword, attachShield } from './Sword.js';
import { attachHead } from './Head.js';

/**
 * The ranger. Owns movement, the light-attack combo, the heavy strike, guard
 * and dodge, plus the stamina economy that ties them together.
 *
 * Animation states are timed off the clip's own duration (scaled by a playback
 * rate) rather than events, so attack windows stay in sync with what is on
 * screen even if a clip is swapped out.
 *
 * Damage is expressed as a multiplier on the player's current weapon damage,
 * so upgrading at the guild changes every swing without touching these tables.
 */

const COMBO = [
  { key: 'attack1', clip: ['UAL2', 'Sword_Regular_A'], damageScale: 1.00, speed: 1.45, hitStart: 0.30, hitEnd: 0.52, range: 2.6, arc: 1.9, knock: 2.0, cost: 7 },
  { key: 'attack2', clip: ['UAL2', 'Sword_Regular_B'], damageScale: 1.15, speed: 1.5, hitStart: 0.28, hitEnd: 0.50, range: 2.6, arc: 1.9, knock: 2.2, cost: 7 },
  { key: 'attack3', clip: ['UAL2', 'Sword_Regular_C'], damageScale: 1.70, speed: 1.35, hitStart: 0.32, hitEnd: 0.56, range: 2.9, arc: 2.5, knock: 4.2, cost: 9 },
];

const HEAVY = {
  key: 'heavy', clip: ['UAL2', 'Sword_Heavy_Combo'], damageScale: 2.15, speed: 1.1,
  hitStart: 0.38, hitEnd: 0.60, range: 3.2, arc: 3.0, knock: 7.0, cost: 22,
};

const DODGE = { key: 'dodge', clip: ['UAL1', 'Roll'], speed: 1.3, cost: 0, iframe: [0.04, 0.62], dash: 8.4 };

/** Stand-in input used while the game is showing a dialogue or a panel. */
const FROZEN_INPUT = {
  mouse: { left: false, right: false, leftPressed: false, dx: 0, dy: 0, wheel: 0 },
  isDown: () => false,
  wasPressed: () => false,
  moveAxis: () => ({ x: 0, y: 0 }),
};

const STATS = {
  walkSpeed: 4.9,
  sprintSpeed: 8.8,
  guardSpeed: 2.2,
  accel: 30,
  turnSpeed: 12,
  staminaRegen: 22,
  staminaDelay: 0.65,
  guardDrain: 13,
  hurtLock: 0.34,
  invulnAfterHit: 0.55,
};

export class Player extends Character {
  constructor({ assets, world, cameraRig, input, effects, audio, game, progression }) {
    // the outfit has no head of its own; the base character's head is grafted
    // on and the closed ranger hood is dropped so the face can show
    const model = assets.instantiate('ranger');
    attachHead(model, assets, { style: 'parted', hairColor: 0x4a3324 });
    super({
      model,
      assets,
      facingOffset: computeFacingOffset(model),
      height: measureHeight(model).height,
    });

    this.world = world;
    this.cameraRig = cameraRig;
    this.input = input;
    this.effects = effects;
    this.audio = audio;
    this.game = game;
    this.progression = progression;
    this.name = 'Ranger';

    this.clips = {
      idle: assets.clip('UAL1', 'Idle_Loop'),
      run: assets.clip('UAL1', 'Jog_Fwd_Loop'),
      sprint: assets.clip('UAL1', 'Sprint_Loop'),
      dodge: assets.clip('UAL1', DODGE.clip[1]),
      guard: assets.clip('UAL2', 'Sword_Block'),
      hurt: assets.clip('UAL1', 'Hit_Chest'),
      death: assets.clip('UAL1', 'Death01'),
      attack1: assets.clip('UAL2', COMBO[0].clip[1]),
      attack2: assets.clip('UAL2', COMBO[1].clip[1]),
      attack3: assets.clip('UAL2', COMBO[2].clip[1]),
      heavy: assets.clip('UAL2', HEAVY.clip[1]),
    };

    this.health = progression.maxHealth;
    this.stamina = progression.maxStamina;
    this.dead = false;

    this.state = 'idle';
    this.stateTime = 0;
    this.stateDuration = 0;
    this.velocity = new THREE.Vector3();
    this.impulse = new THREE.Vector3();

    this.comboIndex = 0;
    this.comboWindow = 0;
    this.bufferedAttack = false;
    this.activeAttack = null;
    this.hitThisSwing = new Set();

    this.invulnerable = 0;
    this.staminaLock = 0;
    this.sprinting = false;
    /** Set by double-tapping W; cleared when W is released or stamina runs out. */
    this.runLatch = false;
    this._wTap = 0;
    this.guarding = false;
    this.guardBroken = 0;
    this.lastStepPhase = 0;
    /** Set while a dialogue or panel owns the screen. */
    this.frozen = false;

    // every attack clip is a sword animation, so give the hand a sword
    this.sword = attachSword(model, progression.weaponDef);
    this.shield = null;

    this.root.position.set(0, world.groundAt(0, 0), 0);
  }

  get maxHealth() { return this.progression.maxHealth; }
  get maxStamina() { return this.progression.maxStamina; }
  get radius() { return 0.42; }
  get healthFraction() { return this.health / this.maxHealth; }
  get staminaFraction() { return this.stamina / this.maxStamina; }

  /** Input source, swapped for a dead one while the game is showing UI. */
  get activeInput() { return this.frozen ? FROZEN_INPUT : this.input; }

  /** Swap the blade after a guild purchase. */
  setWeapon(def) {
    this.sword = replaceSword(this.model, def);
  }

  /** Equip (or clear) a shield. `model` is a loaded shield mesh, or null. */
  setShield(shieldModel, def) {
    const hand = this.model.getObjectByName('hand_l');
    if (hand) {
      const old = hand.getObjectByName('shield');
      if (old) hand.remove(old);
    }
    this.shield = shieldModel && def ? attachShield(this.model, shieldModel, def) : null;
  }
  get isBusy() {
    return this.state === 'attack' || this.state === 'heavy' || this.state === 'dodge'
        || this.state === 'hurt' || this.state === 'dead';
  }
  get canAct() {
    return !this.dead && this.state !== 'hurt' && this.state !== 'dead';
  }

  // --------------------------------------------------------------- combat

  _startAttack(attack) {
    this.state = attack === HEAVY ? 'heavy' : 'attack';
    this.activeAttack = attack;
    this.stateTime = 0;
    const clip = this.clips[attack.key];
    this.stateDuration = clip ? clip.duration / attack.speed : 0.8;
    this.hitThisSwing.clear();
    this.bufferedAttack = false;

    this.play(attack.key, { clip, fade: 0.09, loop: false, speed: attack.speed, restart: true });

    // small forward lunge so swings have weight without root motion
    const yaw = this.root.rotation.y;
    const lunge = attack === HEAVY ? 3.2 : 2.3;
    this.impulse.x += Math.sin(yaw) * lunge;
    this.impulse.z += Math.cos(yaw) * lunge;

    this.effects.slash(
      this.root.position.x, this.root.position.y + this.height * 0.62, this.root.position.z,
      yaw,
      { scale: attack === HEAVY ? 1.25 : 1.0, duration: attack === HEAVY ? 0.3 : 0.22 },
    );
    this.audio.swing(attack === HEAVY ? 1.25 : 1.0);
    this._spendStamina(attack.cost);
  }

  _startDodge() {
    this.state = 'dodge';
    this.stateTime = 0;
    const clip = this.clips.dodge;
    this.stateDuration = clip ? clip.duration / DODGE.speed : 0.7;
    this.activeAttack = null;

    this.play('dodge', { clip, fade: 0.07, loop: false, speed: DODGE.speed, restart: true });

    // roll in the current input direction, or straight ahead if standing
    const axis = this.activeInput.moveAxis();
    const forward = this.cameraRig.forward;
    const right = this.cameraRig.right;
    let dx = forward.x * axis.y + right.x * axis.x;
    let dz = forward.z * axis.y + right.z * axis.x;
    if (dx * dx + dz * dz < 0.01) {
      dx = Math.sin(this.root.rotation.y);
      dz = Math.cos(this.root.rotation.y);
    } else {
      const len = Math.hypot(dx, dz);
      dx /= len; dz /= len;
      this.root.rotation.y = Math.atan2(dx, dz);
    }
    this.impulse.x = dx * DODGE.dash;
    this.impulse.z = dz * DODGE.dash;

    this.effects.dust(this.root.position.x, this.root.position.y, this.root.position.z, 10);
    this.audio.dodge();
    this._spendStamina(DODGE.cost);
  }

  _spendStamina(amount) {
    if (amount <= 0) return;
    this.stamina = Math.max(0, this.stamina - amount);
    this.staminaLock = STATS.staminaDelay;
  }

  takeDamage(amount, sourceX, sourceZ) {
    if (this.dead || this.invulnerable > 0) return false;

    const guarding = this.guarding && this.guardBroken <= 0;
    let dealt = amount;
    if (guarding) {
      dealt = amount * this.progression.guardMitigation;
      this.stamina -= this.progression.guardStaminaCost;
      this.audio.block();
      const yaw = this.root.rotation.y;
      this.effects.impact(
        this.root.position.x + Math.sin(yaw) * 0.7,
        this.root.position.y + 1.1,
        this.root.position.z + Math.cos(yaw) * 0.7,
        -Math.sin(yaw), -Math.cos(yaw),
        { color: 0xbfe0ff, heavy: false },
      );
      if (this.stamina <= 0) {
        // guard breaks — punish window
        this.stamina = 0;
        this.guardBroken = 1.1;
        this.guarding = false;
        this._enterHurt(0.6);
      }
    } else {
      this.audio.playerHurt();
      this.effects.gore(
        this.root.position.x, this.root.position.y + 1.1, this.root.position.z,
        -Math.sin(this.root.rotation.y), -Math.cos(this.root.rotation.y), 0x9c2b28,
      );
      this._enterHurt(STATS.hurtLock);
    }

    this.health = Math.max(0, this.health - dealt);
    this.invulnerable = STATS.invulnAfterHit;

    this.effects.screenFlash(guarding ? 0.12 : 0.3);
    this.game.engine.addShake(guarding ? 0.18 : 0.42);

    if (sourceX !== undefined) {
      const dx = this.root.position.x - sourceX;
      const dz = this.root.position.z - sourceZ;
      const len = Math.hypot(dx, dz) || 1;
      this.impulse.x += (dx / len) * 4.2;
      this.impulse.z += (dz / len) * 4.2;
    }

    if (this.health <= 0) this._die();
    return true;
  }

  _enterHurt(duration) {
    this.state = 'hurt';
    this.stateTime = 0;
    this.stateDuration = duration;
    this.activeAttack = null;
    const clip = this.clips.hurt;
    if (clip) this.play('hurt', { clip, fade: 0.06, loop: false, speed: 1.6, restart: true });
  }

  _die() {
    this.dead = true;
    this.state = 'dead';
    this.stateTime = 0;
    this.stateDuration = 3;
    this.velocity.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
    const clip = this.clips.death;
    if (clip) this.play('death', { clip, fade: 0.12, loop: false, speed: 0.9, restart: true });
    this.game.onPlayerDeath();
  }

  heal(amount) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Restore to full and clear transient state, for a fresh run. */
  reset() {
    this.dead = false;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.state = 'idle';
    this.stateTime = 0;
    this.comboIndex = 0;
    this.comboWindow = 0;
    this.activeAttack = null;
    this.guarding = false;
    this.guardBroken = 0;
    this.invulnerable = 0;
    this.runLatch = false;
    this._wTap = 0;
    this.velocity.set(0, 0, 0);
    this.impulse.set(0, 0, 0);
  }

  // --------------------------------------------------------------- update

  update(dt) {
    this.stateTime += dt;
    this._wTap = Math.max(0, this._wTap - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.staminaLock = Math.max(0, this.staminaLock - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.guardBroken = Math.max(0, this.guardBroken - dt);

    if (this.state === 'dead') {
      this._applyPhysics(dt, 0.9);
      super.update(dt);
      return;
    }

    const input = this.activeInput;
    const canControl = this.canAct && !this.isBusy;

    // ------------------------------------------------------------ guard
    const wantGuard = input.mouse.right && this.stamina > 2 && this.state !== 'dodge';
    if (wantGuard && this.state !== 'hurt') {
      if (!this.guarding) {
        this.guarding = true;
        this.play('guard', { clip: this.clips.guard, fade: 0.16 });
      }
      this.stamina -= STATS.guardDrain * dt;
      this.staminaLock = STATS.staminaDelay;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.guardBroken = 1.1;
        this.guarding = false;
        this._enterHurt(0.6);
      }
    } else if (this.guarding) {
      this.guarding = false;
    }

    // ---------------------------------------------------------- actions
    let startedThisFrame = false;
    if (canControl) {
      if (input.mouse.leftPressed && this.stamina >= COMBO[0].cost) {
        if (this.comboWindow > 0 && this.comboIndex > 0) {
          this._startAttack(COMBO[Math.min(this.comboIndex, COMBO.length - 1)]);
        } else {
          // window lapsed: start the chain over, otherwise the next hit would
          // resume part-way through and skip the second swing
          this.comboIndex = 0;
          this._startAttack(COMBO[0]);
        }
        startedThisFrame = true;
      } else if (input.wasPressed('KeyF') && this.stamina >= HEAVY.cost) {
        this._startAttack(HEAVY);
        startedThisFrame = true;
      } else if (input.wasPressed('Space') && this.stamina >= DODGE.cost && this.state !== 'dodge') {
        this._startDodge();
        startedThisFrame = true;
      }
    }

    // Buffer a follow-up press while a swing is recovering. The guard against
    // `startedThisFrame` matters: without it the very press that launches a
    // swing also queues the next one, so a single tap would chain by itself.
    if (!startedThisFrame && this.state === 'attack' && input.mouse.leftPressed) {
      this.bufferedAttack = true;
    }

    if (this.state === 'attack' || this.state === 'heavy') {
      const attack = this.activeAttack;
      if (attack) {
        const t = this.stateTime / this.stateDuration;
        if (t >= attack.hitStart && t <= attack.hitEnd) {
          this.game.resolvePlayerSwing(this, attack, this.hitThisSwing);
        }
        // cancel the tail of the animation into the next combo hit
        if (this.bufferedAttack && t > 0.62 && this.state === 'attack') {
          this.comboIndex = Math.min(this.comboIndex + 1, COMBO.length - 1);
          this._startAttack(COMBO[this.comboIndex]);
        }
      }
      if (this.stateTime >= this.stateDuration) {
        this.comboIndex = this.state === 'attack' ? Math.min(this.comboIndex + 1, COMBO.length - 1) : 0;
        this.comboWindow = 0.55;
        this.activeAttack = null;
        this.state = 'idle';
      }
    } else if (this.state === 'dodge') {
      const t = this.stateTime / this.stateDuration;
      if (t >= DODGE.iframe[0] && t <= DODGE.iframe[1]) this.invulnerable = Math.max(this.invulnerable, 0.02);
      if (this.stateTime >= this.stateDuration) {
        this.state = 'idle';
        this.effects.dust(this.root.position.x, this.root.position.y, this.root.position.z, 8);
      }
    } else if (this.state === 'hurt') {
      if (this.stateTime >= this.stateDuration) this.state = 'idle';
    }

    // --------------------------------------------------------- movement
    this._updateMovement(dt, canControl);

    // --------------------------------------------------------- animation
    this._updateAnimation(dt);

    super.update(dt);
  }

  _updateMovement(dt, canControl) {
    const inp = this.activeInput;
    const axis = canControl ? inp.moveAxis() : { x: 0, y: 0 };
    const forward = this.cameraRig.forward;
    const right = this.cameraRig.right;

    let wishX = forward.x * axis.y + right.x * axis.x;
    let wishZ = forward.z * axis.y + right.z * axis.x;
    const wishLen = Math.hypot(wishX, wishZ);
    const moving = wishLen > 0.01;

    // double-tap W starts sprinting until W is released (or stamina is empty);
    // holding Shift still works as the direct sprint
    if (canControl && inp.wasPressed('KeyW')) {
      if (this._wTap > 0) this.runLatch = true;
      this._wTap = 0.3;
    }
    if (!inp.isDown('KeyW') || this.stamina <= 1) this.runLatch = false;

    const wantSprint = canControl && moving && this.stamina > 1
      && (inp.isDown('ShiftLeft') || this.runLatch);
    this.sprinting = wantSprint;

    let speed = STATS.walkSpeed;
    if (this.guarding) speed = STATS.guardSpeed;
    else if (wantSprint) speed = STATS.sprintSpeed;
    if (this.state === 'dodge' || this.state === 'attack' || this.state === 'heavy' || this.state === 'hurt') speed = 0;

    if (wantSprint) {
      this.stamina = Math.max(0, this.stamina - 17 * dt);
      this.staminaLock = STATS.staminaDelay;
    }

    // aim the actor: during attacks/guard face the camera, otherwise face travel
    if (this.guarding) {
      this.turnToward(forward.x, forward.z, STATS.turnSpeed * dt);
    } else if (canControl && moving && !this.isBusy) {
      this.turnToward(wishX, wishZ, STATS.turnSpeed * dt);
    } else if (this.state === 'attack' || this.state === 'heavy') {
      // gentle aim assist toward the nearest thing we are swinging at
      const target = this.game.nearestEnemy(this.root.position.x, this.root.position.z, 6.5, Math.PI * 0.9, this.root.rotation.y);
      if (target) {
        const dx = target.root.position.x - this.root.position.x;
        const dz = target.root.position.z - this.root.position.z;
        this.turnToward(dx, dz, 7.5 * dt);
      }
    }

    if (moving && speed > 0) {
      wishX /= wishLen;
      wishZ /= wishLen;
      const targetVx = wishX * speed;
      const targetVz = wishZ * speed;
      const a = Math.min(1, STATS.accel * dt / Math.max(speed, 0.001));
      this.velocity.x += (targetVx - this.velocity.x) * a;
      this.velocity.z += (targetVz - this.velocity.z) * a;
    } else {
      const damping = this.state === 'dodge' ? 1.2 : 12;
      this.velocity.x -= this.velocity.x * Math.min(1, damping * dt);
      this.velocity.z -= this.velocity.z * Math.min(1, damping * dt);
    }

    this._applyPhysics(dt, 1);

    // stamina regen once nothing has been spent recently
    if (this.staminaLock <= 0 && !this.guarding && !wantSprint) {
      this.stamina = Math.min(this.maxStamina, this.stamina + STATS.staminaRegen * dt);
    }
  }

  _applyPhysics(dt, controlScale) {
    const p = this.root.position;

    p.x += (this.velocity.x + this.impulse.x) * dt * controlScale;
    p.z += (this.velocity.z + this.impulse.z) * dt * controlScale;

    // impulse decays fast — it is a lunge, not a force
    const decay = Math.max(0, 1 - 7 * dt);
    this.impulse.x *= decay;
    this.impulse.z *= decay;
    if (Math.abs(this.impulse.x) < 0.05) this.impulse.x = 0;
    if (Math.abs(this.impulse.z) < 0.05) this.impulse.z = 0;

    this.world.colliders.resolve(p, this.radius);
    this.world.clampToWorld(p, this.radius + 0.2);
    p.y = this.world.groundAt(p.x, p.z);
  }

  _updateAnimation(dt) {
    if (this.state === 'idle') {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.guarding) {
        this.play('guard', { clip: this.clips.guard, fade: 0.18 });
      } else if (speed > 0.4) {
        const key = this.sprinting ? 'sprint' : 'run';
        const clip = this.clips[key];
        // match stride rate to actual ground speed
        const ref = this.sprinting ? STATS.sprintSpeed : STATS.walkSpeed;
        const rate = THREE.MathUtils.clamp(speed / ref, 0.65, 1.35) * (this.sprinting ? 1.0 : 1.0);
        this.play(key, { clip, fade: 0.22, sync: true, speed: rate });
      } else {
        this.play('idle', { clip: this.clips.idle, fade: 0.28 });
      }
    }

    // footsteps driven off the locomotion clip's own phase
    const locomotion = this.currentName === 'run' || this.currentName === 'sprint';
    if (locomotion) {
      const phase = this.phase;
      const crossed = (this.lastStepPhase < 0.25 && phase >= 0.25)
                   || (this.lastStepPhase < 0.75 && phase >= 0.75);
      if (crossed) {
        this.audio.footstep(this.sprinting ? 1.0 : 0.8);
        if (this.sprinting) {
          this.effects.dust(this.root.position.x, this.root.position.y, this.root.position.z, 3);
        }
      }
      this.lastStepPhase = phase;
    } else {
      this.lastStepPhase = 0;
    }
  }
}
