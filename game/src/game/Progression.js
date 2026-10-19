/**
 * Gold, upgrades and equipment.
 *
 * Everything the player can spend mission rewards on lives here, so the guild
 * shop and the combat code read from one source of truth. Persisted to
 * localStorage under a single key.
 */

const SAVE_KEY = 'wildwood.save.v2';

export const WEAPONS = [
  { id: 'bronze', name: 'Bronze Shortsword', damage: 15, cost: 0, metal: 0xb08d57, length: 0.86, width: 1.0 },
  { id: 'iron', name: 'Iron Arming Sword', damage: 21, cost: 420, metal: 0xc3ccd6, length: 0.95, width: 1.05 },
  { id: 'steel', name: 'Steel Longsword', damage: 29, cost: 1150, metal: 0xdde6f0, length: 1.08, width: 1.1 },
  { id: 'silver', name: 'Silvered Blade', damage: 39, cost: 2700, metal: 0xeef4ff, length: 1.14, width: 1.15 },
];

export const SHIELDS = [
  { id: 'none', name: 'No Shield', mitigation: 0.22, cost: 0, stamina: 14 },
  { id: 'buckler', name: 'Wooden Buckler', mitigation: 0.34, cost: 320, stamina: 12 },
  { id: 'kite', name: 'Iron Kite Shield', mitigation: 0.48, cost: 950, stamina: 10 },
  { id: 'tower', name: 'Tower Shield', mitigation: 0.62, cost: 2100, stamina: 7 },
];

export const UPGRADE_TRACKS = {
  attack: {
    name: 'Bladework',
    blurb: '+2 damage on every hit',
    per: 2,
    levels: 8,
    cost: (level) => 160 + level * 130,
  },
  health: {
    name: 'Vitality',
    blurb: '+12 maximum health',
    per: 12,
    levels: 8,
    cost: (level) => 150 + level * 120,
  },
  stamina: {
    name: 'Endurance',
    blurb: '+8 maximum stamina',
    per: 8,
    levels: 6,
    cost: (level) => 130 + level * 110,
  },
};

const BASE = { health: 100, stamina: 100 };

export class Progression {
  constructor() {
    this.gold = 0;
    this.xp = 0;
    this.level = 1;
    this.weapon = 'bronze';
    this.shield = 'none';
    this.upgrades = { attack: 0, health: 0, stamina: 0 };
    this.missionsDone = 0;
    this.kills = 0;
  }

  // ------------------------------------------------------------- derived

  get weaponDef() { return WEAPONS.find((w) => w.id === this.weapon) || WEAPONS[0]; }
  get shieldDef() { return SHIELDS.find((s) => s.id === this.shield) || SHIELDS[0]; }

  get maxHealth() { return BASE.health + this.upgrades.health * UPGRADE_TRACKS.health.per; }
  get maxStamina() { return BASE.stamina + this.upgrades.stamina * UPGRADE_TRACKS.stamina.per; }

  /** Total damage a light swing deals before per-swing variance. */
  get attackDamage() {
    return this.weaponDef.damage + this.upgrades.attack * UPGRADE_TRACKS.attack.per;
  }

  get guardMitigation() { return this.shieldDef.mitigation; }
  get guardStaminaCost() { return this.shieldDef.stamina; }

  // ------------------------------------------------------------- economy

  canAfford(cost) { return this.gold >= cost; }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    this.gold -= cost;
    this.save();
    return true;
  }

  earn(gold, xp = 0) {
    this.gold += gold;
    this.xp += xp;
    // a level every 250 xp, purely for flavour
    this.level = 1 + Math.floor(this.xp / 250);
    this.save();
  }

  upgradeCost(track) {
    const def = UPGRADE_TRACKS[track];
    const level = this.upgrades[track];
    return level >= def.levels ? null : def.cost(level);
  }

  buyUpgrade(track) {
    const cost = this.upgradeCost(track);
    if (cost === null || !this.spend(cost)) return false;
    this.upgrades[track]++;
    this.save();
    return true;
  }

  /** Next tier of a track, or null if maxed / already owned. */
  nextWeapon() {
    const i = WEAPONS.findIndex((w) => w.id === this.weapon);
    return i >= 0 && i < WEAPONS.length - 1 ? WEAPONS[i + 1] : null;
  }

  nextShield() {
    const i = SHIELDS.findIndex((s) => s.id === this.shield);
    return i >= 0 && i < SHIELDS.length - 1 ? SHIELDS[i + 1] : null;
  }

  buyWeapon(id) {
    const def = WEAPONS.find((w) => w.id === id);
    if (!def || !this.spend(def.cost)) return false;
    this.weapon = id;
    this.save();
    return true;
  }

  buyShield(id) {
    const def = SHIELDS.find((s) => s.id === id);
    if (!def || !this.spend(def.cost)) return false;
    this.shield = id;
    this.save();
    return true;
  }

  // -------------------------------------------------------------- persistence

  toJSON() {
    return {
      gold: this.gold, xp: this.xp, level: this.level,
      weapon: this.weapon, shield: this.shield,
      upgrades: { ...this.upgrades },
      missionsDone: this.missionsDone, kills: this.kills,
    };
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
    } catch { /* private mode / quota — not worth failing the run over */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return this;
      return this.restore(JSON.parse(raw));
    } catch { /* corrupt save — start fresh */ }
    return this;
  }

  /** Apply an already-parsed snapshot (manual branches, tests). */
  restore(data = {}) {
    this.gold = Number.isFinite(data.gold) ? data.gold : 0;
    this.xp = Number.isFinite(data.xp) ? data.xp : 0;
    this.level = Number.isFinite(data.level) ? data.level : 1;
    this.weapon = WEAPONS.some((w) => w.id === data.weapon) ? data.weapon : 'bronze';
    this.shield = SHIELDS.some((s) => s.id === data.shield) ? data.shield : 'none';
    this.upgrades = {
      attack: Math.min(data.upgrades?.attack ?? 0, UPGRADE_TRACKS.attack.levels),
      health: Math.min(data.upgrades?.health ?? 0, UPGRADE_TRACKS.health.levels),
      stamina: Math.min(data.upgrades?.stamina ?? 0, UPGRADE_TRACKS.stamina.levels),
    };
    this.missionsDone = data.missionsDone ?? 0;
    this.kills = data.kills ?? 0;
    return this;
  }

  reset() {
    this.gold = 0; this.xp = 0; this.level = 1;
    this.weapon = 'bronze'; this.shield = 'none';
    this.upgrades = { attack: 0, health: 0, stamina: 0 };
    this.missionsDone = 0; this.kills = 0;
    this.save();
  }
}
