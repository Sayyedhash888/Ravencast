/**
 * Keyboard + mouse state with pointer lock, plus edge detection.
 *
 * `justPressed` is consumed once per frame by the game loop, so callers can
 * ask "was this tapped this frame" without ordering headaches.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.justPressed = new Set();

    this.mouse = {
      left: false,
      right: false,
      leftPressed: false,
      leftReleased: false,
      rightPressed: false,
      dx: 0,
      dy: 0,
      wheel: 0,
    };

    /** Held duration per mouse button, used for tap-vs-hold attacks. */
    this.mouseHeld = { left: 0, right: 0 };

    this.locked = false;
    this.enabled = true;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.invertX = Input._loadInvertX();

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      // let the browser keep its own shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.mouse.leftReleased = true; }
      if (e.button === 2) { this.mouse.right = false; }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX * this.sensitivity * (this.invertX ? -1 : 1);
      this.mouse.dy += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });

    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        // never leave a button stuck down when the lock drops
        this.mouse.left = this.mouse.right = false;
        this.keys.clear();
      }
    });
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.();
  }

  /** Flip the horizontal look axis and remember the choice across runs. */
  toggleInvertX() {
    this.invertX = !this.invertX;
    try {
      localStorage.setItem('wildwood.invertX', this.invertX ? '1' : '0');
    } catch { /* storage may be blocked; the toggle still works this run */ }
    return this.invertX;
  }

  static _loadInvertX() {
    try {
      return localStorage.getItem('wildwood.invertX') === '1';
    } catch {
      return false;
    }
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock?.();
  }

  isDown(code) { return this.enabled && this.keys.has(code); }
  wasPressed(code) { return this.enabled && this.justPressed.has(code); }

  /** -1..1 on each axis, camera-relative. */
  moveAxis() {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  /** Called once at the end of every frame. */
  endFrame() {
    this.justPressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.leftPressed = false;
    this.mouse.leftReleased = false;
    this.mouse.rightPressed = false;
  }

  /** Advance hold timers; call at the top of the frame with real delta. */
  tickTimers(dt) {
    this.mouseHeld.left = this.mouse.left ? this.mouseHeld.left + dt : 0;
    this.mouseHeld.right = this.mouse.right ? this.mouseHeld.right + dt : 0;
  }
}
