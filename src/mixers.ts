/** three's AnimationMixer, remembering its root so the Bloom renderer can find the clip a model plays. */
import { AnimationMixer as ThreeMixer } from "@bloomengine/three/real/three";
import type { Object3D } from "@bloomengine/three/real/three";

const byRoot = new Map<Object3D, AnimationMixer>();

export class AnimationMixer extends ThreeMixer {
  constructor(root: Object3D) {
    super(root);
    byRoot.set(root, this);
  }
}

/** The mixers made for a root, and any made for its descendants' roots. */
export function mixerOf(root: Object3D): AnimationMixer | undefined { return byRoot.get(root); }

/** Forget a root (it left the scene for good). */
export function forgetMixer(root: Object3D): void { byRoot.delete(root); }
