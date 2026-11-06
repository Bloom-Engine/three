#!/usr/bin/env node
// bloom-three: compile a three.js game for Bloom with Perry, unchanged.
//
//   bloom-three build <entry.ts> [-o out] [perry compile options...]
//       perry compile with the module aliases below
//   bloom-three aliases
//       the --module-alias options alone, one per line (for a build script of your own)
//
// The aliases map `three` (and three/webgpu) to this package's three.ts (the
// real three.js with a Bloom renderer), GLTFLoader to its Bloom-aware
// subclass, and the private specifiers this package uses for the real
// files to the game's own three.js install. Run it from the game's
// folder: three is resolved from there.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));
const src = (f) => join(pkg, "src", f);

function threeDir() {
  const require = createRequire(join(process.cwd(), "noop.js"));
  try { return dirname(require.resolve("three/package.json")); } catch {
    // three's package.json may not be exported: look for the folder
    for (let d = process.cwd(); ; d = dirname(d)) {
      const p = join(d, "node_modules", "three");
      if (existsSync(join(p, "package.json"))) return p;
      if (dirname(d) === d) break;
    }
  }
  console.error("bloom-three: three.js isn't installed here (npm install three)");
  process.exit(1);
}

export function aliases() {
  const three = realpathSync(threeDir());
  const real = join(three, "build", "three.module.js");
  const realGltf = join(three, "examples", "jsm", "loaders", "GLTFLoader.js");
  const map = {
    "three": src("three.ts"),
    "three/webgpu": src("three.ts"),
    "@bloomengine/three/real/three": real,
    "@bloomengine/three/real/GLTFLoader": realGltf,
    "three/addons/loaders/GLTFLoader.js": src("gltf-loader.ts"),
    "three/examples/jsm/loaders/GLTFLoader.js": src("gltf-loader.ts"),
    "three/addons/loaders/GLTFLoader": src("gltf-loader.ts"),
    "three/examples/jsm/loaders/GLTFLoader": src("gltf-loader.ts"),
  };
  return Object.entries(map).map(([k, v]) => `--module-alias=${k}=${v}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "aliases") {
  console.log(aliases().join("\n"));
} else if (command === "build") {
  const entry = rest[0];
  if (entry === undefined) { console.error("usage: bloom-three build <entry.ts> [-o out] [perry options]"); process.exit(2); }
  const perry = process.env.PERRY ?? "perry";
  const args = ["compile", ...rest, ...aliases()];
  const r = spawnSync(perry, args, { stdio: "inherit" });
  process.exit(r.status ?? 1);
} else {
  console.error("usage: bloom-three build <entry.ts> [-o out] [perry options] | bloom-three aliases");
  process.exit(2);
}
