import * as THREE from 'three';

/**
 * Heads.
 *
 * The Modular Character Outfits pack is clothing only: it is authored for
 * Quaternius' Universal Base Characters and stops at the collar. That kit is
 * supplied as `Universal Base Characters`, and its bodies share the outfits'
 * skeleton bone for bone (Head bone at 1.600 m on the male rig, 1.550 m on the
 * female one), so the head is cut straight out of the body at load time and
 * re-parented onto each outfit's own `Head` bone. A skull does not deform, so
 * the graft is rigid.
 *
 * The cut is driven by skinning weights, not by height: every triangle whose
 * vertices are dominated by the `Head` or `neck_01` bone is kept, which ends
 * the neck at the collar without dragging the shoulders along. The kit's
 * separate eye and eyebrow meshes ride along unchanged, and one of its hair
 * meshes is added on top. Materials stay textured (face, eyes, hair), so the
 * head costs four draw calls instead of being merged into one vertex-coloured
 * blob — a trade that buys the painted face, real eyes and modelled hair.
 */

const SKIN_TINTS = [0xffffff, 0xf6e2d2, 0xe8c6a8, 0xd4a57f, 0xffffff, 0xbc8a63];
const HAIR_COLORS = [0x2a1f19, 0x4a3324, 0x6b4a2f, 0x8a6a45, 0x1b1714, 0x9b948a, 0x7a3b24];

const MALE_STYLES = ['parted', 'buzzed'];
const FEMALE_STYLES = ['buns', 'long', 'buzzedF'];

/**
 * Build every head part once, in Head-bone space. Called from Assets.load();
 * the geometries and materials are shared by every character that wears them.
 */
export function buildHeadLibrary({ male, female, hair }) {
  return {
    male: buildHeadTemplate(male),
    female: buildHeadTemplate(female),
    hair: Object.fromEntries(
      Object.entries(hair).map(([key, gltf]) => [key, buildHairTemplate(gltf)]),
    ),
  };
}

function buildHeadTemplate(gltf) {
  gltf.scene.updateMatrixWorld(true);

  const parts = { skin: null, eyes: null, brows: null };
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const mat = o.material?.name || '';
    if (/superhero/i.test(mat)) parts.skin = o;
    else if (/eyes/i.test(mat)) parts.eyes = o;
    else if (/hair/i.test(mat)) parts.brows = o;
  });
  if (!parts.skin) throw new Error('[Head] base character has no skinned body');

  const skin = parts.skin;
  const headIndex = skin.skeleton.bones.findIndex((b) => /^head$/i.test(b.name));
  const neckIndex = skin.skeleton.bones.findIndex((b) => /^neck/i.test(b.name));
  if (headIndex < 0) throw new Error('[Head] base character has no Head bone');

  // dominant joint per vertex, so only the head/neck shell survives the cut
  const dominant = dominantJoints(skin.geometry);
  const keep = (ids) => {
    let n = 0;
    for (const id of ids) if (dominant[id] === headIndex || dominant[id] === neckIndex) n++;
    return n >= 2;
  };

  return {
    skinGeo: rigidGeometry(skin, headSpace(skin), keep),
    skinMat: prepared(skin.material, true),
    eyesGeo: parts.eyes ? rigidGeometry(parts.eyes, headSpace(parts.eyes), null) : null,
    eyesMat: parts.eyes ? prepared(parts.eyes.material, false) : null,
    browsGeo: parts.brows ? rigidGeometry(parts.brows, headSpace(parts.brows), null) : null,
    browsMat: parts.brows ? prepared(parts.brows.material, false) : null,
  };
}

function buildHairTemplate(gltf) {
  gltf.scene.updateMatrixWorld(true);
  let mesh = null;
  gltf.scene.traverse((o) => {
    if (!mesh && (o.isSkinnedMesh || o.isMesh)) mesh = o;
  });
  if (!mesh || !mesh.skeleton) return null;
  return {
    geo: rigidGeometry(mesh, headSpace(mesh), null),
    mat: prepared(mesh.material, false),
  };
}

/** Deterministic but varied face for a named character. */
export function lookFor(seed, female = false) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  h >>>= 0;
  const styles = female ? FEMALE_STYLES : MALE_STYLES;
  return {
    female,
    style: styles[(h >>> 4) % styles.length],
    hairColor: HAIR_COLORS[(h >>> 8) % HAIR_COLORS.length],
    skinTint: SKIN_TINTS[h % SKIN_TINTS.length],
    beard: !female && (h >>> 13) % 4 === 0,
  };
}

/**
 * Graft a head onto the model's own Head bone and hide any hood that would
 * bury the face. Returns the grafted meshes, or null when the model has no
 * Head bone (the monsters already have heads of their own).
 */
export function attachHead(model, assets, look = {}) {
  const heads = assets.heads;
  const template = heads && heads[look.female ? 'female' : 'male'];
  const bone = model.getObjectByName('Head');
  if (!template || !bone) return null;

  // the ranger's hood is a closed shell over the head
  model.traverse((o) => {
    if (o.isMesh && /head_hood/i.test(o.name)) o.visible = false;
  });

  const grafted = [];

  const skin = template.skinMat.clone();
  if (look.skinTint) skin.color.setHex(look.skinTint);
  grafted.push(addPart(bone, template.skinGeo, skin, 'head_skin'));

  if (template.eyesGeo) {
    grafted.push(addPart(bone, template.eyesGeo, template.eyesMat.clone(), 'head_eyes'));
  }

  const hairColor = look.hairColor ?? 0x3a2a1e;

  if (template.browsGeo) {
    const brows = template.browsMat.clone();
    brows.color.setHex(hairColor);
    grafted.push(addPart(bone, template.browsGeo, brows, 'head_brows'));
  }

  const style = heads.hair && (heads.hair[look.style] || heads.hair[look.female ? 'buns' : 'parted']);
  if (style) {
    const hair = style.mat.clone();
    hair.color.setHex(hairColor);
    grafted.push(addPart(bone, style.geo, hair, 'head_hair'));
  }

  if (look.beard && heads.hair?.beard) {
    const beard = heads.hair.beard;
    const mat = beard.mat.clone();
    mat.color.setHex(hairColor);
    grafted.push(addPart(bone, beard.geo, mat, 'head_beard'));
  }

  return grafted;
}

function addPart(parent, geo, material, name) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

/** World -> Head-bone space for one skinned mesh's rest pose. */
function headSpace(mesh) {
  const bones = mesh.skeleton.bones;
  const headIndex = bones.findIndex((b) => /^head$/i.test(b.name));
  if (headIndex < 0) throw new Error('[Head] mesh has no Head bone');
  return new THREE.Matrix4()
    .multiplyMatrices(mesh.skeleton.boneInverses[headIndex], mesh.matrixWorld);
}

/** The joint each vertex is mostly bound to, in this mesh's own skeleton. */
function dominantJoints(geometry) {
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  const out = new Uint16Array(skinIndex.count);
  for (let i = 0; i < skinIndex.count; i++) {
    const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
    const indices = [skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)];
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights[k] > weights[best]) best = k;
    out[i] = indices[best];
  }
  return out;
}

/**
 * Copy the triangles that survive `keep` into a plain (unskinned) geometry,
 * transformed into Head-bone space. Positions, normals and UVs are kept, so
 * the result still samples the source textures.
 */
function rigidGeometry(mesh, transform, keep) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const index = geo.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);

  const positions = [];
  const normals = [];
  const uvs = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
    if (keep && !keep(ids)) continue;
    for (let k = 0; k < 3; k++) {
      const i = ids[k];
      p.fromBufferAttribute(pos, i).applyMatrix4(transform);
      positions.push(p.x, p.y, p.z);
      if (nrm) {
        n.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
        normals.push(n.x, n.y, n.z);
      }
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else out.computeVertexNormals();
  if (uvs.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  return out;
}

/**
 * The kit authors its skin, eye and hair materials double-sided. The skin is
 * a closed shell and reads better single-sided; hair cards and brows need to
 * stay double-sided or they vanish from behind.
 */
function prepared(material, frontOnly) {
  const m = material.clone();
  if (frontOnly) m.side = THREE.FrontSide;
  m.shadowSide = THREE.FrontSide;
  // the kit's body mesh carries COLOR_0, so GLTFLoader turns vertex colours on;
  // the cut-down part does not copy that attribute and would sample black
  m.vertexColors = false;
  return m;
}
