import type * as THREE from "three";
import type { Visemes } from "./lipSync";

/** What a character needs each frame to come alive. */
export interface RigState {
  /** Mouth shapes from the voice. */
  visemes: Visemes;
  /** 0..1 loudness of the voice, for nodding and eyebrows. */
  level: number;
  speaking: boolean;
  /** Waiting for the student to talk. */
  attentive: boolean;
}

/**
 * A character that can be placed in any three.js scene: the single-teacher view and the group table
 * both use the same rigs. The origin of `object` is the centre of the head.
 */
export interface Rig {
  object: THREE.Object3D;
  /** Multiply the object's scale by this to make the character about the size of a cartoon one. */
  scaleHint: number;
  /**
   * Set for characters posed to sit at a table: their real proportions need their own size and height so that
   * their forearms rest on the tabletop. `scale` is scene units per metre, `lift` raises them in scene units.
   */
  seatedFit?: { scale: number; lift: number };
  /** Advances the animation. `lookAt` is a world-space point to look at; omitted means looking ahead. */
  update(dt: number, state: RigState, lookAt?: THREE.Vector3): void;
  dispose(): void;
}
