# @bloomengine/three

Run a three.js game natively on [Bloom](https://github.com/Bloom-Engine/engine), unchanged. The
game keeps the real three.js (scene graph, math, loaders, animation, raycasting, controls); only
`WebGLRenderer` is replaced by one that mirrors the scene into Bloom's renderer every frame.
[Perry](https://github.com/PerryTS/perry) compiles the result to a native app.
[@bloomengine/web](https://github.com/Bloom-Engine/web) provides the browser around it: the
page's DOM, input events, `fetch`, `localStorage`, Web Audio and `<audio>`.

```bash
npm install @bloomengine/engine @bloomengine/web @bloomengine/three
```

```ts
// bloom/main.ts
import { configure } from "@bloomengine/web/config";
configure({ app: "mygame", title: "My Game", root: new URL("../", import.meta.url).pathname });
import "@bloomengine/web";
import "../src/main.ts";            // the three.js game, unchanged
```

```bash
npx bloom-three build bloom/main.ts -o dist/mygame
```

`bloom-three build` runs `perry compile` with module aliases: `three` becomes this package's
`three.ts` (the real three.js, with the Bloom renderer as `WebGLRenderer`) and `GLTFLoader` a
subclass that marks skinned models for Bloom. `bloom-three aliases` prints the aliases for a
build script of your own.

## How a scene maps to Bloom

| three.js | Bloom |
|---|---|
| `PerspectiveCamera`, `OrthographicCamera` | `beginMode3D` with the camera's near and far planes |
| `scene.background` (a color), fog, `setClearColor` | the clear color |
| `AmbientLight`, `HemisphereLight` | ambient light |
| `DirectionalLight` (the brightest, or config `sun`) | the sun, with shadows when the renderer's `shadowMap` and the light cast them |
| `Mesh` with a standard, physical, Lambert, Phong or basic material | a retained scene node: geometry uploaded when it changes, transform, visibility and material every frame; vertex colors; `map` from an `<img>` file, a canvas or a data texture; basic materials draw as emissive |
| a glTF model with skinned meshes | a Bloom skinned model (GPU skinning), posed by the clip with the most weight in its `AnimationMixer` |
| `PMREMGenerator`, environment maps | Bloom's own image-based lighting |

## Limits

- Not drawn yet: `Points`, `Line`, `Sprite`, `InstancedMesh`, point and spot lights, skinned
  meshes that didn't come from `GLTFLoader`, morph targets. Each warns once.
- Shader materials, `onBeforeCompile`, post-processing (`EffectComposer`) and render targets need
  WebGL: they aren't translated.
- Skinned models switch clips instead of crossfading; Bloom poses a skinned model from its
  position, yaw and scale.
- Transparency and lighting come from Bloom's renderer, so a scene looks close to, not the same
  as, three.js's.

## Hooks

`configureThree()` (from `@bloomengine/three/config`, before the game's code runs):

| Hook | Default | |
|---|---|---|
| `parseFile(path)` | the file | the file three.js parses for a glTF URL: a low-poly copy makes loading and raycasting cheaper, since Bloom draws skinned models itself |
| `modelFile(root, path)` | the file | the file Bloom draws a skinned model from |
| `modelTint(root)` | white, the first transparent material's opacity | a skinned model's tint and opacity |
| `sun(lights)` | the brightest | which directional light is Bloom's sun |
