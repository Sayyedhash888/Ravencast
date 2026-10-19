import * as THREE from 'three';

/**
 * The outfit packs ship no weapons, but every attack clip in the library is a
 * sword animation (Sword_Regular_A/B/C, Sword_Heavy_Combo, Sword_Block), so the
 * ranger swings empty air without one. This builds a sword and a shield in code
 * and hangs them off the hand bones.
 *
 * Grip orientation is derived from the skeleton rather than eyeballed: a fist
 * wraps its fingers around the grip, so the blade emerges across the palm, from
 * the pinky side toward the index side. Taking that vector from the actual
 * bones means the attachment stays correct through every retargeted clip, and
 * it does not depend on guessing which way a UE hand bone happens to point.
 */

const UP = new THREE.Vector3(0, 1, 0);

const GRIP_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x4a3123, metalness: 0.05, roughness: 0.9 });

/** Blade along +Y with the grip at the origin. */
export function createSword(def = null) {
  const metal = def?.metal ?? 0xd7dee6;
  const lengthScale = def?.length ?? 1;
  const widthScale = def?.width ?? 1;

  const bladeMat = new THREE.MeshStandardMaterial({
    color: metal, metalness: 0.78, roughness: 0.3,
  });
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0x9a7539, metalness: 0.62, roughness: 0.45,
  });

  const sword = new THREE.Group();
  sword.name = 'sword';

  // an extruded silhouette so the tip actually tapers
  const profile = new THREE.Shape();
  profile.moveTo(-0.037, 0.07);
  profile.lineTo(-0.034, 0.86);
  profile.lineTo(0, 0.99);
  profile.lineTo(0.034, 0.86);
  profile.lineTo(0.037, 0.07);
  profile.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(profile, { depth: 0.021, bevelEnabled: false });
  bladeGeo.translate(0, 0, -0.0105);
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.scale.set(widthScale, lengthScale, 1);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.25 * widthScale, 0.028, 0.048), guardMat);
  guard.position.y = 0.058;

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.15, 8), GRIP_MATERIAL);
  grip.position.y = -0.02;

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.031, 10, 8), guardMat);
  pommel.position.y = -0.101;

  for (const part of [blade, guard, grip, pommel]) {
    part.castShadow = true;
    part.receiveShadow = true;
    sword.add(part);
  }
  return sword;
}

/**
 * Work out the local transform that seats an object in a hand.
 *
 * @param {THREE.Object3D} hand    the hand bone
 * @param {THREE.Vector3}  gripPos where the grip should sit, in world space
 * @param {THREE.Vector3}  aimDir  the direction the object's +Y should point
 * @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion}}
 */
function handLocalTransform(hand, gripPos, aimDir) {
  const worldQuat = new THREE.Quaternion().setFromUnitVectors(UP, aimDir.clone().normalize());
  const invHandQuat = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  const handPos = hand.getWorldPosition(new THREE.Vector3());

  return {
    position: gripPos.clone().sub(handPos).applyQuaternion(invHandQuat),
    quaternion: invHandQuat.clone().multiply(worldQuat),
  };
}

/**
 * Seat a sword in the model's right hand.
 * @returns {THREE.Group|null}
 */
export function attachSword(model, def = null, roll = 0) {
  const hand = model.getObjectByName('hand_r');
  const index = model.getObjectByName('index_01_r');
  const pinky = model.getObjectByName('pinky_01_r');
  if (!hand || !index || !pinky) {
    console.warn('[Equipment] right hand bones not found; skipping sword');
    return null;
  }

  hand.updateWorldMatrix(true, true);
  const handPos = hand.getWorldPosition(new THREE.Vector3());
  const indexPos = index.getWorldPosition(new THREE.Vector3());
  const pinkyPos = pinky.getWorldPosition(new THREE.Vector3());

  // across the palm, pinky -> index
  const bladeDir = indexPos.clone().sub(pinkyPos);
  if (bladeDir.lengthSq() < 1e-8) bladeDir.copy(UP);
  bladeDir.normalize();

  const gripPos = handPos.clone().lerp(indexPos, 0.35);
  const worldQuat = new THREE.Quaternion().setFromUnitVectors(UP, bladeDir);
  if (roll) worldQuat.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));

  const invHandQuat = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  const sword = createSword(def);
  sword.quaternion.copy(invHandQuat).multiply(worldQuat);
  sword.position.copy(gripPos).sub(handPos).applyQuaternion(invHandQuat);

  hand.add(sword);
  return sword;
}

/**
 * Strap a shield to the left forearm. The face normal is the model's +Z (the
 * shield is thin along Z), so it is aimed away from the body's centre line.
 */
export function attachShield(model, shieldModel, def = null) {
  const hand = model.getObjectByName('hand_l');
  const lower = model.getObjectByName('lowerarm_l');
  if (!hand || !shieldModel) return null;

  hand.updateWorldMatrix(true, true);
  const handPos = hand.getWorldPosition(new THREE.Vector3());
  const armPos = (lower || hand).getWorldPosition(new THREE.Vector3());

  // outward from the body, along the arm
  const outward = handPos.clone().sub(armPos);
  outward.y = 0;
  if (outward.lengthSq() < 1e-8) outward.set(1, 0, 0);
  outward.normalize();

  const shield = shieldModel.clone(true);
  shield.name = 'shield';
  shield.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material = o.material.clone();
    if (def?.tint) o.material.color.setHex(def.tint);
    if (def?.metalness !== undefined) o.material.metalness = def.metalness;
  });

  // the shield's +Z is its face; point it outward and sit it just past the wrist
  const faceQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
  const invHandQuat = hand.getWorldQuaternion(new THREE.Quaternion()).invert();

  shield.quaternion.copy(invHandQuat).multiply(faceQuat);
  shield.position.copy(handPos.clone().addScaledVector(outward, 0.18))
    .sub(handPos)
    .applyQuaternion(invHandQuat);
  shield.scale.setScalar(def?.scale ?? 1);

  hand.add(shield);
  return shield;
}

/** Replace the sword on a character (used when the shop sells an upgrade). */
export function replaceSword(model, def) {
  const hand = model.getObjectByName('hand_r');
  if (!hand) return null;
  const old = hand.getObjectByName('sword');
  const transform = old ? { p: old.position.clone(), q: old.quaternion.clone() } : null;
  if (old) hand.remove(old);

  const sword = createSword(def);
  if (transform) {
    sword.position.copy(transform.p);
    sword.quaternion.copy(transform.q);
  }
  hand.add(sword);
  return sword;
}
