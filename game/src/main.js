import { Engine } from './engine/Engine.js';
import { Input } from './engine/Input.js';
import { Audio } from './engine/Audio.js';
import { Assets } from './game/Assets.js';
import { Game } from './game/Game.js';
import { GraphicsSettings } from './game/Graphics.js';
import { UI } from './ui/UI.js';
import { TouchControls } from './ui/TouchControls.js';

/**
 * Bootstrap: wire the engine, load the packs, build the world, then hand over
 * to the game loop.
 */

const canvas = document.getElementById('viewport');
const ui = new UI();

const engine = new Engine(canvas);
const input = new Input(canvas);
const audio = new Audio();
const assets = new Assets();

const touchDevice = TouchControls.detect();
const graphics = new GraphicsSettings({ touchDevice });

// the preset owns the pixel ratio and shadow switch from the very first frame
graphics.applyRenderer(engine);

const game = new Game({ engine, input, audio, assets, ui });
const touchControls = new TouchControls(input);
if (touchDevice) touchControls.enable();

// ---------------------------------------------------------------- main loop

let updateErrorLogged = false;

engine.onUpdate((dt, rawDt) => {
  input.tickTimers(rawDt);
  // a bad frame must not stop the render loop: log once and keep drawing
  try {
    game.update(dt, rawDt);
  } catch (err) {
    if (!updateErrorLogged) {
      updateErrorLogged = true;
      console.error('[Game] update failed:', err);
    }
  }
  input.endFrame();
});

// ------------------------------------------------------------------- input

/**
 * Chrome refuses a lock request that arrives too soon after an exit, and
 * reports it as an unhandled rejection. Swallow it — losing the lock simply
 * pauses the run, and the player can click to re-acquire.
 */
function requestLock() {
  // touch has no pointer lock; TouchControls keeps a virtual one instead
  if (touchDevice) return;
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch { /* ignore */ }
}

canvas.addEventListener('click', () => {
  if (game.state === 'playing' && !game.blocked && !input.locked) requestLock();
});

document.addEventListener('pointerlockchange', () => {
  // Esc is swallowed by the browser while locked, so treat an unexpected
  // unlock during play as a pause request — but not while a panel or dialogue
  // is deliberately holding the pointer.
  if (!input.locked && game.state === 'playing' && !game.blocked) game.pause();
});

window.addEventListener('keydown', (e) => {
  // never steal keys while the player is typing their name
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyM' && e.ctrlKey) return;
  if (e.code === 'Escape') {
    if (game.dialogue.active) { game.dialogue.skip(); return; }
    if (game.ui.panelOpen) {
      if (game.state === 'paused') game.closeSavePanel();
      else game.closePanels();
      return;
    }
    if (game.state === 'playing') game.pause();
    else if (game.state === 'paused') game.resume();
  }
  if (e.code === 'KeyM' && game.state === 'playing' && !game.dialogue.active) {
    if (game.ui.panelOpen) game.closePanels();
    else game.openMap();
  }
});

// dialogue text entry
ui.bindDialogueInput({
  onType: (value) => game.dialogue.setTyped(value),
  onSubmit: (value) => game.dialogue.submit(value),
});

// ------------------------------------------------------------------ wiring

document.getElementById('btn-start').addEventListener('click', () => {
  audio.init();
  audio.uiClick();
  game.startRun();
  if (touchDevice) touchControls.enterFullscreen();
  requestLock();
});

document.getElementById('btn-resume').addEventListener('click', () => {
  audio.uiClick();
  game.resume();
});

document.getElementById('btn-saves').addEventListener('click', () => {
  audio.uiClick();
  game.openSaves();
});

// some players (and some remote-desktop / driver setups) get the opposite
// horizontal look direction; this flips it and remembers the choice
const invertBtn = document.getElementById('btn-invert');
const refreshInvert = () => {
  invertBtn.textContent = `Mouse look: ${input.invertX ? 'inverted' : 'normal'}`;
};
invertBtn.addEventListener('click', () => {
  audio.uiClick();
  input.toggleInvertX();
  refreshInvert();
});
refreshInvert();

// graphics preset buttons live on the pause screen
const qualityButtons = Array.from(document.querySelectorAll('.quality-btn'));
const refreshQuality = () => {
  for (const b of qualityButtons) b.classList.toggle('active', b.dataset.quality === graphics.preset);
};
for (const btn of qualityButtons) {
  btn.addEventListener('click', () => {
    audio.uiClick();
    graphics.set(btn.dataset.quality);
    graphics.applyRenderer(engine);
    if (game.world) graphics.applyWorld(engine, game.world, game.effects);
    refreshQuality();
  });
}
refreshQuality();

document.getElementById('btn-quit').addEventListener('click', () => {
  audio.uiClick();
  game.toTitle();
});

document.getElementById('btn-again').addEventListener('click', () => {
  audio.uiClick();
  game.startRun();
  requestLock();
});

// -------------------------------------------------------------------- boot

async function boot() {
  try {
    ui.setLoadProgress(0.02, 'Reading the packs…');
    await assets.load((p) => {
      ui.setLoadProgress(p * 0.2, 'Reading the packs…');
    });

    ui.setLoadProgress(0.2, 'Raising the walls of Ravenshold…');
    await game.init((p) => {
      ui.setLoadProgress(0.2 + p * 0.8, 'Raising the walls of Ravenshold…');
    });

    graphics.applyWorld(engine, game.world, game.effects);

    ui.setLoadProgress(1, 'Ready');
    ui.hideLoader();
    ui.showTitle();
    engine.start();
  } catch (err) {
    console.error(err);
    ui.setLoadProgress(1, `Failed to load: ${err.message}`);
    document.getElementById('loader-text').style.color = '#e08a7a';
  }
}

boot();

// expose for debugging in the console
window.__wildwood = { engine, input, audio, assets, game, ui, graphics, touch: touchControls };
