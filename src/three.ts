/**
 * `three`, for the Bloom build (the build maps the `three` import here).
 *
 * Everything is the real three.js (scene graph, math, loaders, animation)
 * except what needs a browser GPU: WebGLRenderer is a renderer that mirrors
 * the scene into Bloom (renderer.ts), PMREMGenerator hands back an empty
 * environment (Bloom lights scenes with its own image-based lighting), and
 * AnimationMixer remembers its root so the renderer can read which clip a
 * skinned model plays.
 */
export * from "@bloomengine/three/real/three";
export { BloomRenderer as WebGLRenderer, BloomRenderer as WebGPURenderer } from "./renderer.ts";
export { AnimationMixer } from "./mixers.ts";

/** Environment maps are Bloom's: an empty texture slot. */
export class PMREMGenerator {
  constructor(_renderer?: unknown) {}
  fromScene(_scene?: unknown, _sigma?: number, _near?: number, _far?: number): { texture: null; dispose(): void } { return { texture: null, dispose(): void {} }; }
  fromEquirectangular(_texture?: unknown): { texture: null; dispose(): void } { return { texture: null, dispose(): void {} }; }
  fromCubemap(_texture?: unknown): { texture: null; dispose(): void } { return { texture: null, dispose(): void {} }; }
  compileEquirectangularShader(): void {}
  compileCubemapShader(): void {}
  dispose(): void {}
}
