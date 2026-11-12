// Updates the Game Center's shared copy of three.js in public/vendor/three/.
//
//   npm run update-three              # the version pinned in public/vendor/three/VERSION.json
//   npm run update-three -- 0.188.0   # move every game to a new release
//
// Every 3D game imports three.js from this one shared folder (never from a CDN), so all
// games always run on the same release and work offline. What this does:
//   1. downloads the requested `three` package from npm
//   2. minifies build/three.core.js, build/three.module.js (WebGLRenderer), build/three.tsl.js
//      and build/three.webgpu.js (WebGPURenderer + node materials) into *.min.js files that all
//      share one three.core.min.js (three no longer ships minified builds)
//   3. copies the add-ons the games use (public/vendor/three/addons.json, plus any
//      `vendor/three/addons/...` import found in public/games) and everything they import,
//      rewriting `from 'three'`, `'three/webgpu'` and `'three/tsl'` to relative paths so they
//      load without an import map
//   4. writes VERSION.json and the three.js LICENSE
// After running it: `npm test`, then open each 3D game and check the console.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'public', 'vendor', 'three');
const addonsDir = path.join(vendor, 'addons');
const versionFile = path.join(vendor, 'VERSION.json');
const manifestFile = path.join(vendor, 'addons.json');

const pinned = fs.existsSync(versionFile) ? JSON.parse(fs.readFileSync(versionFile, 'utf8')).version : null;
const version = process.argv[2] || pinned;
if (!version || !/^0\.\d+\.\d+$/.test(version)) {
  console.error('Usage: npm run update-three -- 0.187.0');
  process.exit(1);
}

// ---------- 1. download ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'three-'));
console.log(`Downloading three@${version}…`);
execFileSync('npm', ['pack', `three@${version}`, '--silent', '--pack-destination', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'));
execFileSync('tar', ['xzf', path.join(tmp, tgz), '-C', tmp]);
const pkg = path.join(tmp, 'package');
const revision = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version.split('.')[1];

// ---------- 2. core build ----------
fs.mkdirSync(vendor, { recursive: true });
const banner = `/* three.js r${revision} (${version}) — https://threejs.org — MIT License */`;
async function minify(src, out, rewrite = (s) => s) {
  const code = rewrite(fs.readFileSync(src, 'utf8'));
  const result = await esbuild.transform(code, { minify: true, format: 'esm', target: 'es2020', legalComments: 'none', banner });
  fs.writeFileSync(out, result.code);
  return result.code.length;
}
const coreSize = await minify(path.join(pkg, 'build', 'three.core.js'), path.join(vendor, 'three.core.min.js'));
const moduleSize = await minify(path.join(pkg, 'build', 'three.module.js'), path.join(vendor, 'three.module.min.js'), (s) => {
  if (!s.includes("'./three.core.js'")) throw new Error('three.module.js no longer imports ./three.core.js — check the new build layout');
  return s.replaceAll("'./three.core.js'", "'./three.core.min.js'");
});
// WebGPU build: three.tsl.js holds the node system (TSL), three.webgpu.js the WebGPURenderer
// (with its WebGL 2 fallback) and re-exports core + nodes, like the 'three/webgpu' entry point
const toMin = (s, deps) => {
  for (const d of deps) {
    if (!s.includes(`'./${d}.js'`)) throw new Error(`build/ no longer imports ./${d}.js the way update-three expects — check the new build layout`);
    s = s.replaceAll(`'./${d}.js'`, `'./${d}.min.js'`);
  }
  if (/from\s*['"]\.\/three\.(?!core\.min|tsl\.min)[\w.]+['"]/.test(s)) throw new Error('unexpected import in the WebGPU build');
  return s;
};
const tslSize = await minify(path.join(pkg, 'build', 'three.tsl.js'), path.join(vendor, 'three.tsl.min.js'), (s) => toMin(s, ['three.core']));
const webgpuSize = await minify(path.join(pkg, 'build', 'three.webgpu.js'), path.join(vendor, 'three.webgpu.min.js'), (s) => toMin(s, ['three.core', 'three.tsl']));

// ---------- 3. add-ons ----------
const wanted = new Set(fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).addons : []);
for (const file of walk(path.join(root, 'public', 'games'))) {
  if (!/\.(js|mjs|html)$/.test(file)) continue;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/vendor\/three\/addons\/([\w/.-]+\.js)/g)) wanted.add(m[1]);
}
const copied = new Set();
const queue = [...wanted];
fs.rmSync(addonsDir, { recursive: true, force: true });
while (queue.length) {
  const rel = queue.shift();
  if (copied.has(rel)) continue;
  const src = path.join(pkg, 'examples', 'jsm', rel);
  if (!fs.existsSync(src)) throw new Error(`Add-on not found in three@${version}: ${rel}`);
  copied.add(rel);
  let code = fs.readFileSync(src, 'utf8');
  const depth = rel.split('/').length; // addons/<rel> → back up to vendor/three
  const up = '../'.repeat(depth);
  code = code.replace(/(from\s*|import\s*\(\s*)(['"])three\2/g, `$1$2${up}three.module.min.js$2`);
  code = code.replace(/(from\s*|import\s*\(\s*)(['"])three\/(webgpu|tsl)\2/g, (_, a, q, b) => `${a}${q}${up}three.${b}.min.js${q}`);
  code = code.replace(/(from\s*|import\s*\(\s*)(['"])three\/addons\/([^'"]+)\2/g, (_, a, q, p) => `${a}${q}${'../'.repeat(depth - 1)}${p}${q}`);
  if (/(from\s*|import\s*\(\s*)['"]three(\/|['"])/.test(code)) throw new Error(`Unrewritten three import left in ${rel}`);
  for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
    if (!dep.startsWith('..')) queue.push(dep);
  }
  const out = path.join(addonsDir, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `/* three.js r${revision} add-on: examples/jsm/${rel} */\n` + code);
}

// ---------- 4. version + license ----------
fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(vendor, 'LICENSE'));
fs.writeFileSync(manifestFile, JSON.stringify({ note: 'Add-ons the games use; tools/update-three.mjs copies these and everything they import.', addons: [...wanted].sort() }, null, 2) + '\n');
fs.writeFileSync(versionFile, JSON.stringify({ version, revision, files: ['three.module.min.js', 'three.core.min.js', 'three.webgpu.min.js', 'three.tsl.min.js', ...[...copied].sort().map((f) => `addons/${f}`)] }, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`three.js r${revision} → public/vendor/three/`);
console.log(`  three.core.min.js   ${(coreSize / 1024).toFixed(0)} KB`);
console.log(`  three.module.min.js ${(moduleSize / 1024).toFixed(0)} KB`);
console.log(`  three.webgpu.min.js ${(webgpuSize / 1024).toFixed(0)} KB`);
console.log(`  three.tsl.min.js    ${(tslSize / 1024).toFixed(0)} KB`);
console.log(`  ${copied.size} add-on files: ${[...copied].sort().join(', ')}`);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
