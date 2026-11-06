/**
 * GLTFLoader for the Bloom build: three.js's own loader, which reads files
 * through the page's fetch and its embedded textures through blob URLs
 * (@bloomengine/web provides both). On top of it:
 *
 *  - which file three.js parses can be swapped (config parseFile: a
 *    low-poly copy for skeletons, clips and raycasting), and
 *  - a scene with skinned meshes is marked as a Bloom skinned model: the
 *    renderer has Bloom draw the full model on the GPU (config modelFile),
 *    posed by the clip the root's AnimationMixer plays.
 */
import { GLTFLoader as ThreeGLTFLoader } from "@bloomengine/three/real/GLTFLoader";
import type { GLTF } from "@bloomengine/three/real/GLTFLoader";
import { localPath } from "@bloomengine/web/fetch";
import { threeConfig } from "./config.ts";

function hasSkin(gltf: GLTF): boolean {
  let skinned = false;
  gltf.scene.traverse((o) => { if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) skinned = true; });
  return skinned;
}

export class GLTFLoader extends ThreeGLTFLoader {
  override load(url: string, onLoad: (gltf: GLTF) => void, onProgress?: (e: ProgressEvent) => void, onError?: (e: unknown) => void): void {
    const resolved = this.manager.resolveURL(url);
    const path = localPath(new URL(resolved, (globalThis as { location?: { href: string } }).location?.href).href);
    let target = resolved;
    if (path !== null) {
      const parsed = threeConfig().parseFile(path);
      if (parsed !== path) {
        target = "file://" + parsed;
        // relative resources (a .gltf's .bin and images) stay next to the original
        if (this.resourcePath === "") this.setResourcePath(resolved.slice(0, resolved.lastIndexOf("/") + 1));
      }
    }
    super.load(target, (gltf) => {
      if (path !== null && hasSkin(gltf)) {
        gltf.scene.userData.__bloomUrl = path;
        gltf.scene.userData.__clips = gltf.animations.map((clip) => clip.name);
      }
      onLoad(gltf);
    }, onProgress as never, onError);
  }
}
export type { GLTF };
