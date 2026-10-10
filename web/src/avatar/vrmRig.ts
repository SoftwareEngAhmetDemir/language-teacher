import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { Rig, RigState } from "./rig";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/**
 * Loads a VRM model as a rig: lip sync through the standard mouth expressions, blinking, breathing,
 * eye and head movement. The model is shifted so the middle of its head is the rig's origin.
 */
/**
 * Arm angles (radians) for resting both forearms on a table; the right arm mirrors the left. Tuned by measuring
 * the wrists against the tabletop in the group scene: the elbows sit just above the table and the wrists on it.
 * `upperArmYaw` turns the forearms a little toward each other, and `forearmRoll` turns the palms to face down
 * (without it the palms face each other, like hands in prayer).
 */
export const SEATED_POSE = { upperArmDown: 1.45, upperArmForward: -0.2, upperArmYaw: 0.2, elbowBend: 1.1, forearmRoll: 1.4 };

/**
 * A seated VRM character's own proportions: 3.4 scene units per metre, and 0.2 units lower than the cartoon
 * characters, so that the tabletop meets them at elbow height like it does the others.
 */
const SEATED_FIT = { scale: 3.4, lift: -0.2 };

export async function loadVrmRig(url: string, options: { seated?: boolean } = {}): Promise<Rig> {
  const gltf = await new GLTFLoader().register((parser) => new VRMLoaderPlugin(parser)).loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // no-op for VRM 1.0 models, turns older ones to face the camera

  // Models load in a T-pose; let the arms hang.
  const lowerArm = (name: "leftUpperArm" | "rightUpperArm", z: number) => {
    const bone = vrm.humanoid.getNormalizedBoneNode(name);
    if (bone) bone.rotation.z = z;
  };
  lowerArm("leftUpperArm", -1.2);
  lowerArm("rightUpperArm", 1.2);
  vrm.humanoid.update();

  const headBone = vrm.humanoid.getNormalizedBoneNode("head")!;
  const headPosition = new THREE.Vector3();
  headBone.getWorldPosition(headPosition);
  vrm.scene.position.sub(headPosition);
  const object = new THREE.Group();
  object.add(vrm.scene);

  // The eyes follow this point. It is not part of the scene, only a position.
  const gaze = new THREE.Object3D();
  if (vrm.lookAt) vrm.lookAt.target = gaze;
  const gazeTarget = new THREE.Vector3();
  const local = new THREE.Vector3();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const expressions = vrm.expressionManager!;
  const bone = (name: "head" | "neck" | "spine" | "chest") => vrm.humanoid.getNormalizedBoneNode(name);
  let t = 0;
  let nextBlink = rand(1.5, 4);
  let blinkStart = -1;
  let nextGaze = 0;
  const saccade = new THREE.Vector2();
  let smoothedLevel = 0;
  let lookYaw = 0;

  const poseSeated = () => {
    const pose = SEATED_POSE;
    for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
      const upper = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lower = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      if (upper) upper.rotation.set(pose.upperArmForward, sign * pose.upperArmYaw, sign * pose.upperArmDown);
      // Roll the forearm about its own length first, then bend the elbow: the order is Y after X.
      if (lower) lower.rotation.set(pose.forearmRoll, sign * pose.elbowBend, 0, "YXZ");
    }
  };
  if (options.seated) poseSeated();

  return {
    object,
    scaleHint: 4.4,
    seatedFit: options.seated ? SEATED_FIT : undefined,

    update(dt, state: RigState, lookAt) {
      t += dt;
      if (options.seated) poseSeated();
      const v = state.visemes;
      expressions.setValue("aa", v.aa);
      expressions.setValue("ih", v.ih);
      expressions.setValue("ou", v.ou);
      expressions.setValue("ee", v.ee);
      expressions.setValue("oh", v.oh);
      smoothedLevel += (state.level - smoothedLevel) * (1 - Math.exp(-dt / 0.12));

      // A slight smile while talking keeps the face friendly.
      const smile = state.speaking || smoothedLevel > 0.1 ? 0.25 : 0.12;
      expressions.setValue("happy", (expressions.getValue("happy") ?? 0) * 0.9 + smile * 0.1);

      // Blink every few seconds, quick down and a little slower up.
      if (blinkStart < 0 && t > nextBlink) blinkStart = t;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 0.2;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + rand(2, 5.5);
          expressions.setValue("blink", 0);
        } else {
          expressions.setValue("blink", p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6);
        }
      }

      // Eyes: at the point being looked at, or straight ahead, with small shifts of attention now and then.
      if (t > nextGaze) {
        saccade.set(rand(-0.8, 0.8), rand(-0.5, 0.4));
        nextGaze = t + rand(1.2, 3.5);
      }
      object.updateWorldMatrix(true, false);
      if (lookAt) {
        gazeTarget.copy(lookAt);
        gazeTarget.x += saccade.x * 0.1;
        gazeTarget.y += saccade.y * 0.1;
      }
      else gazeTarget.set(saccade.x, saccade.y, 5).applyMatrix4(object.matrixWorld);
      gaze.position.lerp(gazeTarget, 1 - Math.exp(-dt / 0.12));

      // The head turns a little toward what it looks at.
      let targetYaw = 0;
      if (lookAt) {
        local.copy(lookAt);
        object.worldToLocal(local);
        targetYaw = clamp(Math.atan2(local.x, local.z), -0.8, 0.8);
      }
      lookYaw += (targetYaw - lookYaw) * (1 - Math.exp(-dt / 0.25));

      // Body: breathing, a gentle sway, nodding with the voice, tilting the head when listening.
      const motion = reduceMotion ? 0 : 1;
      const head = bone("head");
      const neck = bone("neck");
      const chest = bone("chest") ?? bone("spine");
      if (chest) chest.rotation.x = Math.sin(t * 1.5) * 0.012 * motion;
      if (neck) {
        neck.rotation.y = (Math.sin(t * 0.45) * 0.04 + Math.sin(t * 1.1) * 0.012) * motion + lookYaw * 0.5;
        neck.rotation.z = (state.attentive ? 0.05 : 0.01 * Math.sin(t * 0.6)) * motion;
      }
      if (head) {
        head.rotation.x = (Math.sin(t * 0.7) * 0.015 + smoothedLevel * 0.05 * Math.sin(t * 5)) * motion;
        head.rotation.y = Math.sin(t * 0.33 + 1) * 0.03 * motion + lookYaw * 0.3;
      }

      vrm.update(dt);
    },

    dispose() {
      object.remove(vrm.scene);
      VRMUtils.deepDispose(vrm.scene);
    },
  };
}
