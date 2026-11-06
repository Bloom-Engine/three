/**
 * Hooks for the three.js bridge. The defaults draw any three.js scene; a
 * game sets these (before importing its code) only to tune what Bloom draws:
 *
 *   import { configureThree } from "@bloomengine/three/config";
 *   configureThree({ modelTint: (root) => ... });
 *
 * Side-effect free: safe to import from a game's Bloom entry first thing.
 */
import type { Object3D } from "@bloomengine/three/real/three";

export interface Tint { r: number; g: number; b: number; a: number }

export interface ThreeConfig {
  /**
   * The file three.js parses for a glTF URL (path on disk). three.js keeps the skeleton, clips
   * and a mesh for picking; Bloom draws skinned models itself, from `modelFile`. A low-poly copy
   * here makes loading and raycasting cheaper. Default: the file itself.
   */
  parseFile(path: string): string;
  /** The file Bloom draws a skinned glTF model from. Default: the file it was loaded from. */
  modelFile(root: Object3D, path: string): string;
  /**
   * A skinned model's tint (Bloom multiplies its albedo by it, in linear light, 0..255) and
   * opacity. Default: white, with the opacity of the model's first transparent material.
   */
  modelTint(root: Object3D): Tint | null;
  /** Which directional light becomes Bloom's sun when there are several. Default: the brightest. */
  sun(lights: Object3D[]): Object3D | null;
}

const settings: ThreeConfig = {
  parseFile: (path) => path,
  modelFile: (_root, path) => path,
  modelTint: () => null,
  sun: (lights) => {
    let best: Object3D | null = null, most = -1;
    for (const l of lights) { const i = (l as unknown as { intensity: number }).intensity; if (i > most) { most = i; best = l; } }
    return best;
  },
};

export function configureThree(options: Partial<ThreeConfig>): void { Object.assign(settings, options); }
export function threeConfig(): ThreeConfig { return settings; }
