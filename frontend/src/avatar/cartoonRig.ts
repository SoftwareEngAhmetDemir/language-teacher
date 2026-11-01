import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Look } from "./characters";
import type { Rig, RigState } from "./rig";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Flat-shaded cartoon look: three light steps instead of a smooth gradient. */
function toonGradient(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * An original cartoon teacher built from simple shapes and styled by `look` (colours, nose, hair,
 * moustache or beard, glasses, hat). The mouth opens and rounds with the voice.
 */
export function createCartoonRig(look: Look, options: { armsOnTable?: boolean } = {}): Rig {
  // Materials and shapes shared by the parts below.
  const gradientMap = toonGradient();
  const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap });
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.BackSide });
  const ball = new THREE.SphereGeometry(1, 40, 28);
  const owned: { dispose(): void }[] = [gradientMap, outlineMaterial, ball];

  /** A part with a thick black cartoon outline (an enlarged back-facing copy behind it). */
  const part = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    color: number,
    opts: { outline?: number } = {},
  ) => {
    const material = toon(color);
    owned.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    if (opts.outline !== 0) {
      const outline = new THREE.Mesh(geometry, outlineMaterial);
      outline.scale.setScalar(opts.outline ?? 1.07);
      mesh.add(outline);
    }
    parent.add(mesh);
    return mesh;
  };
  const flat = (geometry: THREE.BufferGeometry) => (owned.push(geometry), geometry);

  const SKIN = look.skin;
  const NOSE = look.nose;
  const HAIR = look.hair;

  const root = new THREE.Group();

  // Body: green cardigan, white collar and a red bow tie.
  const body = new THREE.Group();
  root.add(body);
  part(body, ball, look.body).scale.set(0.95, 0.72, 0.55);
  body.children[0].position.set(0, -1.35, 0);
  // Neck.
  part(body, flat(new THREE.CylinderGeometry(0.21, 0.24, 0.34, 20)), SKIN).position.set(0, -0.58, 0);
  if (look.collar) {
    const collar = part(body, flat(new THREE.TorusGeometry(0.3, 0.08, 12, 32)), 0xffffff);
    collar.position.set(0, -0.7, 0.04);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1, 1, 0.8);
  }
  if (look.bowTie !== undefined) {
    const tie = new THREE.Group();
    tie.position.set(0, -0.8, 0.4);
    body.add(tie);
    for (const side of [-1, 1]) {
      const wing = part(tie, flat(new THREE.ConeGeometry(0.13, 0.26, 4)), look.bowTie);
      wing.rotation.z = (-side * Math.PI) / 2;
      wing.position.x = side * 0.14;
    }
    part(tie, ball, look.bowTie).scale.setScalar(0.07);
  }
  if (look.robot) {
    const panel = part(body, flat(new RoundedBoxGeometry(0.34, 0.22, 0.08, 4, 0.04)), 0x263238, { outline: 1.12 });
    panel.position.set(0, -1.0, 0.5);
    part(body, ball, look.robot.glow, { outline: 0 }).scale.setScalar(0.05);
    body.children[body.children.length - 1].position.set(0, -1.0, 0.56);
  }
  if (look.whistle) {
    const whistle = new THREE.Group();
    whistle.position.set(0.12, -0.98, 0.5);
    body.add(whistle);
    part(whistle, flat(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12)), 0xf2c230, { outline: 1.15 }).rotation.z = Math.PI / 2;
    part(whistle, ball, 0xf2c230, { outline: 1.15 }).scale.setScalar(0.055);
    whistle.children[1].position.x = -0.08;
  }

  // Neck pivot: the head turns and nods around here rather than around its own centre.
  const neck = new THREE.Group();
  neck.position.set(0, -0.72, 0);
  root.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.72, 0);
  neck.add(head);

  if (look.robot) {
    // A rounded metal head with bolt "ears" and an antenna that glows.
    part(head, flat(new RoundedBoxGeometry(1.1, 0.95, 0.9, 6, 0.18)), SKIN);
    for (const side of [-1, 1]) {
      const bolt = part(head, flat(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 16)), 0x78909c);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(side * 0.6, -0.02, 0);
    }
    part(head, flat(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8)), 0x78909c, { outline: 0 }).position.y = 0.6;
    part(head, ball, look.robot.glow, { outline: 1.15 }).scale.setScalar(0.075);
    head.children[head.children.length - 1].position.y = 0.78;
  } else {
    part(head, ball, SKIN).scale.set(0.58, 0.54, 0.52);
    for (const side of [-1, 1]) {
      part(head, ball, SKIN).scale.setScalar(0.1);
      head.children[head.children.length - 1].position.set(side * 0.56, -0.02, 0);
    }
  }

  // Big round nose.
  if (look.noseSize > 0) {
    const nose = part(head, ball, NOSE);
    nose.scale.set(0.17 * look.noseSize, 0.15 * look.noseSize, 0.15 * look.noseSize);
    nose.position.set(0, -0.06, 0.48 + 0.02 * look.noseSize);
  }

  // Eyes with pupils that can look around, and eyebrows.
  const eyes: THREE.Group[] = [];
  const pupils: THREE.Mesh[] = [];
  const brows: THREE.Mesh[] = [];
  const browGeometry = flat(new THREE.CapsuleGeometry(0.028, 0.14, 6, 10));
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.2, 0.14, 0.46);
    head.add(eye);
    part(eye, ball, 0xffffff).scale.set(0.1, 0.125, 0.06);
    const pupil = part(eye, ball, look.robot ? look.robot.glow : 0x1b1b1b, { outline: 0 });
    pupil.scale.setScalar(0.05);
    pupil.position.z = 0.04;
    eyes.push(eye);
    pupils.push(pupil);

    if (look.glasses !== undefined) {
      const frame = part(head, flat(new THREE.TorusGeometry(0.13, 0.017, 10, 36)), look.glasses, { outline: 0 });
      frame.position.set(side * 0.2, 0.14, 0.5);
    }

    const brow = part(head, browGeometry, HAIR, { outline: 0 });
    brow.rotation.z = Math.PI / 2 - side * 0.18;
    brow.position.set(side * 0.2, 0.34, 0.47);
    brows.push(brow);
  }
  if (look.glasses !== undefined) {
    const bridge = part(head, flat(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6)), look.glasses, { outline: 0 });
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.16, 0.5);
  }

  // Handlebar moustache.
  const moustache = new THREE.Group();
  moustache.position.set(0, -0.19, 0.47);
  head.add(moustache);
  for (const side of look.moustache ? [-1, 1] : []) {
    const half = part(moustache, ball, HAIR);
    half.scale.set(0.2, 0.075, 0.08);
    half.position.x = side * 0.15;
    half.rotation.z = side * 0.4;
    const tip = part(moustache, ball, HAIR);
    tip.scale.setScalar(0.05);
    tip.position.set(side * 0.33, 0.04, 0);
  }

  // Mouth: a dark opening whose size and roundness follow the vowel, and a smile for when it is shut.
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.33, 0.4);
  head.add(mouth);
  const lips = part(mouth, ball, look.robot ? 0x78909c : 0xc4515a, { outline: 0 });
  const opening = part(mouth, ball, look.robot ? 0x10202a : 0x3d0a0f, { outline: 0 });
  const tongue = part(mouth, ball, look.robot ? look.robot.glow : 0xe8808a, { outline: 0 });
  const smile = part(mouth, flat(new THREE.TorusGeometry(0.13, 0.016, 8, 28, Math.PI)), look.robot ? look.robot.glow : 0x7a2630, { outline: 0 });
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.05, 0.06);

  // Hat.
  const tassel = new THREE.Group();
  const hat = look.hat;
  if (hat?.kind === "mortarboard") {
    const cap = new THREE.Group();
    cap.position.set(0, 0.42, 0);
    cap.rotation.x = -0.12;
    head.add(cap);
    part(cap, flat(new THREE.CylinderGeometry(0.42, 0.46, 0.26, 28)), hat.color).position.y = 0.06;
    const board = part(cap, flat(new THREE.BoxGeometry(1.2, 0.07, 1.2)), hat.color);
    board.position.y = 0.22;
    board.rotation.y = Math.PI / 4;
    const button = part(cap, ball, 0xf2c230, { outline: 0 });
    button.scale.setScalar(0.05);
    button.position.y = 0.27;
    tassel.position.set(0.42, 0.23, 0.42);
    cap.add(tassel);
    part(tassel, flat(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6)), 0xf2c230, { outline: 0 }).position.y = -0.15;
    part(tassel, flat(new THREE.CylinderGeometry(0.035, 0.06, 0.14, 10)), 0xf2c230, { outline: 0 }).position.y = -0.36;
  } else if (hat?.kind === "cap") {
    const dome = part(head, flat(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), hat.color);
    dome.scale.set(0.6, 0.4, 0.58);
    dome.position.set(0, 0.27, 0);
    dome.rotation.x = -0.1;
    const brim = part(head, ball, hat.color);
    brim.scale.set(0.42, 0.04, 0.36);
    brim.position.set(0, 0.27, 0.52);
    brim.rotation.x = 0.12;
  }

  // Hair: a cap of hair over the top and back of the head, plus a fringe and optionally a bun.
  if (look.hairStyle !== "none") {
    const hair = part(head, ball, HAIR);
    hair.scale.set(0.6, 0.57, 0.55);
    hair.position.set(0, 0.07, -0.07);
    const fringe = part(head, ball, HAIR, { outline: 0 });
    fringe.scale.set(0.5, 0.16, 0.2);
    fringe.position.set(0, 0.42, 0.3);
    fringe.rotation.x = 0.5;
    if (look.hairStyle === "bun") {
      part(head, ball, HAIR).scale.setScalar(0.22);
      head.children[head.children.length - 1].position.set(0, 0.66, -0.12);
    }
  }

  // Beard around the chin, behind the mouth so the lips stay visible.
  if (look.beard) {
    const beard = part(head, ball, HAIR, { outline: 0 });
    beard.scale.set(0.46, 0.3, 0.34);
    beard.position.set(0, -0.37, 0.1);
  }

  if (look.blush) {
    for (const side of [-1, 1]) {
      const blush = part(head, ball, 0xf08a8a, { outline: 0 });
      blush.scale.set(0.075, 0.045, 0.02);
      blush.position.set(side * 0.3, -0.08, 0.43);
      blush.rotation.y = side * 0.5;
    }
  }

  // Sideburns peeking out under the cap.
  for (const side of look.hairStyle === "none" && !look.beard && !look.robot ? [-1, 1] : []) {
    const burn = part(head, ball, HAIR, { outline: 0 });
    burn.scale.set(0.06, 0.16, 0.1);
    burn.position.set(side * 0.5, 0.2, 0.12);
  }

  // Seated at a table: both arms come forward and the hands rest on the tabletop.
  // Positions are in the character's own units, with the middle of the head at the origin.
  if (options.armsOnTable) {
    const limb = (from: THREE.Vector3, to: THREE.Vector3, radius: number, color: number) => {
      const direction = to.clone().sub(from);
      const length = direction.length();
      const mesh = part(root, flat(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 6, 14)), color);
      mesh.position.copy(from).add(to).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    };
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Vector3(side * 0.8, -1.02, 0.02);
      const elbow = new THREE.Vector3(side * 0.98, -1.6, 0.32);
      const hand = new THREE.Vector3(side * 0.52, -1.6, 1.0);
      limb(shoulder, elbow, 0.2, look.body);
      limb(elbow, hand, 0.18, look.body);
      const fist = part(root, ball, SKIN);
      fist.position.set(hand.x, hand.y, hand.z + 0.06);
      fist.scale.set(0.18, 0.15, 0.2);
    }
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let t = 0;
  let nextBlink = rand(1.5, 4);
  let blinkStart = -1;
  let nextGaze = 0;
  const gazeFrom = new THREE.Vector2();
  const gazeTo = new THREE.Vector2();
  const gaze = new THREE.Vector2();
  let gazeBlend = 1;
  let smoothedLevel = 0;
  // Smoothed direction of the point being looked at, in radians.
  let lookYaw = 0;
  let lookPitch = 0;
  const local = new THREE.Vector3();

  return {
    object: root,
    scaleHint: 1,

    update(dt, state: RigState, lookAt) {
      t += dt;
      const motion = reduceMotion ? 0 : 1;
      const v = state.visemes;
      smoothedLevel += (state.level - smoothedLevel) * (1 - Math.exp(-dt / 0.12));

      // Mouth shape: tall for "ah", small and round for "oh" and "oo", wide and flat for "ee".
      const height = 0.02 + 0.22 * v.aa + 0.15 * v.oh + 0.09 * v.ou + 0.07 * v.ee + 0.04 * v.ih;
      const width = 0.13 + 0.05 * v.aa - 0.03 * v.oh - 0.05 * v.ou + 0.11 * v.ee + 0.08 * v.ih;
      const openAmount = Math.max(v.aa, v.oh, v.ou * 0.7, v.ee * 0.6, v.ih * 0.5);
      const isOpen = openAmount > 0.07;
      opening.visible = lips.visible = tongue.visible = isOpen;
      smile.visible = !isOpen;
      smile.scale.set(1 + (width - 0.13) * 2, 1, 1);
      lips.scale.set(width * 1.18, height * 1.25 + 0.01, 0.1);
      opening.scale.set(width, height, 0.12);
      tongue.scale.set(width * 0.6, height * 0.35, 0.1);
      tongue.position.y = -height * 0.45;
      tongue.position.z = 0.02;
      // The moustache rides up a little as the mouth opens and spreads.
      moustache.position.y = -0.19 + openAmount * 0.025;
      moustache.scale.x = 1 + v.ee * 0.06 - v.ou * 0.05;

      // Blink.
      if (blinkStart < 0 && t > nextBlink) blinkStart = t;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 0.2;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + rand(2, 5.5);
        } else {
          blink = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
        }
      }
      for (const eye of eyes) eye.scale.y = lerp(1, 0.08, blink);

      // Gaze: toward whatever is being looked at, with small shifts of attention now and then.
      if (t > nextGaze) {
        gazeFrom.copy(gaze);
        gazeTo.set(rand(-0.6, 0.6), rand(-0.5, 0.4));
        gazeBlend = 0;
        nextGaze = t + rand(1.2, 3.5);
      }
      gazeBlend = Math.min(1, gazeBlend + dt / 0.12);
      gaze.lerpVectors(gazeFrom, gazeTo, gazeBlend);
      let targetYaw = 0;
      let targetPitch = 0;
      if (lookAt) {
        root.updateWorldMatrix(true, false);
        local.copy(lookAt);
        root.worldToLocal(local);
        targetYaw = clamp(Math.atan2(local.x, local.z), -0.8, 0.8);
        targetPitch = clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.4, 0.4);
      }
      const follow = 1 - Math.exp(-dt / 0.25);
      lookYaw += (targetYaw - lookYaw) * follow;
      lookPitch += (targetPitch - lookPitch) * follow;
      const saccade = lookAt ? 0.25 : 1;
      for (const pupil of pupils) {
        pupil.position.x = clamp(lookYaw * 0.08, -0.04, 0.04) + gaze.x * 0.03 * saccade;
        pupil.position.y = clamp(lookPitch * 0.08, -0.03, 0.03) + gaze.y * 0.04 * saccade;
      }

      // Eyebrows lift with the voice.
      for (const [i, brow] of brows.entries()) {
        brow.position.y = 0.34 + smoothedLevel * 0.04 + (state.attentive ? 0.025 : 0);
        brow.rotation.z = Math.PI / 2 + (i === 0 ? 0.18 : -0.18) + smoothedLevel * (i === 0 ? -0.1 : 0.1);
      }

      // Body: breathing, gentle sway, nodding with the voice, turning toward what it looks at, tilting when listening.
      body.scale.y = 1 + Math.sin(t * 1.5) * 0.008 * motion;
      neck.rotation.y = (Math.sin(t * 0.45) * 0.06 + Math.sin(t * 1.1) * 0.015) * motion + lookYaw * 0.75;
      neck.rotation.z = (state.attentive ? 0.07 : 0.012 * Math.sin(t * 0.6)) * motion;
      neck.rotation.x = (Math.sin(t * 0.7) * 0.02 + smoothedLevel * 0.07 * Math.sin(t * 5)) * motion - lookPitch * 0.4;
      tassel.rotation.z = Math.sin(t * 1.3 + neck.rotation.y * 4) * 0.12 * motion;
    },

    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}
