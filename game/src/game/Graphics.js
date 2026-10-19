/**
 * Graphics presets.
 *
 * The world is ~3.4 M triangles with a shadow pass on top, so a smooth frame
 * matters more than prettiness on unknown hardware. Low is the default; the
 * player can raise it from the pause screen. The choice is stored like the
 * other preferences in this project (localStorage, best-effort).
 */

export const PRESETS = {
  low: {
    label: 'Low',
    pixelRatio: 1.0,
    shadows: false,
    shadowMap: 768,
    shadowRadius: 26,
    drawDistance: 120,
    particles: 0.5,
    detail: 0.6,
    ground: 0.35,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.15,
    shadows: true,
    shadowMap: 1024,
    shadowRadius: 36,
    drawDistance: 170,
    particles: 0.7,
    detail: 0.72,
    ground: 0.5,
  },
  high: {
    label: 'High',
    pixelRatio: 1.5,
    shadows: true,
    shadowMap: 2048,
    shadowRadius: 48,
    drawDistance: 320,
    particles: 1,
    detail: 1,
    ground: 1,
  },
};

const KEY = 'wildwood.graphics.v2';

export class GraphicsSettings {
  constructor({ touchDevice = false } = {}) {
    // Medium is the desktop default; phones start on Low so they are smooth
    // out of the box. A saved choice always wins.
    this.preset = touchDevice ? 'low' : 'medium';
    try {
      const saved = localStorage.getItem(KEY);
      if (PRESETS[saved]) this.preset = saved;
    } catch { /* storage may be blocked; stay on the default */ }
  }

  get config() { return PRESETS[this.preset]; }

  set(preset) {
    if (!PRESETS[preset]) return this.preset;
    this.preset = preset;
    try {
      localStorage.setItem(KEY, preset);
    } catch { /* ignore */ }
    return preset;
  }

  /** Renderer-side settings; safe to call before the world exists. */
  applyRenderer(engine) {
    const cfg = this.config;
    engine.pixelRatioCap = Math.min(window.devicePixelRatio, cfg.pixelRatio);
    engine.setPixelRatio(engine.pixelRatioCap);
    engine.renderer.shadowMap.enabled = cfg.shadows;
  }

  /** World-side settings; call after build and whenever the preset changes. */
  applyWorld(engine, world, effects) {
    const cfg = this.config;
    const sun = world.sun;
    if (sun) {
      sun.castShadow = cfg.shadows;
      sun.shadow.mapSize.set(cfg.shadowMap, cfg.shadowMap);
      const cam = sun.shadow.camera;
      cam.left = -cfg.shadowRadius;
      cam.right = cfg.shadowRadius;
      cam.top = cfg.shadowRadius;
      cam.bottom = -cfg.shadowRadius;
      cam.updateProjectionMatrix();
      // force the shadow map to be recreated at the new resolution
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    engine.renderer.shadowMap.enabled = cfg.shadows;
    world.drawDistance = cfg.drawDistance;
    world.setDetail(cfg.detail, cfg.ground);
    if (effects) effects.density = cfg.particles;
  }
}
