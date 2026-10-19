/**
 * Manual save branches.
 *
 * The progression's automatic save (wildwood.save.v2) keeps the wallet and
 * equipment current; these four slots are full run snapshots the player
 * chooses to keep, so they can branch off and come back later.
 */

export const SAVE_SLOTS = 4;

const KEY_PREFIX = 'wildwood.branch.v1.';
const keyFor = (index) => `${KEY_PREFIX}${index + 1}`;

export function readSlot(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SAVE_SLOTS) return null;
  try {
    const raw = localStorage.getItem(keyFor(index));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.v === 1 ? data : null;
  } catch {
    return null;
  }
}

export function writeSlot(index, data) {
  if (!Number.isInteger(index) || index < 0 || index >= SAVE_SLOTS) return false;
  try {
    localStorage.setItem(keyFor(index), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSlot(index) {
  if (!Number.isInteger(index) || index < 0 || index >= SAVE_SLOTS) return false;
  try {
    localStorage.removeItem(keyFor(index));
    return true;
  } catch {
    return false;
  }
}

export function allSlots() {
  return Array.from({ length: SAVE_SLOTS }, (_, i) => readSlot(i));
}
