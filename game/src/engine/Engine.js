import * as THREE from 'three';

/**
 * Owns the renderer, scene, camera and the fixed update pipeline.
 *
 * Time is published as two clocks: `dt` is the gameplay delta (squashed by
 * hit-stop and pause) and `rawDt` is real elapsed time for anything that
 * should keep moving regardless — camera shake, UI tweens, particles.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 700);
    this.camera.position.set(0, 3, 8);

    this.clock = new THREE.Clock();
    this.elapsed = 0;

    this.updaters = [];
    this.running = false;

    // adaptive resolution: the pixel-ratio cap is generous on hi-dpi screens,
    // so a slow GPU walks it down and a fast one walks it back up
    this.pixelRatioCap = Math.min(window.devicePixelRatio, 1.5);
    this._pixelRatio = this.renderer.getPixelRatio();
    this._perfTime = 0;
    this._perfFrames = 0;
    /** Smoothed frames per second, refreshed with the resolution sampler. */
    this.fps = 0;

    this.paused = false;
    this.freeze = 0;
    this.shakeTrauma = 0;

    this._onResize = this._onResize.bind(this);
    this._tick = this._tick.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  /** Register a per-frame callback: fn(dt, rawDt, elapsed). */
  onUpdate(fn) { this.updaters.push(fn); return fn; }

  /**
   * Brief time-squash on impact. Not a hard freeze — a sliver of motion
   * reads as weight instead of a stutter.
   */
  hitStop(seconds = 0.07) {
    this.freeze = Math.max(this.freeze, seconds);
  }

  addShake(amount) {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.renderer.setAnimationLoop(this._tick);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) this.clock.getDelta(); // swallow the paused interval
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _tick() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += rawDt;

    let dt = rawDt;
    if (this.paused) {
      dt = 0;
    } else if (this.freeze > 0) {
      this.freeze -= rawDt;
      dt = rawDt * 0.06;
    }

    for (const fn of this.updaters) fn(dt, rawDt, this.elapsed);

    // camera shake is applied after controllers have placed the camera
    this.shakeTrauma = Math.max(0, this.shakeTrauma - rawDt * 1.6);
    const shake = this.shakeTrauma * this.shakeTrauma;
    if (shake > 0.0001) {
      const t = this.elapsed * 34;
      const amp = shake * 0.42;
      this.camera.position.x += Math.sin(t * 1.7) * amp;
      this.camera.position.y += Math.sin(t * 2.3 + 1.1) * amp;
      this.camera.position.z += Math.sin(t * 1.3 + 2.7) * amp;
      this.camera.rotateZ(Math.sin(t * 2.9) * shake * 0.02);
    }

    this.renderer.render(this.scene, this.camera);
    this._adaptResolution(rawDt);
  }

  /**
   * Keep the frame budget by nudging the render resolution. Sampling every
   * 1.5 s and moving in 0.25 steps keeps it from oscillating: a vsync-locked
   * 60 fps sits between the two thresholds and never moves.
   */
  _adaptResolution(rawDt) {
    this._perfTime += rawDt;
    this._perfFrames++;
    if (this._perfTime < 1.5) return;

    const avg = this._perfTime / Math.max(1, this._perfFrames);
    this._perfTime = 0;
    this._perfFrames = 0;
    this.fps = Math.round(1 / Math.max(avg, 0.001));

    if (avg > 0.019 && this._pixelRatio > 0.6) {
      this.setPixelRatio(Math.max(0.6, this._pixelRatio - 0.2));
    } else if (avg < 0.014 && this._pixelRatio < this.pixelRatioCap) {
      this.setPixelRatio(Math.min(this.pixelRatioCap, this._pixelRatio + 0.2));
    }
  }

  /** Change the render resolution; the CSS size and layout stay put. */
  setPixelRatio(value) {
    this._pixelRatio = value;
    this.renderer.setPixelRatio(value);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
