/**
 * WebGLRenderer for Bloom: each render(scene, camera) mirrors the three.js
 * scene into Bloom.
 *
 *  - camera            -> beginMode3D (perspective or orthographic), the
 *                         camera's near/far as Bloom's clip planes
 *  - background        -> the clear color (scene.background, the fog color,
 *                         or setClearColor)
 *  - lights            -> Bloom's ambient light (ambient and hemisphere
 *                         lights) and sun (a directional light), shadows
 *  - Mesh              -> a retained Bloom scene node: geometry uploaded
 *                         once (again when it changes), transform,
 *                         visibility and material synced every frame;
 *                         textures from canvases, data textures and <img>
 *                         files. MeshBasicMaterial draws as emissive
 *  - skinned glTF root -> a Bloom skinned model (GPU skinning) posed by the
 *                         clip with the most weight in its AnimationMixer
 *
 * three.js keeps what it does well under Perry (scene graph, math,
 * animation state, raycasting); Bloom does the per-vertex work and drawing.
 */
import * as THREE from "@bloomengine/three/real/three";
import { beginMode3D, endMode3D, clearBackground } from "@bloomengine/engine";
import {
  loadModel, loadModelAnimation, instantiateAnimation, updateModelAnimation, drawModel,
  setAmbientLight, setDirectionalLight, setProceduralSky,
} from "@bloomengine/engine/models";
import type { Model } from "@bloomengine/engine/core";
import {
  createSceneNode, updateSceneNodeGeometry, setSceneNodeTransform, setSceneNodeVisible,
  setSceneNodeMaterial, setSceneNodeMaterialTextureHandles, setSceneNodeCastShadow, setSceneNodeReceiveShadow,
  enableShadows, disableShadows,
} from "@bloomengine/engine/scene";
import { createTextureRgba8, loadTexture, genTextureMipmaps } from "@bloomengine/engine/textures";
import { setCameraClipPlanes } from "@bloomengine/engine/core";
import { setFrameCallback, screenSize, cssSize, extraTimings, setViewCanvas, document } from "@bloomengine/web";
import { mixerOf } from "./mixers.ts";
import { threeConfig } from "./config.ts";

interface NodeState { handle: number; material: string; geometry: string; visible: boolean; seen: number }
interface SkinnedState { model: Model; anim: number }

const models = new Map<string, Model>();
const anims = new Map<string, number>();
const textures = new Map<string, number>();
const files = new Map<string, number>();
let warned = new Set<string>();
function warnOnce(what: string): void { if (!warned.has(what)) { warned.add(what); console.error("three.js on Bloom: " + what); } }

/** sRGB bytes of a color, as CSS has it. */
function rgb(color: THREE.Color): [number, number, number] {
  const hex = color.getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export class BloomRenderer {
  readonly domElement: unknown;
  readonly isWebGLRenderer = true;
  shadowMap = { enabled: false, type: 1, autoUpdate: true, needsUpdate: false };
  toneMapping = 0;
  toneMappingExposure = 1;
  outputColorSpace = "srgb";
  outputEncoding = 3001;
  useLegacyLights = false;
  physicallyCorrectLights = true;
  sortObjects = true;
  autoClear = true;
  autoClearColor = true;
  autoClearDepth = true;
  autoClearStencil = true;
  localClippingEnabled = false;
  clippingPlanes: unknown[] = [];
  xr = { enabled: false, isPresenting: false, setAnimationLoop: (): void => {}, getSession: (): null => null, addEventListener: (): void => {}, removeEventListener: (): void => {} };
  capabilities = { getMaxAnisotropy: (): number => 16, getMaxPrecision: (): string => "highp", isWebGL2: true, maxTextureSize: 8192, maxCubemapSize: 8192, maxSamples: 4, precision: "highp", logarithmicDepthBuffer: false, maxVertexTextures: 16, maxTextures: 16 };
  extensions = { get: (): null => null, has: (): boolean => false, init: (): void => {} };
  properties = { get: (): Record<string, unknown> => ({}), remove: (): void => {} };
  info = { autoReset: true, render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] as unknown[], reset(): void {} };
  private nodes = new Map<THREE.Mesh, NodeState>();
  private skinned = new Map<THREE.Object3D, SkinnedState>();
  private frame = 0;
  private lights = "";
  private near = 0;
  private far = 0;
  private clear_ = new THREE.Color(0x000000);
  private clearAlpha = 1;
  private pixelRatio = 1;

  constructor(parameters: { canvas?: unknown; antialias?: boolean; alpha?: boolean } = {}) {
    let canvas = parameters.canvas;
    if (canvas === undefined || canvas === null) {
      // as three.js does: a canvas of its own, which the page then appends
      canvas = document.createElement("canvas");
      setViewCanvas(canvas as never);
    }
    this.domElement = canvas;
    if (parameters.alpha === true) this.clearAlpha = 0;
    setProceduralSky(false);
  }

  setPixelRatio(ratio: number): void { this.pixelRatio = ratio; }
  getPixelRatio(): number { return this.pixelRatio; }
  setSize(width: number, height: number, updateStyle = true): void {
    const c = this.domElement as { width?: number; height?: number; style?: Record<string, string> } | null;
    if (c !== null && typeof c === "object") {
      c.width = Math.floor(width * this.pixelRatio);
      c.height = Math.floor(height * this.pixelRatio);
      if (updateStyle && c.style !== undefined) { c.style["width"] = width + "px"; c.style["height"] = height + "px"; }
    }
  }
  getSize(target: THREE.Vector2): THREE.Vector2 { const s = cssSize(); return target.set(s.width, s.height); }
  getDrawingBufferSize(target: THREE.Vector2): THREE.Vector2 { const s = screenSize(); return target.set(s.width, s.height); }
  setDrawingBufferSize(): void {}
  setViewport(): void {}
  getViewport(target: THREE.Vector4): THREE.Vector4 { const s = cssSize(); return target.set(0, 0, s.width, s.height); }
  setScissor(): void {}
  getScissor(target: THREE.Vector4): THREE.Vector4 { const s = cssSize(); return target.set(0, 0, s.width, s.height); }
  setScissorTest(): void {}
  getScissorTest(): boolean { return false; }
  setClearColor(color: THREE.ColorRepresentation, alpha = 1): void { this.clear_.set(color); this.clearAlpha = alpha; }
  getClearColor(target: THREE.Color): THREE.Color { return target.copy(this.clear_); }
  setClearAlpha(alpha: number): void { this.clearAlpha = alpha; }
  getClearAlpha(): number { return this.clearAlpha; }
  clear(): void {}
  clearColor(): void {}
  clearDepth(): void {}
  clearStencil(): void {}
  setRenderTarget(target: unknown): void { if (target !== null) warnOnce("render targets aren't supported: drawing goes to the window"); }
  getRenderTarget(): null { return null; }
  getActiveCubeFace(): number { return 0; }
  getActiveMipmapLevel(): number { return 0; }
  readRenderTargetPixels(): void {}
  copyFramebufferToTexture(): void {}
  initTexture(): void {}
  compile(): Set<unknown> { return new Set(); }
  compileAsync(): Promise<void> { return Promise.resolve(); }
  getContext(): null { return null; }
  getContextAttributes(): Record<string, boolean> { return { alpha: this.clearAlpha < 1, antialias: true, depth: true, stencil: false }; }
  forceContextLoss(): void {}
  dispose(): void {}
  init(): Promise<void> { return Promise.resolve(); }

  /** Frames come from the Bloom window (frame.ts), with the browser's callback signature. */
  setAnimationLoop(callback: ((time: number) => void) | null): void { setFrameCallback(callback); }

  render(scene: THREE.Object3D, camera: THREE.Camera): void {
    this.frame++;
    const t0 = Date.now();
    if (scene.matrixWorldAutoUpdate !== false) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate !== false) camera.updateMatrixWorld();
    const t1 = Date.now();
    // a gradient or texture sky clears to the horizon color: the fog color, which the floor fades into
    const s = scene as THREE.Scene;
    const fog = s.fog as THREE.Fog | null | undefined;
    const bg = s.background instanceof THREE.Color ? rgb(s.background) : fog !== null && fog !== undefined ? rgb(fog.color) : rgb(this.clear_);
    clearBackground({ r: bg[0], g: bg[1], b: bg[2], a: 255 });
    this.syncLights(scene);
    const t2 = Date.now();
    this.camera(camera);
    this.visit(scene);
    for (const state of this.nodes.values()) {
      if (state.seen !== this.frame && state.visible) { setSceneNodeVisible(state.handle, false); state.visible = false; }
    }
    endMode3D();
    extraTimings["matrices"] = (extraTimings["matrices"] ?? 0) + t1 - t0;
    extraTimings["lights"] = (extraTimings["lights"] ?? 0) + t2 - t1;
    extraTimings["scene"] = (extraTimings["scene"] ?? 0) + Date.now() - t2;
    this.info.render.frame = this.frame;
  }

  private camera(camera: THREE.Camera): void {
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const look = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(eye);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const persp = camera as THREE.PerspectiveCamera, ortho = camera as THREE.OrthographicCamera;
    const near = persp.near ?? 0.1, far = persp.far ?? 2000;
    if (near !== this.near || far !== this.far) {
      this.near = near; this.far = far;
      setCameraClipPlanes(near, far);
    }
    const isOrtho = ortho.isOrthographicCamera === true;
    // a perspective camera's zoom narrows its view, as in three.js
    const fovy = isOrtho ? (ortho.top - ortho.bottom) / ortho.zoom
      : (2 * Math.atan(Math.tan((persp.fov * Math.PI) / 360) / (persp.zoom ?? 1)) * 180) / Math.PI;
    beginMode3D({
      position: { x: eye.x, y: eye.y, z: eye.z }, target: { x: look.x, y: look.y, z: look.z },
      up: { x: up.x, y: up.y, z: up.z }, fovy, projection: isOrtho ? "orthographic" : "perspective",
    });
  }

  private visit(o: THREE.Object3D): void {
    if (!o.visible) return;
    if (typeof o.userData.__bloomUrl === "string") { this.drawModelRoot(o); return; }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh === true && (o as THREE.SkinnedMesh).isSkinnedMesh !== true) this.syncMesh(mesh);
    else if ((o as THREE.SkinnedMesh).isSkinnedMesh === true) warnOnce("a skinned mesh outside a glTF model isn't drawn (load skinned models with GLTFLoader)");
    else if ((o as THREE.Points).isPoints === true || (o as THREE.Line).isLine === true || (o as THREE.Sprite).isSprite === true) warnOnce("points, lines and sprites aren't drawn yet");
    const children = o.children;
    const n = children.length;
    for (let i = 0; i < n; i++) { const c = children[i]; if (c !== undefined) this.visit(c); }
  }

  private syncLights(scene: THREE.Object3D): void {
    const found: THREE.Light[] = [];
    scene.traverseVisible((o) => { if ((o as THREE.Light).isLight === true) found.push(o as THREE.Light); });
    let key = "";
    for (const l of found) key += l.type + l.color.getHexString() + l.intensity.toFixed(3) + l.matrixWorld.elements.join(",") + (l.castShadow ? "s" : "") + ";";
    if (key === this.lights) return;
    this.lights = key;
    let ambient = 0;
    let ambientColor: [number, number, number] = [255, 255, 255];
    let shadows = false;
    const directional: THREE.DirectionalLight[] = [];
    for (const l of found) {
      if ((l as THREE.HemisphereLight).isHemisphereLight === true || (l as THREE.AmbientLight).isAmbientLight === true) {
        ambient += l.intensity;
        ambientColor = rgb(l.color);
      }
      if ((l as THREE.DirectionalLight).isDirectionalLight === true) directional.push(l as THREE.DirectionalLight);
      if (l.castShadow) shadows = true;
      if ((l as THREE.PointLight).isPointLight === true || (l as THREE.SpotLight).isSpotLight === true) warnOnce("point and spot lights aren't drawn yet");
    }
    const sun = threeConfig().sun(directional) as THREE.DirectionalLight | null;
    if (sun !== null) {
      const from = new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld);
      const to = new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld);
      const dir = to.sub(from).normalize();
      const c = rgb(sun.color);
      setDirectionalLight({ x: dir.x, y: dir.y, z: dir.z }, { r: c[0], g: c[1], b: c[2], a: 255 }, sun.intensity);
    }
    setAmbientLight({ r: ambientColor[0], g: ambientColor[1], b: ambientColor[2], a: 255 }, Math.min(1, ambient));
    if (shadows && this.shadowMap.enabled) enableShadows(); else disableShadows();
  }

  // ------------------------------------------------------------ meshes

  private syncMesh(mesh: THREE.Mesh): void {
    let state = this.nodes.get(mesh);
    if (state === undefined) {
      const handle = createSceneNode();
      setSceneNodeCastShadow(handle, mesh.castShadow);
      setSceneNodeReceiveShadow(handle, mesh.receiveShadow);
      state = { handle, material: "", geometry: "?", visible: true, seen: 0 };
      this.nodes.set(mesh, state);
    }
    state.seen = this.frame;
    if (!state.visible) { setSceneNodeVisible(state.handle, true); state.visible = true; }
    setSceneNodeTransform(state.handle, mesh.matrixWorld.elements as unknown as number[]);
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    if (material === undefined) return;
    if (material.color === undefined) { warnOnce(material.type + " isn't drawn (no color: shader materials need WebGL)"); setSceneNodeVisible(state.handle, false); state.visible = false; return; }
    if (material.visible === false) { setSceneNodeVisible(state.handle, false); state.visible = false; return; }
    const map = material.map ?? null;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    // the map's repeat and offset go into the uvs (a tiled floor): upload again when they change,
    // and when the geometry or its positions change
    const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
    const geo = geometry.uuid + ":" + String(pos?.version ?? 0) + (map === null ? "" : `:${map.repeat.x},${map.repeat.y},${map.offset.x},${map.offset.y},${map.flipY}`);
    if (geo !== state.geometry) { state.geometry = geo; uploadGeometry(state.handle, geometry, map); }
    const glow = material.emissive !== undefined && material.emissive.getHex() !== 0 ? material.emissive.clone().multiplyScalar(material.emissiveIntensity ?? 1) : null;
    const key = material.uuid + material.color.getHexString() + String(material.opacity) + String(material.roughness) + String(material.metalness) +
      (glow === null ? "" : glow.getHexString()) + (map === null ? "-" : map.uuid + String(map.version));
    if (key === state.material) return;
    state.material = key;
    const color = rgb(material.color);
    const opacity = material.transparent ? material.opacity : 1;
    if ((material as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial === true) {
      // unlit: the color as emitted light
      const lin = material.color;
      setSceneNodeMaterial(state.handle, { color: [0, 0, 0], roughness: 1, metalness: 0, opacity, emissive: [lin.r * 1.2, lin.g * 1.2, lin.b * 1.2] });
    } else {
      const shininess = (material as unknown as { shininess?: number }).shininess;
      const roughness = material.roughness ?? (shininess !== undefined ? Math.max(0.05, 1 - Math.sqrt(shininess / 100)) : 0.6);
      setSceneNodeMaterial(state.handle, {
        color, roughness, metalness: material.metalness ?? 0, opacity,
        ...(glow === null ? {} : { emissive: [glow.r, glow.g, glow.b] }),   // linear, as for the unlit markers
      });
    }
    // 0 clears it: a texture taken away
    setSceneNodeMaterialTextureHandles(state.handle, { baseColor: map === null ? 0 : uploadTexture(map) });
  }

  // ------------------------------------------------------------ skinned models

  private drawModelRoot(root: THREE.Object3D): void {
    let state = this.skinned.get(root);
    if (state === undefined) {
      const url = threeConfig().modelFile(root, root.userData.__bloomUrl as string);
      let model = models.get(url);
      if (model === undefined) { model = loadModel(url); models.set(url, model); }
      let source = anims.get(url);
      if (source === undefined) { source = loadModelAnimation(url); anims.set(url, source); }
      state = { model, anim: instantiateAnimation(source) };
      this.skinned.set(root, state);
    }
    // the clip with the most weight in the root's three.js mixer, at its current time
    const clips = (root.userData.__clips ?? []) as string[];
    let clip = -1, time = 0, best = 0;
    const mixer = mixerOf(root);
    const actions = mixer === undefined ? [] : ((mixer as unknown as { _actions: THREE.AnimationAction[] })._actions ?? []);
    const count = actions.length;
    for (let i = 0; i < count; i++) {
      const a = actions[i];
      if (a === undefined || !a.enabled) continue;
      const w = a.getEffectiveWeight();
      if (w > best) { best = w; clip = clips.indexOf(a.getClip().name); time = a.time; }
    }
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    root.matrixWorld.decompose(pos, quat, scale);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const yaw = Math.atan2(forward.x, forward.z);
    const s = scale.x;
    if (s < 0.002) return;
    updateModelAnimation(state.anim, clip < 0 ? 0 : clip, clip < 0 ? 0 : time, s, pos.x, pos.y, pos.z, yaw);
    let tint = threeConfig().modelTint(root);
    if (tint === null) {
      let a = 255;
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (a === 255 && m !== undefined && !Array.isArray(m) && m.transparent) a = Math.round(m.opacity * 255);
      });
      tint = { r: 255, g: 255, b: 255, a };
    }
    drawModel(state.model, { x: pos.x, y: pos.y, z: pos.z }, s, tint);
  }
}

/** BufferGeometry -> Bloom's 12-float vertices (position, normal, color, uv). */
function uploadGeometry(handle: number, geometry: THREE.BufferGeometry, map: THREE.Texture | null): void {
  const pos = geometry.attributes.position;
  if (pos === undefined) return;
  const nor = geometry.attributes.normal, uv = geometry.attributes.uv, col = geometry.attributes.color;
  const n = pos.count;
  const rx = map?.repeat.x ?? 1, ry = map?.repeat.y ?? 1, ox = map?.offset.x ?? 0, oy = map?.offset.y ?? 0;
  // flipped textures (three's flipY: canvases, <img>): their v runs from the bottom row; glTF's from the top
  const flip = map?.flipY !== false;
  const vertices: number[] = [];
  for (let i = 0; i < n; i++) {
    vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (nor !== undefined) vertices.push(nor.getX(i), nor.getY(i), nor.getZ(i)); else vertices.push(0, 1, 0);
    if (col !== undefined) vertices.push(col.getX(i), col.getY(i), col.getZ(i), col.itemSize > 3 ? col.getW(i) : 1); else vertices.push(1, 1, 1, 1);
    if (uv !== undefined) { const v = uv.getY(i) * ry + oy; vertices.push(uv.getX(i) * rx + ox, flip ? 1 - v : v); } else vertices.push(0, 0);
  }
  const indices: number[] = [];
  const index = geometry.index;
  const groups = geometry.drawRange;
  if (index !== null) { const m = Math.min(index.count, groups.count === Infinity ? index.count : groups.start + groups.count); for (let i = groups.start; i < m; i++) indices.push(index.getX(i)); }
  else for (let i = 0; i < n; i++) indices.push(i);
  updateSceneNodeGeometry(handle, vertices, indices);
}

/** A three.js texture -> a Bloom texture: an <img>'s file, a canvas's or data texture's RGBA bytes. */
function uploadTexture(texture: THREE.Texture): number {
  const own = texture.userData.__bloomTexture;
  if (typeof own === "number") return own;
  const image = texture.image as { file?: string | null; width?: number; height?: number; data?: ArrayLike<number> | null } | null;
  if (image === null || image === undefined) return 0;
  if (typeof image.file === "string") {
    let handle = files.get(image.file);
    if (handle === undefined) {
      const t = loadTexture(image.file);
      if (texture.generateMipmaps !== false) genTextureMipmaps(t);
      handle = t.handle;
      files.set(image.file, handle);
    }
    return handle;
  }
  const key = texture.uuid + ":" + String(texture.version);
  const known = textures.get(key);
  if (known !== undefined) return known;
  const data = image.data, w = image.width ?? 0, h = image.height ?? 0;
  if (data === null || data === undefined || w === 0 || h === 0) return 0;
  let rgba: Uint8ClampedArray;
  if (data.length === w * h * 4 && (data instanceof Uint8Array || data instanceof Uint8ClampedArray)) rgba = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  else if (data.length === w * h * 4) { rgba = new Uint8ClampedArray(data.length); for (let i = 0; i < data.length; i++) rgba[i] = Math.round((data[i] ?? 0) * 255); }
  else { warnOnce("a data texture that isn't RGBA isn't drawn"); return 0; }
  const handle = createTextureRgba8(rgba, w, h).handle;
  textures.set(key, handle);
  return handle;
}

export function resetRendererWarnings(): void { warned = new Set(); }
