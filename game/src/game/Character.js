import * as THREE from 'three';
import { computeFacingOffset } from './Assets.js';

/**
 * A skinned actor: container transform (gameplay) wrapping the imported model
 * (visual), plus an AnimationMixer state machine with crossfades.
 *
 * Convention: `root` faces +Z. The model is pre-rotated at construction so its
 * authored forward lines up with +Z, which means gameplay code can just do
 * `root.rotation.y = Math.atan2(dir.x, dir.z)` and never think about it again.
 */
export class Character {
  constructor({ model, assets, facingOffset, height = 1.8 }) {
    this.assets = assets;
    this.height = height;

    this.root = new THREE.Group();
    this.root.add(model);
    model.rotation.y = facingOffset;

    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    this.current = null;
    this.currentName = '';
    this._onFinish = new Map();

    this.mixer.addEventListener('finished', (e) => {
      const cb = this._onFinish.get(e.action);
      if (cb) cb();
    });
  }

  /** Smoothly turn toward a direction with a max angular speed (rad/s). */
  turnToward(x, z, maxDelta) {
    if (x * x + z * z < 1e-8) return;
    const target = Math.atan2(x, z);
    let diff = target - this.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxDelta);
    this.root.rotation.y += step;
  }

  /**
   * Crossfade to a clip.
   *
   * @param {string} key       key into the clip map, e.g. 'idle'
   * @param {object} opts
   *   clip     AnimationClip to use (resolved by subclasses from the registry)
   *   fade     crossfade seconds
   *   loop     repeat vs one-shot
   *   speed    playback rate
   *   restart  replay even if already active
   *   sync     carry the phase across so footfalls stay in cadence
   *   onFinish called once for one-shot clips
   */
  play(key, { clip, fade = 0.2, loop = true, speed = 1, restart = false, sync = false, onFinish = null } = {}) {
    if (!clip) return null;

    let action = this.actions.get(clip);
    if (!action) {
      action = this.mixer.clipAction(clip);
      this.actions.set(clip, action);
    }

    const isCurrent = this.current === action;
    if (isCurrent && !restart) {
      action.setEffectiveTimeScale(speed);
      return action;
    }

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(speed);

    // keep the stride in phase when swapping between locomotion cycles
    if (sync && this.current && loop && this.current.getClip().duration > 0) {
      const phase = (this.current.time / this.current.getClip().duration) % 1;
      action.time = phase * clip.duration;
    }

    if (this.current && this.current !== action) {
      action.crossFadeFrom(this.current, fade, false);
    }
    action.play();

    if (onFinish) this._onFinish.set(action, onFinish);

    this.current = action;
    this.currentName = key;
    return action;
  }

  /** Progress through the active clip, 0..1. */
  get phase() {
    if (!this.current) return 0;
    const d = this.current.getClip().duration;
    return d > 0 ? (this.current.time / d) % 1 : 0;
  }

  update(dt) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this._onFinish.clear();
  }
}
