import * as THREE from 'three';
import { Character } from './Character.js';
import { computeFacingOffset, measureHeight } from './Assets.js';
import { attachHead, lookFor } from './Head.js';

/**
 * A guild NPC. Reuses the same skinned-character base as the player and the
 * monsters — the outfit packs and the animation libraries share one skeleton,
 * so a peasant body can idle on a `Idle_Talking_Loop` authored for the ranger.
 *
 * NPCs are static: they hold an idle loop and turn to face the player when one
 * comes close, which is enough to make the hall feel occupied without a full
 * behaviour tree.
 */

const IDLE_SETS = {
  talking: [['UAL1', 'Idle_Talking_Loop']],
  folded: [['UAL2', 'Idle_FoldArms_Loop']],
  lantern: [['UAL2', 'Idle_Lantern_Loop']],
  plain: [['UAL1', 'Idle_Loop']],
  thinking: [['UAL2', 'Idle_No_Loop']],
  phone: [['UAL2', 'Idle_TalkingPhone_Loop']],
  torch: [['UAL1', 'Idle_Torch_Loop']],
  shield: [['UAL2', 'Idle_Shield_Loop']],
  sitting: [['UAL1', 'Sitting_Idle_Loop']],
  kneeling: [['UAL1', 'Fixing_Kneeling']],
  training: [['UAL2', 'Sword_Regular_A']],
  pushups: [['UAL1', 'Push_Loop']],
};

export const NPC_ROLE_SETS = {
  receptionist: 'talking',
  quartermaster: 'folded',
  board: 'thinking',
  table1: 'lantern',
  table2: 'phone',
  library: 'plain',
  training: 'training',
  idle: 'plain',
  guard: 'shield',
};

// the guild's cast is hand-picked so the hall reads as eight different people
// rather than eight variations of the same hash
const ROLE_LOOKS = {
  receptionist: { style: 'buns', hairColor: 0x2a1f19, skinTint: 0xf6e2d2 },
  quartermaster: { style: 'parted', hairColor: 0x6b4a2f, beard: true },
  board: { style: 'long', hairColor: 0x7a3b24 },
  table1: { style: 'buzzed', hairColor: 0x4a3324, skinTint: 0xe8c6a8 },
  table2: { style: 'buzzedF', hairColor: 0x1b1714 },
  library: { style: 'parted', hairColor: 0x1b1714, skinTint: 0xd6a982 },
  training: { style: 'long', hairColor: 0x8a6a45 },
  idle: { style: 'buzzed', hairColor: 0x9b948a, skinTint: 0xd4a57f },
};

export class Npc extends Character {
  /**
   * @param {object} opts
   *   assets    the Assets registry
   *   outfit    character key ('ranger' | 'peasantM' | 'peasantF' | 'rangerF')
   *   role      key into NPC_ROLE_SETS, chooses the idle loop
   *   position  [x, y, z]
   *   yaw       facing
   *   name      display name
   *   lines     optional dialogue
   */
  constructor({ assets, outfit = 'peasantM', role = 'idle', position = [0, 0, 0], yaw = 0, name = 'Guild member', lines = [] }) {
    const model = assets.instantiate(outfit);
    const look = { ...lookFor(role, outfit.endsWith('F')), ...ROLE_LOOKS[role] };
    attachHead(model, assets, look);
    super({
      model,
      assets,
      facingOffset: computeFacingOffset(model),
      height: measureHeight(model).height,
    });

    this.outfit = outfit;
    this.role = role;
    this.displayName = name;
    this.lines = lines;
    this.baseYaw = yaw;
    this.idleKey = NPC_ROLE_SETS[role] || 'plain';

    this.root.position.set(position[0], position[1], position[2]);
    this.root.rotation.y = yaw;

    const [lib, clipName] = IDLE_SETS[this.idleKey][0];
    this.clip = assets.clip(lib, clipName);
    this.turnRate = 3.2;
    this._lookTarget = 0;
    this._blink = 0;

    // desynchronise the loops so the hall does not look like a chorus line
    this.play('idle', { clip: this.clip, fade: 0.2, speed: 0.9 + Math.random() * 0.2 });
    if (this.current) this.current.time = Math.random() * (this.clip?.duration || 1);
  }

  get position() { return this.root.position; }

  /** Turn to face a point, or drift back to the default facing. */
  update(dt, lookAt = null) {
    const target = lookAt || this.baseYaw;
    let diff;
    if (lookAt === null) {
      diff = this.baseYaw - this.root.rotation.y;
    } else {
      const dx = lookAt.x - this.root.position.x;
      const dz = lookAt.z - this.root.position.z;
      if (dx * dx + dz * dz > 42) {
        // player wandered off: settle back to the authored pose
        diff = this.baseYaw - this.root.rotation.y;
      } else {
        diff = Math.atan2(dx, dz) - this.root.rotation.y;
      }
    }
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.root.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), this.turnRate * dt);

    super.update(dt);
  }

  /** Nearest NPC to a point within range, for interaction prompts. */
  static nearest(npcs, x, z, maxDist = 3.2) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const n of npcs) {
      const dx = n.root.position.x - x;
      const dz = n.root.position.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = n; }
    }
    return best;
  }
}

export { IDLE_SETS };
