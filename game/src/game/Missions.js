import { REGIONS, regionById } from './world/Regions.js';

/**
 * Contracts.
 *
 * The guild posts one offer per region; the player takes one, travels out,
 * fulfils it, and returns to hand it in. Only one contract can be active at a
 * time, which is what keeps the loop legible: accept -> travel -> fight ->
 * return -> spend.
 */

const DIFFICULTY = [
  { skulls: 1, label: 'Routine', countMul: 1.0, rewardMul: 1.0, eliteHp: 1.0 },
  { skulls: 2, label: 'Hazardous', countMul: 1.6, rewardMul: 1.9, eliteHp: 1.35 },
  { skulls: 3, label: 'Dire', countMul: 2.4, rewardMul: 3.2, eliteHp: 1.8 },
];

const FLAVOUR = {
  forest: [
    ['Wolves at the Treeline', 'Something is pushing the packs out of the deep wood. Thin them before they reach the road.'],
    ['The Green Silence', 'The wood has gone quiet. Find out why, and make it loud again.'],
    ['Root and Claw', 'Den-wolves have taken the old charcoalers\' camp. Clear it.'],
  ],
  blight: [
    ['Ash and Ember', 'Whatever walks the burnt wood does not tire. Put it down anyway.'],
    ['What the Fire Left', 'The Emberwood breeds things that hate the living. Correct that.'],
    ['Charwood Cull', 'Nothing in the blight is innocent. Cull it.'],
  ],
  desert: [
    ['Sunscorch Bounty', 'The flats are crawling. The guild pays by the head.'],
    ['Bones of the Mesa', 'The mesas are hollow and full of teeth. Empty them.'],
    ['Thirst and Ruin', 'Caravans are vanishing on the flats. Whatever is taking them, end it.'],
  ],
};

let missionSeq = 1;

export class MissionSystem {
  constructor(progression, rng = Math.random) {
    this.progression = progression;
    this.rng = rng;
    this.offers = [];
    this.active = null;
    this.completed = 0;
    this.refresh();
  }

  // ------------------------------------------------------------- generation

  refresh() {
    this.offers = REGIONS.map((region) => this._roll(region));
  }

  _roll(region) {
    const rng = this.rng;
    // difficulty creeps up with how many contracts the player has run
    const done = this.progression.missionsDone;
    const maxTier = Math.min(DIFFICULTY.length - 1, Math.floor(done / 2));
    const tier = Math.floor(rng() * (maxTier + 1));
    const diff = DIFFICULTY[tier];

    const isElite = rng() < 0.28 && done >= 1;
    const type = isElite ? 'elite' : 'slay';
    const baseCount = 6 + Math.floor(done * 0.6);
    const target = type === 'elite' ? 1 : Math.round(baseCount * diff.countMul);

    const flavour = FLAVOUR[region.id] || FLAVOUR.forest;
    const [title, description] = flavour[Math.floor(rng() * flavour.length)];

    const gold = Math.round((type === 'elite' ? 380 : 150) * diff.rewardMul);
    const xp = Math.round((type === 'elite' ? 140 : 70) * diff.rewardMul);

    return {
      id: `m${missionSeq++}`,
      regionId: region.id,
      regionName: region.name,
      biome: region.biome,
      type,
      difficulty: diff,
      title: type === 'elite' ? `Alpha of the ${region.name}` : title,
      description: type === 'elite'
        ? `A Warden has claimed the ${region.name}. Kill it and the pack will scatter.`
        : description,
      target,
      progress: 0,
      gold,
      xp,
      rewardLabel: `${gold} gold · ${xp} xp`,
    };
  }

  // ---------------------------------------------------------------- actions

  get activeMission() { return this.active; }

  accept(id) {
    const offer = this.offers.find((o) => o.id === id);
    if (!offer) return null;
    this.active = offer;
    this.offers = this.offers.filter((o) => o.id !== id);
    return offer;
  }

  abandon() {
    if (this.active) this.offers.unshift(this.active);
    this.active = null;
  }

  /** Called whenever the player kills something. */
  onKill(enemyType, regionId) {
    const m = this.active;
    if (!m || m.progress >= m.target) return false;
    // contracts are for a named region; a kill in the wrong one does not count
    if (regionId !== m.regionId) return false;

    if (m.type === 'elite') {
      if (enemyType !== 'warden') return false;
      m.progress = 1;
      return true;
    }
    m.progress++;
    return true;
  }

  get isComplete() {
    return !!this.active && this.active.progress >= this.active.target;
  }

  /** Restore a manual branch without re-rolling the board. */
  restore(data = {}) {
    if (Array.isArray(data.offers)) {
      this.offers = data.offers.filter((o) => o && typeof o.id === 'string' && o.regionId);
    }
    const active = data.active;
    if (active && typeof active === 'object' && active.regionId) {
      this.active = {
        ...active,
        progress: Number.isFinite(active.progress) ? active.progress : 0,
        target: Number.isFinite(active.target) ? active.target : 1,
        _announced: false, // let the pack announce itself when it respawns
      };
    } else {
      this.active = null;
    }
    if (Number.isFinite(data.completed)) this.completed = data.completed;
    return this;
  }

  /** Only payable back at the guild desk. */
  turnIn() {
    if (!this.isComplete) return null;
    const m = this.active;
    this.progression.earn(m.gold, m.xp);
    this.progression.missionsDone++;
    this.completed++;
    this.active = null;
    this.refresh();
    return m;
  }

  /** Short line for the HUD tracker. */
  get trackerText() {
    const m = this.active;
    if (!m) return null;
    if (m.type === 'elite') {
      return `${m.regionName} — hunt the Warden${m.progress ? ' (slain)' : ''}`;
    }
    return `${m.regionName} — ${m.progress}/${m.target} slain`;
  }

  get offersForDisplay() {
    return this.offers.map((o) => ({
      ...o,
      region: regionById(o.regionId),
    }));
  }
}

export { DIFFICULTY };
