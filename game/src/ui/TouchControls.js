/**
 * Touch controls for phones and tablets.
 *
 * The pad does not invent a second input path: it dispatches the same DOM
 * events the keyboard and mouse already produce, and puts Input into a
 * "virtual lock" so the mouse listeners (which normally wait for pointer lock)
 * accept them. Everything downstream — movement, combos, guard, dialogue,
 * the map key — keeps working unchanged.
 *
 * Layout: a thumb stick bottom-left, an ABXY cluster bottom-right, E/M/pause
 * above it, and dragging anywhere on the canvas looks around.
 */

const STICK_DEAD_ZONE = 0.26;
const STICK_SPRINT = 0.92;
const TAP_HOLD_MS = 60;

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.canvas = input.canvas;
    this.root = document.getElementById('touch');
    this.stick = document.getElementById('stick');
    this.knob = document.getElementById('stick-knob');
    this.enabled = false;

    /** key codes the pad is currently holding down */
    this.held = new Set();
    this._stickPointer = null;
    this._lookPointer = null;
    this._sprintHeld = false;
  }

  static detect() {
    try {
      if (new URLSearchParams(window.location.search).has('touch')) return true;
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      const anyFine = window.matchMedia?.('(any-pointer: fine)').matches;
      return !!coarse || (navigator.maxTouchPoints > 0 && !anyFine);
    } catch {
      return false;
    }
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    this.root.classList.remove('hidden');

    // the mouse listeners gate on pointer lock, which touch does not have
    this.input.locked = true;
    this.input.requestLock = () => {};
    this.input.releaseLock = () => {};

    this._bindStick();
    this._bindButtons();
    this._bindLook();
  }

  /** Fullscreen + landscape, from inside the Start tap (both need a gesture). */
  async enterFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch { /* refused; the game still runs in the browser tab */ }
    try {
      await window.screen?.orientation?.lock?.('landscape');
    } catch { /* not supported (iOS) */ }
  }

  // --------------------------------------------------------------- plumbing

  /** Short haptic tick on Android; silently ignored elsewhere. */
  _buzz(ms = 8) {
    try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
  }

  _key(code, down) {
    const has = this.held.has(code);
    if (down === has) return;
    if (down) this.held.add(code);
    else this.held.delete(code);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
      code,
      bubbles: true,
    }));
  }

  /** A one-shot press; held for a few frames so the next tick sees it. */
  _tap(code) {
    this._key(code, true);
    window.setTimeout(() => this._key(code, false), TAP_HOLD_MS);
  }

  _mouse(button, down) {
    const target = down ? this.canvas : window;
    target.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', {
      button,
      bubbles: true,
      cancelable: true,
    }));
  }

  _lookBy(dx, dy) {
    window.dispatchEvent(new MouseEvent('mousemove', {
      movementX: dx * 1.8,
      movementY: dy * 1.8,
      bubbles: true,
    }));
  }

  // ------------------------------------------------------------------ stick

  _setStick(dx, dy) {
    const travel = 40;
    this.knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
    this._key('KeyW', -dy > STICK_DEAD_ZONE);
    this._key('KeyS', dy > STICK_DEAD_ZONE);
    this._key('KeyA', -dx > STICK_DEAD_ZONE);
    this._key('KeyD', dx > STICK_DEAD_ZONE);
    const sprint = Math.hypot(dx, dy) > STICK_SPRINT;
    this._key('ShiftLeft', sprint);
    if (sprint !== this._sprintHeld) {
      this._sprintHeld = sprint;
      this.stick.classList.toggle('sprint', sprint);
      if (sprint) this._buzz(6);
    }
  }

  _releaseStick() {
    this._stickPointer = null;
    this.knob.style.transform = '';
    this.stick.classList.remove('sprint');
    this._sprintHeld = false;
    for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) this._key(code, false);
  }

  _bindStick() {
    const move = (e) => {
      const r = this.stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy) || 1;
      if (len > 1) { dx /= len; dy /= len; }
      this._setStick(dx, dy);
    };

    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._stickPointer = e.pointerId;
      try { this.stick.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
      move(e);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this._stickPointer) move(e);
    });
    for (const type of ['pointerup', 'pointercancel']) {
      this.stick.addEventListener(type, (e) => {
        if (e.pointerId === this._stickPointer) this._releaseStick();
      });
    }
  }

  // ---------------------------------------------------------------- buttons

  _bindButtons() {
    for (const btn of this.root.querySelectorAll('.tbtn')) {
      const tap = btn.dataset.tap;
      const hold = btn.dataset.hold;

      const down = (e) => {
        e.preventDefault();
        this._buzz(8);
        btn.classList.add('pressed');
        try { btn.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
        if (tap) this._tap(tap);
        if (hold === 'attack') this._mouse(0, true);
        if (hold === 'guard') this._mouse(2, true);
      };
      const up = () => {
        btn.classList.remove('pressed');
        if (hold === 'attack') this._mouse(0, false);
        if (hold === 'guard') this._mouse(2, false);
      };

      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    }
  }

  // ------------------------------------------------------------------- look

  _bindLook() {
    const canvas = this.canvas;

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'mouse') return;
      this._lookPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    });

    canvas.addEventListener('pointermove', (e) => {
      const look = this._lookPointer;
      if (!look || e.pointerId !== look.id) return;
      const dx = e.clientX - look.x;
      const dy = e.clientY - look.y;
      look.x = e.clientX;
      look.y = e.clientY;
      this._lookBy(dx, dy);
    });

    const end = (e) => {
      if (this._lookPointer && e.pointerId === this._lookPointer.id) this._lookPointer = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }
}
