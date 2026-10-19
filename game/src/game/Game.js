import * as THREE from 'three';
import { Player } from './Player.js';
import { Enemy, ENEMY_TYPES } from './Enemy.js';
import { Npc } from './Npc.js';
import { CameraRig } from './CameraRig.js';
import { Effects } from './Effects.js';
import { World } from './world/World.js';
import { CITY, REGIONS, regionById, regionAt, biomeAt } from './world/Regions.js';
import { INTERIOR_ORIGIN } from './world/GuildInterior.js';
import { Progression } from './Progression.js';
import { MissionSystem } from './Missions.js';
import { allSlots, clearSlot, readSlot, writeSlot } from './Saves.js';
import { Dialogue } from './Dialogue.js';
import { Cutscene, introCutscene } from './Cutscene.js';

/**
 * Orchestrates everything: the world, the player, the guild loop, missions and
 * the intro sequence.
 *
 * Two ideas hold it together. `state` is the coarse mode (title / playing /
 * paused / over) and `blocked` is the fine one — true whenever a dialogue or a
 * panel owns the screen, which freezes the player and the camera without
 * stopping the world. Area transitions (city <-> guild interior) are a fade
 * plus a teleport, since the interior is a sealed room parked off-map.
 */

// A contract spawns one finite pack per visit to its region: the kills still
// needed plus a small buffer (a 6-kill contract gets 10 monsters). Nothing
// ambient wanders the wilds, and no more spawn once the pack is out.
const SPAWN = { spawnAt: [26, 48], despawnAt: 90, buffer: 4, eliteGuards: 3 };

/** Which monsters live where, and how many of each. */
const BIOME_POPULATION = {
  forest: [['imp', 0.62], ['puglin', 0.38]],
  blight: [['imp', 0.75], ['puglin', 0.25]],
  desert: [['imp', 0.4], ['puglin', 0.6]],
};

export class Game {
  constructor({ engine, input, audio, assets, ui }) {
    this.engine = engine;
    this.input = input;
    this.audio = audio;
    this.assets = assets;
    this.ui = ui;

    this.scene = engine.scene;
    this.state = 'title';
    this.blocked = false;

    this.enemies = [];
    this.pools = { imp: [], puglin: [], warden: [] };
    this.npcs = [];

    this.progression = new Progression().load();
    this.missions = new MissionSystem(this.progression);
    this.dialogue = new Dialogue((current, active, isInput, typed) => {
      this.ui.showDialogue(current, active, isInput, typed);
      this.blocked = active;
      if (!active) this.input.requestLock?.();
    });

    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.overTimer = 0;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this._overShown = false;
    this._registered = false;
    this._objectiveRegionId = null;
    this._pendingInteraction = null;
    this._missionId = null;
    this._spawnRegionId = null;

    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ setup

  async init(onProgress = () => {}) {
    this.world = new World(this.scene, this.assets, this.engine.renderer);
    await this.world.build({
      seed: 20261017,
      onProgress: (p) => onProgress(p * 0.82),
    });

    this.effects = new Effects(this.scene, this.engine.camera);
    this.cameraRig = new CameraRig(this.engine.camera, this.input, this.world);

    this.player = new Player({
      assets: this.assets,
      world: this.world,
      cameraRig: this.cameraRig,
      input: this.input,
      effects: this.effects,
      audio: this.audio,
      game: this,
      progression: this.progression,
    });
    this.scene.add(this.player.root);

    // the shield is a static prop hung off the left hand
    this.shieldModel = await this.assets.kit('props', 'Shield_Wooden');
    this.applyEquipment();

    await this._spawnGuildNpcs();

    // a floating marker over the mission board, so nobody has to hunt for it
    this._createBoardMarker();

    // compile every shader variant (world, guild lamps, monsters) behind the
    // loading screen, so the first fight cannot stall on a shader compile
    await this._warmup();
    onProgress(1);
  }

  /**
   * Build one of each monster off-stage and compile the scene twice: once for
   * the outdoor light rig and once with the guild's six lamps visible. Three
   * keys its programs on the light count, so without this the first hit or the
   * first step into the hall pays for the compile mid-frame.
   */
  async _warmup() {
    const { engine } = this;
    const staged = [];
    for (const type of ['imp', 'puglin']) {
      const enemy = new Enemy({ assets: this.assets, world: this.world, game: this, type });
      enemy.root.position.set(0, -600, 0);
      this.scene.add(enemy.root);
      staged.push(enemy);
    }

    const [ox, oy, oz] = INTERIOR_ORIGIN;
    const halfD = this.world.guild.bounds.halfD;
    const warmCam = new THREE.PerspectiveCamera(62, 640 / 360, 0.1, 90);
    warmCam.position.set(ox, oy + 1.7, oz + halfD - 5);
    warmCam.lookAt(ox, oy + 1.4, oz - halfD + 4);
    const warmTarget = new THREE.WebGLRenderTarget(640, 360);

    try {
      this.world.setInteriorLighting(false);
      await engine.renderer.compileAsync(this.scene, engine.camera);

      // Step inside for a few real frames while the loader is still up.
      // Compiling handles shaders; the renders upload the hall's wall/floor/
      // prop textures, which would otherwise stall the first step through the
      // door. Four headings from the middle cover the whole room.
      this.world.enterGuild();
      await engine.renderer.compileAsync(this.scene, warmCam);
      warmCam.position.set(ox, oy + 1.7, oz);
      engine.renderer.setRenderTarget(warmTarget);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        warmCam.lookAt(ox + Math.sin(a) * 12, oy + 1.35, oz + Math.cos(a) * 12);
        engine.renderer.render(this.scene, warmCam);
      }
    } catch (err) {
      console.warn('[Game] shader warm-up skipped:', err);
    } finally {
      engine.renderer.setRenderTarget(null);
      warmTarget.dispose();
    }
    this.world.exitGuild();
    this.world.setInteriorLighting(false);

    for (const enemy of staged) {
      this.scene.remove(enemy.root);
      enemy.dispose();
    }
  }

  // ------------------------------------------------------------- board marker

  /**
   * A small floating gem over the mission board. It only shows while the player
   * is in the hall without a contract — once one is taken the board has
   * nothing to say, so the marker gets out of the way.
   */
  _createBoardMarker() {
    const board = this.world.guild?.anchors?.board;
    if (!board) return;

    const marker = new THREE.Group();
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffdf9a,
        emissive: 0xffa32e,
        emissiveIntensity: 1.8,
        roughness: 0.35,
        metalness: 0.1,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffbe55, transparent: true, opacity: 0.16, depthWrite: false,
      }),
    );
    marker.add(gem, halo);
    marker.position.set(board.x + 0.55, board.y + 1.25, board.z);
    marker.visible = false;
    this.scene.add(marker);

    this.boardMarker = { marker, halo, baseY: marker.position.y, phase: 0 };
  }

  _updateBoardMarker(rawDt) {
    const m = this.boardMarker;
    if (!m) return;
    const show = this.world.area === 'guild' && !this.missions.active;
    m.marker.visible = show;
    if (!show) return;
    m.phase += rawDt;
    m.marker.rotation.y += rawDt * 1.7;
    m.marker.position.y = m.baseY + Math.sin(m.phase * 2.2) * 0.06;
    m.halo.scale.setScalar(1 + Math.sin(m.phase * 3.1) * 0.14);
  }

  // ------------------------------------------------------------ guide line

  /** Where should the player go next? */
  _objectiveTarget() {
    const inGuild = this.world.area === 'guild';
    if (inGuild) {
      if (!this.missions.active) {
        const b = this.world.guild.anchors.board;
        return { label: 'Mission board', x: b.x, z: b.z };
      }
      if (this.missions.isComplete) {
        const d = this.world.guild.anchors.desk;
        return { label: 'Maren', x: d.x, z: d.z };
      }
      const e = this.world.guildExitTrigger;
      return { label: 'Guild exit', x: e.x, z: e.z };
    }

    const mission = this.missions.active;
    if (mission && !this.missions.isComplete) {
      const region = regionById(mission.regionId);
      if (region) return { label: region.name, x: region.center[0], z: region.center[1] };
    }
    const [gx, gz] = this.world.city.guild.doorWorld;
    return { label: 'Guild hall', x: gx, z: gz };
  }

  /**
   * Compass arrow at the top of the screen. The bearing is taken against the
   * camera's view direction, so it turns as the player turns the camera.
   */
  _updateGuide() {
    if (this.state !== 'playing' || this.blocked) {
      this.ui.clearGuide();
      return;
    }
    const target = this._objectiveTarget();
    if (!target) {
      this.ui.clearGuide();
      return;
    }
    const p = this.player.root.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 2.8) {
      this.ui.clearGuide();
      return;
    }

    const bearing = Math.atan2(dx, dz);
    const view = Math.atan2(-Math.sin(this.cameraRig.yaw), -Math.cos(this.cameraRig.yaw));
    let rel = bearing - view;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.ui.setGuide(target.label, dist, -rel);
  }

  /**
   * Pick the music bed from what is happening: the boss theme when a warden is
   * near, the fight theme when anything else is within reach, the town theme
   * otherwise. Re-checked twice a second; the beds crossfade in Audio.
   */
  _updateMusic(dt) {
    this._musicTimer = (this._musicTimer || 0) - dt;
    if (this._musicTimer > 0) return;
    this._musicTimer = 0.5;

    let mode = 'town';
    if (this.world.area !== 'guild' && this.player && !this.player.dead) {
      const p = this.player.root.position;
      let boss = false;
      let fight = false;
      for (const e of this.enemies) {
        if (e.state === 'dead' || e.state === 'spawn') continue;
        const d = Math.hypot(e.root.position.x - p.x, e.root.position.z - p.z);
        if (d > 30) continue;
        if (e.def.boss) boss = true;
        else if (d < 22) fight = true;
      }
      if (boss) mode = 'boss';
      else if (fight) mode = 'combat';
    }
    this.audio.setMusic(mode);
  }

  async _spawnGuildNpcs() {
    const [ox, oy, oz] = INTERIOR_ORIGIN;
    const names = {
      receptionist: 'Maren',
      quartermaster: 'Bors',
      board: 'Sela',
      table1: 'Hollis',
      table2: 'Ivy',
      library: 'Corvin',
      training: 'Wren',
      idle: 'Dag',
    };
    const lines = {
      receptionist: ['Register first, then we talk contracts.'],
      quartermaster: ['Steel does not sharpen itself. Buy something.'],
      board: ['Board is fresh. Take your pick.'],
      table1: ['They say the Emberwood never stops smouldering. I say it is the monsters.'],
      table2: ['Third contract this week. Third blade ruined.'],
      library: ['Wardens. Big ones. There is a page on them somewhere.'],
      training: ['Watch the feet, not the blade.'],
      idle: ['Ravenshold is the last wall before the wild. Remember that.'],
    };

    for (const spot of this.world.guild.npcSpots) {
      const npc = new Npc({
        assets: this.assets,
        outfit: spot.outfit,
        role: spot.role,
        position: [ox + spot.x, oy, oz + spot.z],
        yaw: spot.yaw,
        name: names[spot.role] || 'Guild member',
        lines: lines[spot.role] || [],
      });
      npc.homeSpot = spot;
      this.scene.add(npc.root);
      this.npcs.push(npc);
    }
  }

  // ------------------------------------------------------------- lifecycle

  startRun() {
    this._clearEnemies();
    this.enemies.length = 0;
    this._missionId = null;
    this._spawnRegionId = null;

    this.progression = new Progression().load();
    this.missions = new MissionSystem(this.progression);

    this.kills = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.overTimer = 0;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this._overShown = false;
    this._registered = false;
    this._objectiveRegionId = null;

    this.player.progression = this.progression;
    this.player.reset();
    this.applyEquipment();

    this.world.exitGuild();
    const [sx, sz] = this.world.city.spawnPoint;
    this.player.root.position.set(sx, this.world.groundAt(sx, sz), sz);
    this.player.root.rotation.y = Math.PI;
    this.cameraRig.yaw = Math.PI;
    this.cameraRig.pitch = 0.26;
    this.cameraRig.snapTo(this.player.root.position);
    this.effects.clearFloaters();

    this.state = 'playing';
    this.blocked = true;
    this.ui.showGame();
    this.ui.setGold(this.progression.gold);
    this.ui.setLevel(this.progression.level);
    this.ui.setKills(0);
    this.ui.setRegion(CITY.name);
    this.ui.clearObjective();
    this.ui.setPrompt(null);
    this.audio.setMusic('town');

    this._playIntro();
  }

  /** Rebuild the sword and shield to match the current equipment. */
  applyEquipment() {
    this.player.setWeapon(this.progression.weaponDef);
    const shield = this.progression.shieldDef;
    if (shield.id === 'none') {
      this.player.setShield(null, null);
    } else {
      const tiers = {
        buckler: { scale: 0.85, tint: 0x8a6134 },
        kite: { scale: 1.0, tint: 0xb9c2cc, metalness: 0.55 },
        tower: { scale: 1.25, tint: 0xd6dde6, metalness: 0.7 },
      };
      this.player.setShield(this.shieldModel, tiers[shield.id] || {});
    }
    this.ui.setEquipment(this.progression.weaponDef.name, shield.name);
  }

  _pauseStats() {
    return {
      gold: this.progression.gold,
      level: this.progression.level,
      kills: this.kills,
      missions: this.progression.missionsDone,
      weapon: this.progression.weaponDef.name,
      fps: this.engine.fps,
    };
  }

  _showPauseScreen() {
    this.ui.showPause(this._pauseStats());
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.engine.setPaused(true);
    this.input.releaseLock();
    this._showPauseScreen();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.engine.setPaused(false);
    this.ui.hideScreens();
    this.ui.showGame();
    this.input.requestLock();
  }

  // ------------------------------------------------------------ save branches

  /** Open the four manual branches from the pause screen. */
  openSaves() {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this._openSavePanel();
  }

  _openSavePanel(message = '') {
    this.ui.openSaves({
      slots: allSlots(),
      message,
      onSave: (index) => {
        if (this.saveToSlot(index)) this._openSavePanel(`Saved to branch ${index + 1}.`);
        else this._openSavePanel('Could not save — browser storage is full.');
      },
      onLoad: (index) => {
        if (!this.loadFromSlot(index)) this._openSavePanel('That branch could not be loaded.');
      },
      onClear: (index) => {
        clearSlot(index);
        this._openSavePanel(`Branch ${index + 1} cleared.`);
      },
      onClose: () => this.closeSavePanel(),
    });
  }

  /** Back out of the save panel to the pause menu. */
  closeSavePanel() {
    this.ui.closePanel();
    this._showPauseScreen();
  }

  /** Snapshot the whole run into one of four branches. */
  saveToSlot(index) {
    const p = this.player;
    const inGuild = this.world.area === 'guild';
    const location = inGuild
      ? 'Guild hall'
      : (this.world.regionAt(p.root.position.x, p.root.position.z)?.name || CITY.name);
    const data = {
      v: 1,
      savedAt: Date.now(),
      name: p.name || 'Ranger',
      registered: !!this._registered,
      kills: this.kills,
      elapsed: this.elapsed,
      health: p.health,
      stamina: p.stamina,
      area: this.world.area,
      pos: [p.root.position.x, p.root.position.z],
      yaw: p.root.rotation.y,
      camera: { yaw: this.cameraRig.yaw, pitch: this.cameraRig.pitch },
      progression: this.progression.toJSON(),
      missions: {
        offers: this.missions.offers,
        active: this.missions.active,
        completed: this.missions.completed,
      },
      summary: {
        name: p.name || 'Ranger',
        level: this.progression.level,
        gold: this.progression.gold,
        weapon: this.progression.weaponDef.name,
        location,
        mission: this.missions.trackerText || 'No contract',
      },
    };
    return writeSlot(index, data);
  }

  /** Restore a branch: wallet, equipment, contract, place, health and camera. */
  loadFromSlot(index) {
    const data = readSlot(index);
    if (!data || !data.progression) return false;

    const progression = new Progression().restore(data.progression);
    const missions = new MissionSystem(progression).restore(data.missions || {});
    this.progression = progression;
    this.missions = missions;
    this.player.progression = progression;
    this.applyEquipment();

    const p = this.player;
    p.name = typeof data.name === 'string' && data.name.trim() ? data.name : 'Ranger';
    this._registered = !!data.registered;
    this.kills = Number.isFinite(data.kills) ? data.kills : 0;
    this.elapsed = Number.isFinite(data.elapsed) ? data.elapsed : 0;
    this.combo = 0;
    this.comboTimer = 0;
    this._overShown = false;
    this.blocked = false;

    p.dead = false;
    p.state = 'idle';
    p.stateTime = 0;
    p.activeAttack = null;
    p.hitThisSwing.clear();
    p.bufferedAttack = false;
    p.guarding = false;
    p.guardBroken = 0;
    p.staminaLock = 0;
    p.invulnerable = 0;
    p.velocity.set(0, 0, 0);
    p.impulse.set(0, 0, 0);
    p.frozen = false;
    const hp = Number.isFinite(data.health) ? data.health : progression.maxHealth;
    const st = Number.isFinite(data.stamina) ? data.stamina : progression.maxStamina;
    p.health = Math.min(progression.maxHealth, Math.max(1, hp));
    p.stamina = Math.min(progression.maxStamina, Math.max(0, st));

    const inGuild = data.area === 'guild';
    if (inGuild) {
      if (this.world.area !== 'guild') this.world.enterGuild();
      this._setEnemiesVisible(false);
    } else {
      if (this.world.area === 'guild') this.world.exitGuild();
      this._setEnemiesVisible(true);
    }

    const x = Array.isArray(data.pos) && Number.isFinite(data.pos[0]) ? data.pos[0] : 0;
    const z = Array.isArray(data.pos) && Number.isFinite(data.pos[1]) ? data.pos[1] : 0;
    p.root.position.set(x, this.world.groundAt(x, z), z);
    this.world.clampToWorld(p.root.position);
    p.root.rotation.y = Number.isFinite(data.yaw) ? data.yaw : (inGuild ? Math.PI : 0);
    this.cameraRig.yaw = Number.isFinite(data.camera?.yaw) ? data.camera.yaw : p.root.rotation.y;
    this.cameraRig.pitch = Number.isFinite(data.camera?.pitch) ? data.camera.pitch : 0.26;
    this.cameraRig.snapTo(p.root.position);
    p.velocity.set(0, 0, 0);
    p.impulse.set(0, 0, 0);
    if (p.clips?.idle) p.play('idle', { clip: p.clips.idle, fade: 0.2, restart: true });

    this._clearEnemies();
    this.enemies.length = 0;
    this._missionId = missions.active ? missions.active.id : null;
    this._spawnRegionId = null;

    const region = inGuild
      ? { name: 'Guild hall' }
      : (this.world.regionAt(p.root.position.x, p.root.position.z) || CITY);
    this.ui.setRegion(region.name);
    this.ui.setGold(progression.gold);
    this.ui.setLevel(progression.level);
    this.ui.setKills(this.kills);
    this.ui.setHealth(p.healthFraction);
    this.ui.setHealthMax(p.health, progression.maxHealth);
    this.ui.setStamina(p.staminaFraction);
    this.ui.setCombo(0);
    this.ui.setPrompt(null);
    this.effects.clearFloaters();
    this._refreshObjective();
    progression.save();

    const needsRegistration = inGuild && !this._registered;
    this.ui.closePanel();
    this.dialogue.skip();
    if (this.state === 'paused') this.resume();
    else {
      this.state = 'playing';
      this.engine.setPaused(false);
      this.ui.showGame();
    }
    if (needsRegistration) this._startRegistration();
    this.ui.banner(`Branch ${index + 1} loaded`, `${region.name} · Level ${progression.level}`);
    return true;
  }

  toTitle() {
    this.state = 'title';
    this.engine.setPaused(false);
    this.dialogue.skip();
    this.blocked = false;
    this.ui.showTitle();
  }

  onPlayerDeath() {
    this.state = 'over';
    this.overTimer = 0;
    this.engine.addShake(0.8);
    this.effects.screenFlash(0.55);
  }

  // -------------------------------------------------------------- cutscene

  _playIntro() {
    this.cutscene = new Cutscene({
      camera: this.engine.camera,
      dialogue: this.dialogue,
      onObjective: (text) => this.ui.setObjective(text, 'The Guild hall stands on the north side of the square.'),
      onFinish: () => {
        this.blocked = false;
        this.ui.setObjective('Enter the Guild hall', 'North side of the square, past the market stalls.');
        // the rig has been idle during the cutscene; put it behind the player
        // before handing control back so the camera does not snap
        this.cameraRig.yaw = Math.PI;
        this.cameraRig.pitch = 0.26;
        this.cameraRig.snapTo(this.player.root.position);
        this.input.requestLock();
      },
    });
    const guildPos = [this.world.city.guild.center[0], this.world.city.guild.center[1]];
    this.cutscene.play(introCutscene(CITY.name, guildPos));
  }

  // ----------------------------------------------------------------- areas

  enterGuild() {
    this.ui.transition(() => {
      this.world.enterGuild();
      // combat is suspended indoors: the pack waits outside (and never gets
      // clamped into the room by the interior bounds)
      this._setEnemiesVisible(false);

      // a safe haven: walking in is a full rest
      this.player.health = this.progression.maxHealth;
      this.player.stamina = this.progression.maxStamina;
      this.player.guardBroken = 0;
      this.player.staminaLock = 0;
      this.ui.setHealth(1);
      this.ui.setStamina(1);

      const p = this.world.guildEntryPoint;
      this.player.root.position.copy(p);
      this.player.root.rotation.y = Math.PI;
      this.player.velocity.set(0, 0, 0);
      this.cameraRig.yaw = Math.PI;
      this.cameraRig.snapTo(p);
      this.ui.setRegion('Guild hall');
      this.ui.clearObjective();

      if (!this._registered) {
        this._startRegistration();
      } else if (this.missions.isComplete) {
        this.ui.setObjective('Collect your pay', 'Speak to Maren at the desk.');
      } else if (this.missions.active) {
        this.ui.setObjective('Contract in progress', this.missions.trackerText);
      } else {
        this.ui.setObjective('Take a contract', 'The board is on the west wall.');
      }
    });
  }

  exitGuild() {
    this.ui.transition(() => {
      this.world.exitGuild();
      this._setEnemiesVisible(true);
      const [gx, gz] = this.world.city.guild.doorWorld;
      this.player.root.position.set(gx, this.world.groundAt(gx, gz), gz + 2.5);
      this.player.velocity.set(0, 0, 0);
      this.cameraRig.yaw = 0;
      this.cameraRig.snapTo(this.player.root.position);
      this.ui.setRegion(CITY.name);
      this._refreshObjective();
    });
  }

  /**
   * Teleport to a region's waystone, or back to the city gate. Travelling from
   * inside the guild steps outside first, so accepting a contract and leaving
   * is one action rather than "walk out, then open the map".
   */
  travelTo(id) {
    this.ui.closePanel();
    const fromGuild = this.world.area === 'guild';

    this.ui.transition(() => {
      if (fromGuild) this.world.exitGuild();

      if (id === 'city') {
        const [gx, gz] = this.world.city.spawnPoint;
        this.player.root.position.set(gx, this.world.groundAt(gx, gz), gz);
        this.ui.setRegion(CITY.name);
      } else {
        const region = regionById(id);
        if (!region) return;
        // land just inside the region's inner edge, facing its centre. The
        // regions sit at radius 168 with a 92 radius, so the near edge is
        // around radius 76.
        const bearing = Math.atan2(region.center[0], region.center[1]);
        const r = 88;
        const px = Math.sin(bearing) * r;
        const pz = Math.cos(bearing) * r;
        this.player.root.position.set(px, this.world.groundAt(px, pz), pz);
        this.player.root.rotation.y = bearing;
        this.cameraRig.yaw = bearing + Math.PI;
        this.ui.setRegion(region.name);
      }
      this.player.velocity.set(0, 0, 0);
      this.cameraRig.snapTo(this.player.root.position);
      this._refreshObjective();
    });
  }

  _refreshObjective() {
    const inGuild = this.world.area === 'guild';
    const m = this.missions.active;

    if (!m) {
      this._objectiveRegionId = null;
      if (inGuild) this.ui.setObjective('Take a contract', 'The mission board is on the left wall, past the desk.');
      else this.ui.setObjective('Return to the guild', 'Take a new contract from the board.');
      return;
    }

    this._objectiveRegionId = m.regionId;
    if (m.progress >= m.target) {
      this.ui.setObjective('Contract complete', 'Return to the guild hall and collect your pay.');
      return;
    }
    this.ui.setObjective(m.title, m.description, { value: m.progress, max: m.target });
  }

  // ---------------------------------------------------------- interactions

  /** What, if anything, the player can interact with right now. */
  _nearestInteraction() {
    const p = this.player.root.position;

    if (this.world.area === 'guild') {
      // the board wins over the NPC standing next to it: players walk up to the
      // board to take a contract, not to chat with the keeper
      const board = this.world.guild.anchors.board;
      if (Math.hypot(p.x - board.x, p.z - board.z) < 3.0) {
        return { kind: 'board', label: 'Mission board' };
      }

      const npc = Npc.nearest(this.npcs, p.x, p.z, 3.4);
      if (npc) {
        if (npc.role === 'receptionist') {
          return { kind: 'receptionist', label: 'Speak with Maren', npc };
        }
        if (npc.role === 'quartermaster') {
          return { kind: 'quartermaster', label: 'Quartermaster — equipment & training', npc };
        }
        return { kind: 'npc', label: `Speak with ${npc.displayName}`, npc };
      }

      const exit = this.world.guildExitTrigger;
      if (Math.hypot(p.x - exit.x, p.z - exit.z) < 2.0) {
        return { kind: 'exit', label: 'Leave the guild hall' };
      }
      return null;
    }

    // outside: the guild door, then the gate waystone
    const door = this.world.city.guild.doorWorld;
    if (Math.hypot(p.x - door[0], p.z - door[1]) < 3.6) {
      return { kind: 'guildDoor', label: 'Enter the Guild hall' };
    }

    const [gx, gz] = this.world.city.gate;
    if (Math.hypot(p.x - gx, p.z - gz) < 5.5) {
      return { kind: 'waystone', label: 'Waystone — travel' };
    }

    return null;
  }

  _interact() {
    const target = this._nearestInteraction();
    if (!target) return;
    this.audio.uiClick();

    switch (target.kind) {
      case 'guildDoor': this.enterGuild(); break;
      case 'exit': this.exitGuild(); break;
      case 'board': this.openBoard(); break;
      case 'quartermaster': this.openShop(); break;
      case 'receptionist': this._talkReceptionist(); break;
      case 'npc': this._talkTo(target.npc); break;
      case 'waystone': this.openMap(); break;
      default: break;
    }
  }

  // -------------------------------------------------------------- dialogue

  _startRegistration() {
    this._registered = true;
    const player = this.player;
    this.dialogue.start([
      { speaker: 'Maren', text: 'Next. Yes, you — the one with the sword.' },
      { speaker: 'Maren', text: 'You want work, you register first. Guild rules. Name?' },
      {
        input: true,
        speaker: 'You',
        label: 'Sign the ledger',
        placeholder: 'Ranger',
        required: true,
        onSubmit: (name) => {
          player.name = name || 'Ranger';
        },
      },
      { speaker: 'Maren', text: 'Right. Sign here — or make your mark, I am not fussy.' },
      { speaker: 'Maren', text: () => `Entered in the ledger. Welcome to the guild, ${player.name}.` },
      { speaker: 'Maren', text: 'Pay is by the contract and the contract is by the head. Board is on the left wall, past my desk.' },
      { speaker: 'Maren', text: 'Take one. Come back breathing, and we settle up.' },
      { speaker: 'Maren', text: 'And — see Bors the quartermaster before you go. You will want better steel than that.' },
    ], {
      onComplete: () => {
        this.ui.banner('Registered', `Guild ledger — ${this.player.name}`);
        this.ui.setObjective('Take a contract', 'The mission board is on the left wall, past the desk.');
        this.ui.setPrompt(null);
      },
    });
  }

  _talkReceptionist() {
    if (this.missions.isComplete) {
      this._turnInMission();
      return;
    }
    if (!this.missions.active) {
      this.dialogue.start([
        { speaker: 'Maren', text: 'No contract? Then you are costing me coin standing there.' },
        { speaker: 'Maren', text: 'Board is on the left wall, past my desk. Take something.' },
      ], { onComplete: () => { this.ui.setObjective('Take a contract', 'The mission board is on the left wall, past the desk.'); } });
      return;
    }
    const m = this.missions.active;
    this.dialogue.start([
      { speaker: 'Maren', text: `${m.title}. ${m.progress} of ${m.target} done.` },
      { speaker: 'Maren', text: m.type === 'elite'
        ? 'A Warden is not a wolf. Do not fight it tired.'
        : 'Keep at it. The board does not clear itself.' },
    ]);
  }

  _turnInMission() {
    const mission = this.missions.turnIn();
    if (!mission) return;
    this.ui.setGold(this.progression.gold);
    this.ui.setLevel(this.progression.level);
    this.effects.screenFlash(0.18);
    this.audio.waveClear();

    this.dialogue.start([
      { speaker: 'Maren', text: 'Back, and in one piece. Let me see.' },
      { speaker: 'Maren', text: `Contract closed. ${mission.gold} gold, and the ledger notes you did it clean.` },
      { speaker: 'Maren', text: 'Bors will have your pick of the rack. Spend it before you lose it.' },
    ], {
      onComplete: () => {
        this.ui.banner('Contract complete', `+${mission.gold} gold`);
        this._refreshObjective();
        this.openBoard();
      },
    });
  }

  _talkTo(npc) {
    const lines = (npc.lines && npc.lines.length)
      ? npc.lines.map((t) => ({ speaker: npc.displayName, text: t }))
      : [{ speaker: npc.displayName, text: '...' }];
    this.dialogue.start(lines);
  }

  // ----------------------------------------------------------------- panels

  openBoard() {
    this.blocked = true;
    this.input.releaseLock();
    this.ui.openMissionBoard({
      offers: this.missions.offersForDisplay,
      active: this.missions.active,
      onAccept: (id) => {
        this.missions.accept(id);
        const m = this.missions.active;
        this.ui.closePanel();
        this.blocked = false;
        this.input.requestLock();
        this.audio.uiClick();
        this.ui.banner('Contract accepted', m.title);
        this._objectiveRegionId = m.regionId;
        this.ui.setObjective('Travel to ' + m.regionName, 'Open the map with M, or ride out the gate.', { value: 0, max: m.target });
      },
      onAbandon: () => {
        this.missions.abandon();
        this.ui.closePanel();
        this.blocked = false;
        this.input.requestLock();
        this.openBoard();
      },
    });
    this.ui.el.panelClose.onclick = () => {
      this.ui.closePanel();
      this.blocked = false;
      this.input.requestLock();
    };
  }

  openShop() {
    this.blocked = true;
    this.input.releaseLock();
    const refresh = () => this.ui.openShop({
      progression: this.progression,
      onBuyUpgrade: (track) => {
        const before = this.progression.maxHealth;
        if (this.progression.buyUpgrade(track)) {
          // buying Vitality should hand over the new hit points, not leave a gap
          const gained = this.progression.maxHealth - before;
          if (gained > 0) this.player.health += gained;
        }
        this._afterPurchase(refresh);
      },
      onBuyWeapon: (id) => { this.progression.buyWeapon(id); this._afterPurchase(refresh); },
      onBuyShield: (id) => { this.progression.buyShield(id); this._afterPurchase(refresh); },
      onClose: () => { this.ui.closePanel(); this.blocked = false; this.input.requestLock(); },
    });
    refresh();
  }

  _afterPurchase(refresh) {
    this.audio.uiClick();
    this.applyEquipment();
    this.player.health = Math.min(this.player.health, this.progression.maxHealth);
    this.player.stamina = Math.min(this.player.stamina, this.progression.maxStamina);
    this.ui.setGold(this.progression.gold);
    refresh();
  }

  openMap() {
    this.blocked = true;
    this.input.releaseLock();
    this.ui.openMap({
      playerPos: this.player.root.position,
      objectiveRegionId: this._objectiveRegionId,
      objective: this._objectiveTarget(),
      currentArea: this.world.area,
      onTravel: (id) => {
        this.ui.closePanel();
        this.blocked = false;
        this.input.requestLock();
        this.travelTo(id);
      },
    });
    this.ui.el.mapClose.onclick = () => {
      this.ui.closePanel();
      this.blocked = false;
      this.input.requestLock();
    };
  }

  closePanels() {
    if (!this.ui.panelOpen) return false;
    this.ui.closePanel();
    this.blocked = false;
    this.input.requestLock();
    return true;
  }

  // ---------------------------------------------------------------- combat

  resolvePlayerSwing(player, attack, hitSet) {
    const origin = player.root.position;
    const yaw = player.root.rotation.y;
    const reach = attack.range;
    const halfArc = attack.arc * 0.5;
    const heavy = attack.key === 'heavy';
    const baseDamage = this.progression.attackDamage * attack.damageScale;

    // collect first, then resolve nearest-first with cleave falloff so a wide
    // swing hurts the pack without deleting every mob in the same frame
    const targets = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (hitSet.has(e) || e.state === 'dead' || e.state === 'spawn') continue;

      const dx = e.root.position.x - origin.x;
      const dz = e.root.position.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + e.radius) continue;

      const angle = Math.atan2(dx, dz);
      let diff = angle - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > halfArc) continue;

      targets.push({ e, dx, dz, dist });
    }
    targets.sort((a, b) => a.dist - b.dist);

    const FALLOFF = [1, 0.7, 0.55, 0.45];
    for (let n = 0; n < targets.length; n++) {
      const { e, dx, dz, dist } = targets[n];
      hitSet.add(e);

      const spread = FALLOFF[Math.min(n, FALLOFF.length - 1)];
      const crit = Math.random() < 0.16;
      const damage = Math.max(1, Math.round(
        baseDamage * spread * (crit ? 1.9 : 1) * (0.92 + Math.random() * 0.16),
      ));
      const killed = e.takeDamage(damage, origin.x, origin.z, attack.knock, crit);

      const hx = e.root.position.x;
      const hy = e.root.position.y + e.height * 0.55 * e.def.scale;
      const hz = e.root.position.z;

      this.effects.impact(hx, hy, hz, dx / (dist || 1), dz / (dist || 1), {
        heavy: heavy || crit,
        color: crit ? 0xffe08a : 0xffc07a,
      });
      this.effects.number(new THREE.Vector3(hx, hy, hz), String(damage), crit ? 'crit' : 'enemy');

      this.audio.hit(heavy || crit);
      this.engine.hitStop(heavy ? 0.1 : 0.055);
      this.engine.addShake(heavy ? 0.45 : 0.22);

      this.combo++;
      this.comboTimer = 2.6;
      this.ui.setCombo(this.combo);

      if (killed) this._onKill(e);
    }
  }

  _onKill(enemy) {
    this.kills++;
    this.progression.kills++;
    this.ui.setKills(this.kills);

    const region = this.world.regionAt(enemy.root.position.x, enemy.root.position.z);
    const counted = this.missions.onKill(enemy.type, region ? region.id : null);
    if (counted) this._refreshObjective();

    if (enemy.def.boss) {
      this.ui.banner('Warden slain', 'The pack will scatter');
      this.effects.screenFlash(0.4);
      this.engine.addShake(0.7);
    }

    if (this.missions.isComplete && this.missions.active) {
      this.ui.banner('Contract complete', 'Return to the guild for your pay');
    }
  }

  nearestEnemy(x, z, maxDist, maxArc, facingYaw) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.state === 'dead' || e.state === 'spawn') continue;
      const dx = e.root.position.x - x;
      const dz = e.root.position.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD) continue;
      if (maxArc < Math.PI) {
        const angle = Math.atan2(dx, dz);
        let diff = angle - facingYaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) > maxArc * 0.5) continue;
      }
      bestD = d2;
      best = e;
    }
    return best;
  }

  // -------------------------------------------------------------- spawning

  _spawnEnemy(type, x, z) {
    const pool = this.pools[type];
    let enemy = pool.find((e) => !e.active);
    if (!enemy) {
      enemy = new Enemy({ assets: this.assets, world: this.world, game: this, type });
      this.scene.add(enemy.root);
      pool.push(enemy);
    }
    enemy.spawn(x, z);
    this.enemies.push(enemy);
    return enemy;
  }

  onEnemyRemoved(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
  }

  /**
   * Keep a population alive around the player while they are in a region.
   * A contract raises the cap and adds an elite; without one the wilds are
   * merely dangerous rather than hostile.
   */
  _updateSpawning(dt) {
    this._syncMissionEnemies();

    const p = this.player.root.position;
    const region = this.world.regionAt(p.x, p.z);

    // the city is a safe zone: the pack loses interest at the walls
    if (!region || region.id === CITY.id) {
      this._spawnRegionId = null;
      if (region && this.enemies.length) this._clearEnemies();
      return;
    }

    // cull anything the player has walked away from
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.root.position.x - p.x, e.root.position.z - p.z);
      if (d > SPAWN.despawnAt) { e.despawn(); this.onEnemyRemoved(e); }
    }

    if (this.player.dead) return;

    const mission = this.missions.active;
    if (!mission || mission.regionId !== region.id) {
      this._spawnRegionId = null;
      return;
    }

    // the contract is met: whatever is left of the pack scatters
    if (this.missions.isComplete) {
      if (this.enemies.length) this._clearEnemies();
      return;
    }

    const entered = this._spawnRegionId !== region.id;
    this._spawnRegionId = region.id;
    if (!entered || this.enemies.length > 0) return;

    this._spawnMissionPack(mission, region, p);
  }

  /** Spawn the finite pack for this visit: remaining kills plus a buffer. */
  _spawnMissionPack(mission, region, p) {
    const table = BIOME_POPULATION[region.biome] || BIOME_POPULATION.forest;
    const types = [];
    if (mission.type === 'elite') {
      types.push('warden');
      for (let i = 0; i < SPAWN.eliteGuards; i++) types.push(this._rollMob(table));
    } else {
      const remaining = Math.max(1, mission.target - mission.progress);
      for (let i = 0; i < remaining + SPAWN.buffer; i++) types.push(this._rollMob(table));
    }

    let spawned = 0;
    for (const type of types) {
      const spot = this._findSpawnPoint(p, region);
      if (!spot) continue;
      this._spawnEnemy(type, spot[0], spot[1]);
      spawned++;
    }

    if (spawned && !mission._announced) {
      mission._announced = true;
      this.ui.banner(
        mission.type === 'elite' ? 'A Warden stirs' : 'The wilds are hunting',
        region.name,
      );
    }
  }

  _rollMob(table) {
    let roll = Math.random();
    for (const [type, weight] of table) {
      if (roll < weight) return type;
      roll -= weight;
    }
    return 'imp';
  }

  /**
   * A spawn point inside the mission region, at a readable distance from the
   * player. If they are hugging the region edge it falls back toward the centre
   * instead of spawning in the neighbouring biome.
   */
  _findSpawnPoint(p, region) {
    const [cx, cz] = region.center;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = SPAWN.spawnAt[0] + Math.random() * (SPAWN.spawnAt[1] - SPAWN.spawnAt[0]);
      let x = p.x + Math.cos(a) * r;
      let z = p.z + Math.sin(a) * r;
      if (this.world.regionAt(x, z)?.id === region.id) return [x, z];

      const dx = cx - p.x;
      const dz = cz - p.z;
      const len = Math.hypot(dx, dz) || 1;
      x = p.x + (dx / len) * r;
      z = p.z + (dz / len) * r;
      if (this.world.regionAt(x, z)?.id === region.id) return [x, z];
    }
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * region.radius * 0.6;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    return this.world.regionAt(x, z)?.id === region.id ? [x, z] : null;
  }

  /** Combat is suspended indoors: the pack waits outside, hidden. */
  _setEnemiesVisible(visible) {
    for (const e of this.enemies) e.root.visible = visible;
  }

  /** Drop the living pack; corpses are left to finish their death animation. */
  _clearEnemies() {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === 'dead') continue;
      e.despawn();
      this.onEnemyRemoved(e);
    }
  }

  /** A new contract (or turning one in) wipes the previous pack. */
  _syncMissionEnemies() {
    const id = this.missions.active ? this.missions.active.id : null;
    if (id === this._missionId) return;
    this._missionId = id;
    this._spawnRegionId = null;
    this._clearEnemies();
  }

  // ----------------------------------------------------------------- update

  update(dt, rawDt) {
    this.elapsed += rawDt;
    if (this.state !== 'playing') this.ui.clearGuide();
    this.audio.setMusicDuck(
      this.state !== 'playing' || this.blocked || this.dialogue.active || this.ui.panelOpen,
    );

    if (this.state === 'title') {
      this._titleCamera(rawDt);
      this.effects.update(dt, rawDt);
      return;
    }

    if (this.state === 'paused') {
      this.effects.update(0, 0);
      return;
    }

    // cutscene owns the camera while it runs
    if (this.cutscene && this.cutscene.active) {
      if (this.input.wasPressed('Escape')) this.cutscene.skip();
      this._handleDialogueInput();
      this.blocked = true;
      this.cutscene.update(rawDt);
      this.player.frozen = true;
      this.player.update(dt);
      this.effects.update(dt, rawDt);
      this.world.update(dt, rawDt, this.player.root.position, this.engine.camera);
      this.ui.update(rawDt);
      return;
    }

    if (this.state === 'over') {
      this.overTimer += rawDt;
      this.player.update(dt);
      if (this.world.area !== 'guild') {
        for (const e of this.enemies) e.update(dt);
      }
      this.cameraRig.update(dt, this.player.root.position, { frozen: this.blocked });
      this.effects.update(dt, rawDt);
      this.world.update(dt, rawDt, this.player.root.position, this.engine.camera);
      this.ui.update(rawDt);
      if (this.overTimer > 2.4 && !this._overShown) {
        this._overShown = true;
        this.ui.showGameOver({
          title: this.progression.missionsDone >= 3 ? 'The guild will want a word' : 'You fell',
          subtitle: `${this.progression.missionsDone} contract${this.progression.missionsDone === 1 ? '' : 's'} fulfilled`,
          gold: this.progression.gold,
          level: this.progression.level,
          kills: this.kills,
          missions: this.progression.missionsDone,
          weapon: this.progression.weaponDef.name,
        });
      }
      return;
    }

    // ---------------------------------------------------------- playing
    this._handleInput();
    this.player.frozen = this.blocked;
    this.player.update(dt);

    const inGuild = this.world.area === 'guild';
    if (!inGuild) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        this.enemies[i].update(dt);
      }
    }
    if (inGuild) {
      for (const n of this.npcs) n.update(dt, this.player.root.position);
    }

    if (!inGuild) this._updateSpawning(dt);

    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 0;
        this.ui.setCombo(0);
      }
    }

    this.cameraRig.update(dt, this.player.root.position, {
      sprinting: this.player.sprinting,
      frozen: this.blocked,
    });
    this.effects.update(dt, rawDt);
    this.world.update(dt, rawDt, this.player.root.position, this.engine.camera);
    this._updateBoardMarker(rawDt);
    this._updateGuide();
    this._updateMusic(dt);

    this._updateHud();
    this.ui.update(rawDt);
  }

  /** Advance the dialogue queue, if one is showing. */
  _handleDialogueInput() {
    if (!this.dialogue.active) return false;
    if (this.input.wasPressed('KeyE') || this.input.wasPressed('Space')) {
      // an input line waits for its submit button, not for a keypress
      if (!this.dialogue.isInput) this.dialogue.next();
    }
    if (this.input.wasPressed('Escape')) this.dialogue.skip();
    return true;
  }

  _handleInput() {
    if (this._handleDialogueInput()) return;

    if (this.ui.panelOpen) {
      if (this.input.wasPressed('Escape') || this.input.wasPressed('KeyM')) this.closePanels();
      return;
    }

    if (this.input.wasPressed('KeyE') && this._nearestInteraction()) {
      this._interact();
      return;
    }

    if (this.input.wasPressed('KeyM')) {
      this.openMap();
      return;
    }

    if (this.input.wasPressed('Escape')) {
      this.pause();
    }
  }

  _updateHud() {
    const p = this.player;
    this.ui.setHealth(p.healthFraction);
    this.ui.setHealthMax(p.health, this.progression.maxHealth);
    this.ui.setStamina(p.staminaFraction);
    this.ui.setGold(this.progression.gold);
    this.ui.setLevel(this.progression.level);

    // interaction prompt
    const target = this.blocked ? null : this._nearestInteraction();
    this.ui.setPrompt(target ? target.label : null);

    const region = this.world.area === 'guild'
      ? { name: 'Guild hall' }
      : (this.world.regionAt(p.root.position.x, p.root.position.z) || CITY);
    this.ui.setRegion(region.name || CITY.name);

    this.ui.setLockOn(this.blocked ? null : this.nearestEnemy(
      p.root.position.x, p.root.position.z, 9, Math.PI * 0.95, p.root.rotation.y,
    ), this.engine.camera);
  }

  _titleCamera(rawDt) {
    const t = this.elapsed * 0.07;
    const r = 46;
    const cam = this.engine.camera;
    cam.position.set(Math.cos(t) * r, 16 + Math.sin(t * 0.7) * 2.5, Math.sin(t) * r);
    cam.lookAt(0, 4, 0);
  }
}

export { ENEMY_TYPES, REGIONS, biomeAt };
