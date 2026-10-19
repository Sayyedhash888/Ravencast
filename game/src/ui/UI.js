import * as THREE from 'three';
import { CITY, REGIONS } from '../game/world/Regions.js';
import { WEAPONS, SHIELDS, UPGRADE_TRACKS } from '../game/Progression.js';

/**
 * Every piece of DOM the game touches, in one place.
 *
 * The HUD only ever writes transforms and text (never layout), and the panels
 * are rebuilt wholesale when opened, which keeps this class free of per-frame
 * work beyond the handful of bars and the objective tracker.
 */
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);

    this.el = {
      hud: $('hud'),
      regionName: $('region-name'),
      gold: $('gold'),
      level: $('level'),
      kills: $('kills'),
      banner: $('wave-banner'),

      tracker: $('tracker'),
      trackerTitle: $('tracker-title'),
      trackerBody: $('tracker-body'),

      guide: $('guide'),
      guideArrow: $('guide-arrow'),
      guideLabel: $('guide-label'),
      guideDist: $('guide-dist'),

      prompt: $('prompt'),
      promptText: $('prompt-text'),

      healthFill: $('health-fill'),
      healthGhost: $('health-ghost'),
      healthText: $('health-text'),
      staminaFill: $('stamina-fill'),
      equipWeapon: $('equip-weapon'),
      equipShield: $('equip-shield'),
      combo: $('combo'),
      comboCount: $('combo-count'),
      lockon: $('lockon'),
      vignette: $('vignette'),

      dialogue: $('dialogue'),
      dialogueSpeaker: $('dialogue-speaker'),
      dialogueText: $('dialogue-text'),
      dialogueInput: $('dialogue-input'),
      dialogueLabel: $('dialogue-label'),
      dialogueField: $('dialogue-field'),
      dialogueSubmit: $('dialogue-submit'),
      dialogueHint: $('dialogue-hint'),

      panel: $('panel'),
      panelTitle: $('panel-title'),
      panelSub: $('panel-sub'),
      panelBody: $('panel-body'),
      panelClose: $('panel-close'),

      map: $('map-screen'),
      mapCanvas: $('map-canvas'),
      mapMarkers: $('map-markers'),
      mapSub: $('map-sub'),
      mapClose: $('map-close'),

      fade: $('fade'),
      loader: $('loader'),
      loaderFill: $('loader-fill'),
      loaderText: $('loader-text'),

      screenTitle: $('screen-title'),
      screenPause: $('screen-pause'),
      screenOver: $('screen-over'),
      pauseStats: $('pause-stats'),
      overStats: $('over-stats'),
      overTitle: $('over-title'),
      overSub: $('over-sub'),
    };

    this._ghost = 1;
    this._health = 1;
    this._damagePulse = 0;
    this._bannerTimer = null;
    this._lockVec = new THREE.Vector3();
    this._mapCtx = this.el.mapCanvas.getContext('2d');
    this._handlers = {};
  }

  // --------------------------------------------------------------- loading

  setLoadProgress(p, label) {
    this.el.loaderFill.style.width = `${Math.round(THREE.MathUtils.clamp(p, 0, 1) * 100)}%`;
    if (label) this.el.loaderText.textContent = label;
  }

  hideLoader() {
    this.el.loader.classList.add('done');
    setTimeout(() => { this.el.loader.style.display = 'none'; }, 600);
  }

  // --------------------------------------------------------------- screens

  hideScreens() {
    this.el.screenTitle.classList.add('hidden');
    this.el.screenPause.classList.add('hidden');
    this.el.screenOver.classList.add('hidden');
    this.closePanel();
    this.el.map.classList.add('hidden');
  }

  showTitle() {
    this.hideScreens();
    this.el.screenTitle.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
  }

  showGame() {
    this.hideScreens();
    this.el.hud.classList.remove('hidden');
  }

  showPause(stats) {
    this.el.pauseStats.innerHTML = this._statsMarkup(stats);
    this.el.screenPause.classList.remove('hidden');
  }

  hidePause() {
    this.el.screenPause.classList.add('hidden');
  }

  showGameOver(stats) {
    this.el.overTitle.textContent = stats.title || 'You fell';
    this.el.overSub.textContent = stats.subtitle || '';
    this.el.overStats.innerHTML = this._statsMarkup(stats);
    this.el.screenOver.classList.remove('hidden');
  }

  _statsMarkup({ gold, level, kills, missions, weapon, fps }) {
    return `
      <span class="k">Gold</span><span class="v">${(gold ?? 0).toLocaleString()}</span>
      <span class="k">Level</span><span class="v">${level ?? 1}</span>
      <span class="k">Contracts fulfilled</span><span class="v">${missions ?? 0}</span>
      <span class="k">Creatures slain</span><span class="v">${kills ?? 0}</span>
      ${weapon ? `<span class="k">Blade</span><span class="v">${weapon}</span>` : ''}
      ${fps ? `<span class="k">Frame rate</span><span class="v">${fps} fps</span>` : ''}
    `;
  }

  // ------------------------------------------------------------------- hud

  setRegion(name) { this.el.regionName.textContent = name; }
  setGold(n) {
    if (n === this._gold) return;
    this._gold = n;
    this.el.gold.textContent = n.toLocaleString();
  }

  setLevel(n) {
    if (n === this._level) return;
    this._level = n;
    this.el.level.textContent = String(n);
  }

  setKills(n) {
    if (n === this._kills) return;
    this._kills = n;
    this.el.kills.textContent = String(n);
  }

  /** `frac` drives the bar; the numeric label comes from setHealthMax. */
  setHealth(frac) {
    if (frac < this._health) this._damagePulse = 1;
    if (frac === this._health) return;
    this._health = frac;
    this.el.healthFill.style.transform = `scaleX(${Math.max(0, frac)})`;
  }

  setHealthMax(current, max) {
    const text = `${Math.max(0, Math.ceil(current))} / ${Math.round(max)}`;
    if (text === this._healthText) return;
    this._healthText = text;
    this.el.healthText.textContent = text;
  }

  setStamina(frac) {
    const v = Math.max(0, Math.min(1, frac));
    if (v === this._stamina) return;
    this._stamina = v;
    this.el.staminaFill.style.transform = `scaleX(${v})`;
  }

  setEquipment(weaponName, shieldName) {
    this.el.equipWeapon.textContent = weaponName;
    this.el.equipShield.textContent = shieldName;
  }

  setCombo(n) {
    if (n >= 2) {
      this.el.combo.classList.remove('hidden');
      this.el.comboCount.textContent = `x${n}`;
    } else {
      this.el.combo.classList.add('hidden');
    }
  }

  setLockOn(enemy, camera) {
    const el = this.el.lockon;
    if (!enemy) { el.classList.add('hidden'); return; }
    this._lockVec.copy(enemy.root.position);
    this._lockVec.y += enemy.height * enemy.def.scale * 0.72;
    this._lockVec.project(camera);
    if (this._lockVec.z > 1) { el.classList.add('hidden'); return; }
    const x = (this._lockVec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._lockVec.y * 0.5 + 0.5) * window.innerHeight;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.classList.remove('hidden');
  }

  banner(title, sub) {
    const el = this.el.banner;
    el.innerHTML = `${title}${sub ? `<span class="sub">${sub}</span>` : ''}`;
    el.classList.remove('show');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => el.classList.remove('show'), 2900);
  }

  // ------------------------------------------------------------- objective

  setObjective(title, body, progress = null) {
    this.el.tracker.classList.remove('hidden');
    this.el.trackerTitle.textContent = title;
    let html = body;
    if (progress) {
      const pct = Math.round((progress.value / Math.max(1, progress.max)) * 100);
      html += `<div class="bar-mini"><i style="width:${pct}%"></i></div>`;
    }
    this.el.trackerBody.innerHTML = html;
  }

  clearObjective() {
    this.el.tracker.classList.add('hidden');
  }

  /**
   * Compass-style guide to the current objective.
   * `angle` is the screen-relative bearing in radians (0 = dead ahead).
   */
  setGuide(label, distance, angle) {
    this.el.guide.classList.remove('hidden');
    this.el.guideLabel.textContent = label;
    this.el.guideDist.textContent = `${Math.round(distance)} m`;
    this.el.guideArrow.style.transform = `rotate(${angle}rad)`;
  }

  clearGuide() {
    this.el.guide.classList.add('hidden');
  }

  setPrompt(text) {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.promptText.textContent = text;
    this.el.prompt.classList.remove('hidden');
  }

  // -------------------------------------------------------------- dialogue

  showDialogue(current, active, isInput, typed) {
    const el = this.el.dialogue;
    if (!active || !current) {
      el.classList.add('hidden');
      this.el.dialogueInput.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    const speaker = current.speaker || '';
    this.el.dialogueSpeaker.textContent = speaker;
    this.el.dialogueSpeaker.style.display = speaker ? '' : 'none';
    this.el.dialogueText.textContent = current.text || '';

    if (isInput) {
      this.el.dialogueInput.classList.remove('hidden');
      this.el.dialogueLabel.textContent = current.label || 'Enter a value';
      this.el.dialogueField.placeholder = current.placeholder || '';
      if (this.el.dialogueField.value !== typed) this.el.dialogueField.value = typed || '';
      this.el.dialogueField.focus();
      // E/Space do nothing here — do not invite the player to press them
      this.el.dialogueHint.innerHTML = 'Type a name, then press <kbd>Enter</kbd> or <kbd>Confirm</kbd>';
    } else {
      this.el.dialogueInput.classList.add('hidden');
      this.el.dialogueHint.innerHTML =
        '<kbd>E</kbd> / <kbd>Space</kbd> continue <span class="sep">·</span> <kbd>Esc</kbd> skip';
    }
  }

  bindDialogueInput({ onType, onSubmit }) {
    this.el.dialogueField.addEventListener('input', (e) => onType(e.target.value));
    this.el.dialogueSubmit.addEventListener('click', () => onSubmit(this.el.dialogueField.value));
    this.el.dialogueField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onSubmit(this.el.dialogueField.value); }
      e.stopPropagation();
    });
  }

  // ----------------------------------------------------------------- panels

  closePanel() {
    this.el.panel.classList.add('hidden');
    this.el.map.classList.add('hidden');
  }

  get panelOpen() {
    return !this.el.panel.classList.contains('hidden') || !this.el.map.classList.contains('hidden');
  }

  openMissionBoard({ offers, active, onAccept, onAbandon }) {
    this.el.panelTitle.textContent = 'Mission board';
    this.el.panelSub.textContent = active
      ? 'One contract at a time. Finish it, or hand it back.'
      : 'Pick a contract. The board reposts what you turn down.';
    this.el.panelBody.innerHTML = '';

    if (active) {
      const region = REGIONS.find((r) => r.id === active.regionId);
      const done = active.progress >= active.target;
      const card = document.createElement('div');
      card.className = 'card taken';
      card.innerHTML = `
        <div class="card-main">
          <div class="card-title">${active.title}</div>
          <div class="card-sub">${active.description}</div>
          <div class="card-meta">
            <span>${active.progress}/${active.target} ${active.type === 'elite' ? 'warden' : 'slain'}</span>
            <span class="sep">·</span><span>${region ? region.name : ''}</span>
            <span class="sep">·</span><span>${active.rewardLabel}</span>
          </div>
        </div>
        <div class="card-action">
          <button data-abandon>Hand back</button>
        </div>`;
      card.querySelector('[data-abandon]').addEventListener('click', onAbandon);
      this.el.panelBody.appendChild(card);
      if (done) {
        const note = document.createElement('p');
        note.className = 'tagline';
        note.style.margin = '6px 0 0';
        note.textContent = 'Complete — hand it to the receptionist to be paid.';
        this.el.panelBody.appendChild(note);
      }
    } else {
      const head = document.createElement('div');
      head.className = 'section-head';
      head.innerHTML = '<h3>Posted contracts</h3><span class="note">Rewards paid at the desk</span>';
      this.el.panelBody.appendChild(head);

      for (const offer of offers) {
        const card = document.createElement('div');
        card.className = 'card';
        const skulls = '<span class="skull">' + '◆'.repeat(offer.difficulty.skulls) + '</span>';
        card.innerHTML = `
          <div class="card-main">
            <div class="card-title">${offer.title}</div>
            <div class="card-sub">${offer.description}</div>
            <div class="card-meta">
              ${skulls}<span class="sep">·</span><span>${offer.regionName}</span>
              <span class="sep">·</span><span>${offer.type === 'elite' ? 'Slay the Warden' : `Slay ${offer.target}`}</span>
              <span class="sep">·</span><span>${offer.rewardLabel}</span>
            </div>
          </div>
          <div class="card-action"><button data-accept>Accept</button></div>`;
        card.querySelector('[data-accept]').addEventListener('click', () => onAccept(offer.id));
        this.el.panelBody.appendChild(card);
      }
    }

    this.el.panel.classList.remove('hidden');
  }

  openSaves({ slots, message = '', onSave, onLoad, onClear, onClose }) {
    this.el.panelTitle.textContent = 'Save / Load';
    this.el.panelSub.textContent = message || 'Four branches at most. Saving overwrites that branch.';
    this.el.panelBody.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'save-list';

    slots.forEach((slot, i) => {
      const card = document.createElement('div');
      card.className = `save-slot${slot ? '' : ' empty'}`;

      const info = document.createElement('div');
      info.className = 'save-info';
      const title = document.createElement('div');
      title.className = 'save-title';
      title.textContent = `Branch ${i + 1}`;
      info.appendChild(title);

      const meta = document.createElement('div');
      meta.className = 'save-meta';
      if (slot) {
        const s = slot.summary || {};
        meta.textContent = `${s.name || 'Ranger'} · Level ${s.level ?? '?'} · ${Number(s.gold || 0).toLocaleString()} gold · ${s.location || 'Unknown'}`;
        info.appendChild(meta);

        const mission = document.createElement('div');
        mission.className = 'save-mission';
        mission.textContent = s.mission || 'No contract';
        info.appendChild(mission);

        if (slot.savedAt) {
          const stamp = document.createElement('div');
          stamp.className = 'save-time';
          stamp.textContent = new Date(slot.savedAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          info.appendChild(stamp);
        }
      } else {
        meta.textContent = 'Empty — save your current run here.';
        info.appendChild(meta);
      }
      card.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'save-actions';

      const save = document.createElement('button');
      save.className = 'ghost';
      save.textContent = slot ? 'Overwrite' : 'Save';
      save.addEventListener('click', () => onSave?.(i));
      actions.appendChild(save);

      const load = document.createElement('button');
      load.className = 'ghost';
      load.textContent = 'Load';
      load.disabled = !slot;
      load.addEventListener('click', () => onLoad?.(i));
      actions.appendChild(load);

      const clear = document.createElement('button');
      clear.className = 'ghost';
      clear.textContent = 'Clear';
      clear.disabled = !slot;
      let armed = false;
      clear.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          clear.textContent = 'Confirm?';
          window.setTimeout(() => { armed = false; clear.textContent = 'Clear'; }, 2500);
          return;
        }
        onClear?.(i);
      });
      actions.appendChild(clear);

      card.appendChild(actions);
      list.appendChild(card);
    });

    this.el.panelBody.appendChild(list);
    if (onClose) this.el.panelClose.onclick = onClose;
    this.el.panel.classList.remove('hidden');
  }

  openShop({ progression, onBuyUpgrade, onBuyWeapon, onBuyShield, onClose }) {
    this.el.panelTitle.textContent = 'Quartermaster';
    this.el.panelSub.textContent = `You have ${progression.gold.toLocaleString()} gold.`;
    this.el.panelBody.innerHTML = '';

    // --- training tracks
    const upHead = document.createElement('div');
    upHead.className = 'section-head';
    upHead.innerHTML = '<h3>Training</h3><span class="note">Permanent</span>';
    this.el.panelBody.appendChild(upHead);

    for (const [track, def] of Object.entries(UPGRADE_TRACKS)) {
      this.el.panelBody.appendChild(this._upgradeCard(progression, track, def, onBuyUpgrade));
    }

    // --- weapon
    const wHead = document.createElement('div');
    wHead.className = 'section-head';
    wHead.innerHTML = '<h3>Blade</h3><span class="note">Replaces your current sword</span>';
    this.el.panelBody.appendChild(wHead);
    this.el.panelBody.appendChild(this._tierCard(progression, 'weapon', onBuyWeapon));

    // --- shield
    const sHead = document.createElement('div');
    sHead.className = 'section-head';
    sHead.innerHTML = '<h3>Shield</h3><span class="note">Better guard, less stamina per block</span>';
    this.el.panelBody.appendChild(sHead);
    this.el.panelBody.appendChild(this._tierCard(progression, 'shield', onBuyShield));

    if (onClose) this.el.panelClose.onclick = onClose;
    this.el.panel.classList.remove('hidden');
  }

  _upgradeCard(progression, track, def, onBuy) {
    const level = progression.upgrades[track];
    const cost = progression.upgradeCost(track);
    const maxed = cost === null;

    const card = document.createElement('div');
    card.className = 'card' + (maxed ? ' locked' : '');
    const pips = Array.from({ length: def.levels }, (_, i) =>
      `<span class="pip${i < level ? ' on' : ''}"></span>`).join('');
    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${def.name}<span class="pip-row">${pips}</span></div>
        <div class="card-sub">${def.blurb}</div>
      </div>
      <div class="card-action">
        <button ${maxed ? 'disabled' : ''} class="${!maxed && progression.canAfford(cost) ? 'afford' : ''}">
          ${maxed ? 'Maxed' : `${cost} g`}
        </button>
      </div>`;
    if (!maxed) card.querySelector('button').addEventListener('click', () => onBuy(track));
    return card;
  }

  _tierCard(progression, kind, onBuy) {
    const isWeapon = kind === 'weapon';
    const list = isWeapon ? WEAPONS : SHIELDS;
    const ownedId = isWeapon ? progression.weapon : progression.shield;
    const ownedIndex = list.findIndex((t) => t.id === ownedId);
    const current = list[ownedIndex];
    const next = list[ownedIndex + 1];

    const card = document.createElement('div');
    card.className = 'card';
    if (!next) {
      card.classList.add('locked');
      card.innerHTML = `
        <div class="card-main">
          <div class="card-title">${current.name}</div>
          <div class="card-sub">Best ${isWeapon ? 'blade' : 'shield'} the guild can supply.</div>
        </div>
        <div class="card-action"><button disabled>Equipped</button></div>`;
      return card;
    }

    const detail = isWeapon
      ? `${next.damage} damage (currently ${current.damage})`
      : `${Math.round(next.mitigation * 100)}% damage blocked (currently ${Math.round(current.mitigation * 100)}%)`;

    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${current.name} → ${next.name}</div>
        <div class="card-sub">${detail}</div>
      </div>
      <div class="card-action">
        <button class="${progression.canAfford(next.cost) ? 'afford' : ''}">${next.cost} g</button>
      </div>`;
    card.querySelector('button').addEventListener('click', () => onBuy(next.id));
    return card;
  }

  // -------------------------------------------------------------------- map

  openMap({ playerPos, objectiveRegionId, objective, onTravel, currentArea }) {
    const canvas = this.el.mapCanvas;
    const ctx = this._mapCtx;
    const S = canvas.width;
    const worldR = 300;
    const k = (S / 2) / worldR;
    const toPx = (x, z) => [S / 2 + x * k, S / 2 + z * k];

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#141c12';
    ctx.fillRect(0, 0, S, S);

    // biomes
    const tints = { forest: '#3c5228', blight: '#54382a', desert: '#8a7444' };
    for (const r of REGIONS) {
      const [px, pz] = toPx(r.center[0], r.center[1]);
      ctx.beginPath();
      ctx.arc(px, pz, r.radius * k, 0, Math.PI * 2);
      ctx.fillStyle = tints[r.biome] || '#33402a';
      ctx.fill();
      ctx.strokeStyle = objectiveRegionId === r.id ? 'rgba(200,70,60,0.9)' : 'rgba(220,200,160,0.18)';
      ctx.lineWidth = objectiveRegionId === r.id ? 3 : 1.5;
      ctx.stroke();
    }

    // streets
    ctx.strokeStyle = 'rgba(200,180,140,0.16)';
    ctx.lineWidth = 4;
    for (const a of [0, Math.PI / 2, -Math.PI / 2]) {
      ctx.beginPath();
      ctx.moveTo(...toPx(0, 0));
      ctx.lineTo(...toPx(Math.sin(a) * CITY.wallRadius, Math.cos(a) * CITY.wallRadius));
      ctx.stroke();
    }

    // city
    const [cx, cz] = toPx(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cz, CITY.radius * k, 0, Math.PI * 2);
    ctx.fillStyle = '#6b6450';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cz, CITY.wallRadius * k, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240,225,190,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // gate
    const [gx, gz] = toPx(Math.sin(CITY.gateAngle) * CITY.wallRadius, Math.cos(CITY.gateAngle) * CITY.wallRadius);
    ctx.beginPath();
    ctx.arc(gx, gz, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c26a';
    ctx.fill();

    // player
    if (currentArea !== 'guild') {
      const [px, pz] = toPx(playerPos.x, playerPos.z);
      ctx.beginPath();
      ctx.arc(px, pz, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#a8c96b';
      ctx.fill();
    }

    // objective guide line: a dashed path from the player to the next stop
    if (objective && currentArea !== 'guild') {
      const [px, pz] = toPx(playerPos.x, playerPos.z);
      const [ox, oz] = toPx(objective.x, objective.z);
      ctx.save();
      ctx.setLineDash([9, 8]);
      ctx.strokeStyle = 'rgba(240, 196, 100, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(ox, oz);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(ox, oz, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f0c464';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 16, 10, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // markers
    this.el.mapMarkers.innerHTML = '';
    const addMarker = (x, z, label, { here = false, objective = false, onClick = null } = {}) => {
      const [px, pz] = toPx(x, z);
      const el = document.createElement('button');
      el.className = `map-marker${here ? ' here' : ''}${objective ? ' objective' : ''}`;
      el.textContent = label;
      el.style.left = `${(px / S) * 100}%`;
      el.style.top = `${(pz / S) * 100}%`;
      if (onClick && !here) el.addEventListener('click', onClick);
      this.el.mapMarkers.appendChild(el);
    };

    const inCity = currentArea !== 'guild' && Math.hypot(playerPos.x, playerPos.z) < CITY.wallRadius;
    addMarker(0, 0, inCity ? 'Ravenshold (you are here)' : 'Ravenshold', {
      here: inCity,
      onClick: () => onTravel('city'),
    });
    for (const r of REGIONS) {
      addMarker(r.center[0], r.center[1], r.name, {
        objective: objectiveRegionId === r.id,
        onClick: () => onTravel(r.id),
      });
    }

    this.el.mapSub.textContent = currentArea === 'guild'
      ? 'Leave the guild hall to travel'
      : (objective ? `Follow the line to ${objective.label}` : 'Travel to a waystone');
    this.el.map.classList.remove('hidden');
  }

  // -------------------------------------------------------------- transitions

  /** Fade to black, run `then`, fade back. */
  transition(then) {
    this.el.fade.classList.add('on');
    setTimeout(() => {
      if (then) then();
      setTimeout(() => this.el.fade.classList.remove('on'), 120);
    }, 380);
  }

  // ------------------------------------------------------------------ update

  update(dt) {
    if (this._ghost > this._health) {
      this._ghost = Math.max(this._health, this._ghost - dt * 0.55);
    } else {
      this._ghost = this._health;
    }
    this.el.healthGhost.style.transform = `scaleX(${this._ghost})`;

    if (this._damagePulse > 0) this._damagePulse = Math.max(0, this._damagePulse - dt * 1.6);
    const low = this._health < 0.35 ? (0.35 - this._health) / 0.35 : 0;
    const pulse = low > 0 ? low * (0.55 + Math.sin(performance.now() * 0.004) * 0.25) : 0;
    this.el.vignette.style.opacity = String(Math.max(this._damagePulse * 0.85, pulse));
  }
}
