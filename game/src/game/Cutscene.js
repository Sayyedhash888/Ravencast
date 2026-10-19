import * as THREE from 'three';

/**
 * A tiny scripted-sequence runner for the opening.
 *
 * Beats are data: camera moves, waits, dialogue, and arbitrary callbacks. While
 * a cutscene is running it owns the camera outright, so the third-person rig
 * does not fight it. Skippable at any point.
 *
 * Beat shapes:
 *   { type: 'camera', from: [x,y,z], to: [x,y,z], look: [x,y,z], lookTo?, duration, ease? }
 *   { type: 'wait', duration }
 *   { type: 'dialogue', lines: [...] }
 *   { type: 'call', fn }
 *   { type: 'objective', text }
 */
export class Cutscene {
  constructor({ camera, dialogue, onObjective = null, onFinish = null }) {
    this.camera = camera;
    this.dialogue = dialogue;
    this.onObjective = onObjective;
    this.onFinish = onFinish;

    this.beats = [];
    this.index = 0;
    this.time = 0;
    this.active = false;
    this._waitingForDialogue = false;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._lookTo = new THREE.Vector3();
  }

  play(beats) {
    this.beats = beats;
    this.index = 0;
    this.time = 0;
    this.active = true;
    this._waitingForDialogue = false;
    this._enter(0);
    return this;
  }

  skip() {
    if (!this.active) return;
    // run any remaining 'call' beats so state stays consistent, then stop
    this.dialogue.skip();
    for (let i = this.index; i < this.beats.length; i++) {
      const b = this.beats[i];
      if (b.type === 'call') b.fn();
      if (b.type === 'objective' && this.onObjective) this.onObjective(b.text);
    }
    this._finish();
  }

  _finish() {
    this.active = false;
    this.beats = [];
    this._waitingForDialogue = false;
    if (this.onFinish) this.onFinish();
  }

  _enter(i) {
    const beat = this.beats[i];
    if (!beat) return;

    switch (beat.type) {
      case 'camera':
        this._from.fromArray(beat.from);
        this._to.fromArray(beat.to);
        this._look.fromArray(beat.look);
        this._lookTo.fromArray(beat.lookTo || beat.look);
        break;
      case 'dialogue':
        this._waitingForDialogue = true;
        this.dialogue.start(beat.lines, { onComplete: () => { this._waitingForDialogue = false; } });
        break;
      case 'call':
        beat.fn();
        break;
      case 'objective':
        if (this.onObjective) this.onObjective(beat.text);
        break;
      default:
        break;
    }
    this.time = 0;
  }

  _advance() {
    this.index++;
    if (this.index >= this.beats.length) {
      this._finish();
      return;
    }
    this._enter(this.index);
  }

  update(dt) {
    if (!this.active) return;

    const beat = this.beats[this.index];
    if (!beat) { this._finish(); return; }

    this.time += dt;

    switch (beat.type) {
      case 'camera': {
        const d = Math.max(0.001, beat.duration);
        const raw = Math.min(1, this.time / d);
        const t = ease(raw, beat.ease || 'inOut');
        this.camera.position.lerpVectors(this._from, this._to, t);
        const look = new THREE.Vector3().lerpVectors(this._look, this._lookTo, t);
        this.camera.lookAt(look);
        if (raw >= 1) this._advance();
        break;
      }
      case 'wait':
        if (this.time >= beat.duration) this._advance();
        break;
      case 'dialogue':
        // the runner waits for the dialogue queue to drain
        if (!this._waitingForDialogue) this._advance();
        break;
      default:
        // instantaneous beats move on immediately
        this._advance();
        break;
    }
  }
}

function ease(t, kind) {
  switch (kind) {
    case 'in': return t * t;
    case 'out': return 1 - (1 - t) * (1 - t);
    case 'linear': return t;
    default: return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}

/** The opening sequence: a sweep over the city, then control is handed over. */
export function introCutscene(cityName, guildPos) {
  const [gx, gz] = guildPos;
  return [
    { type: 'camera', from: [0, 62, 96], to: [0, 34, 62], look: [0, 6, 20], lookTo: [0, 6, 0], duration: 5.0, ease: 'out' },
    { type: 'dialogue', lines: [
      { speaker: 'Chronicler', text: 'Ravenshold. The last walled town before the wild takes over.' },
    ] },
    { type: 'camera', from: [0, 34, 62], to: [gx * 0.4, 16, gz * 0.4 + 26], look: [0, 5, 0], lookTo: [gx, 5, gz], duration: 5.5, ease: 'inOut' },
    { type: 'dialogue', lines: [
      { speaker: 'Chronicler', text: 'You arrived this morning with a sword you barely know how to hold and a purse that rattles when you breathe.' },
      { speaker: 'Chronicler', text: 'The Guild hall stands on the north side of the square. That is where work is found.' },
    ] },
    { type: 'camera', from: [gx * 0.4, 16, gz * 0.4 + 26], to: [gx + 9, 3.4, gz + 16], look: [gx, 4, gz], lookTo: [gx, 3.5, gz + 6], duration: 4.0, ease: 'inOut' },
    { type: 'objective', text: 'Enter the Guild hall' },
    { type: 'call', fn: () => {} },
  ];
}
