// Every 3D game runs on the same three.js: the shared copy in public/vendor/three/.
// These checks fail if a game loads three.js from anywhere else (a CDN, its own copy, a
// different version) or imports an add-on that isn't in the shared folder.
//
// To move every game to a newer three.js: `npm run update-three -- 0.188.0`, set
// REQUIRED_REVISION below to the new number, fix any warnings in each 3D game, and run
// `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_REVISION = '187';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const vendor = path.join(pub, 'vendor', 'three');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(m?js|html)$/.test(entry.name)) yield p;
  }
}
const rel = (p) => path.relative(root, p);
const sources = [...walk(path.join(pub, 'games')), ...walk(path.join(pub, 'core'))].map((file) => ({ file, code: fs.readFileSync(file, 'utf8') }));
const usesThree = sources.filter(({ code }) => /vendor\/three\/|['"]three(?:\/webgpu|\/tsl)?['"]|['"]three\/addons\/|three(?:@|\.module|\.core|\.webgpu|\.tsl)/.test(code));
// the shared builds a game may import: WebGL (three.module), WebGPU (three.webgpu + three.tsl), and the core they share
const BUILDS = ['three.module.min.js', 'three.core.min.js', 'three.webgpu.min.js', 'three.tsl.min.js'].map((f) => path.join(vendor, f));
const importsOf = (code) => [...code.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);

test(`shared three.js is r${REQUIRED_REVISION}`, async () => {
  const info = JSON.parse(fs.readFileSync(path.join(vendor, 'VERSION.json'), 'utf8'));
  assert.equal(info.revision, REQUIRED_REVISION, 'public/vendor/three/VERSION.json');
  const THREE = await import(path.join(vendor, 'three.module.min.js'));
  assert.equal(THREE.REVISION, REQUIRED_REVISION, 'REVISION inside three.module.min.js');
  for (const f of info.files) assert.ok(fs.existsSync(path.join(vendor, f)), `listed in VERSION.json but missing: ${f}`);
  const GPU = await import(path.join(vendor, 'three.webgpu.min.js'));
  assert.equal(GPU.REVISION, REQUIRED_REVISION, 'REVISION inside three.webgpu.min.js');
  for (const name of ['WebGPURenderer', 'RenderPipeline', 'MeshStandardNodeMaterial', 'PMREMGenerator']) assert.equal(typeof GPU[name], 'function', `three.webgpu.min.js exports ${name}`);
  const TSL = await import(path.join(vendor, 'three.tsl.min.js'));
  for (const name of ['Fn', 'uniform', 'texture', 'mix', 'pass']) assert.equal(typeof TSL[name], 'function', `three.tsl.min.js exports ${name}`);
  assert.equal(GPU.Vector3, THREE.Vector3, 'the WebGPU build shares three.core.min.js with three.module.min.js');
});

test('every add-on in addons.json is vendored and loads', async () => {
  const { addons } = JSON.parse(fs.readFileSync(path.join(vendor, 'addons.json'), 'utf8'));
  for (const a of addons) {
    const file = path.join(vendor, 'addons', a);
    assert.ok(fs.existsSync(file), `public/vendor/three/addons/${a} is missing — run npm run update-three`);
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(!/(?:from\s*|import\s*\(\s*)['"]three(?:\/|['"])/.test(code), `${a} still imports the bare 'three' specifier`);
    await import(file); // resolves its imports against the shared build
  }
});

test('no game loads three.js from a CDN or its own copy', () => {
  const offenders = [];
  for (const { file, code } of sources) {
    if (/https?:\/\/[^'"\s]*\bthree(?:@|\/build|\.module|\.core|\.webgpu|\.tsl|\/examples|\/webgpu|\/tsl)/i.test(code)) offenders.push(`${rel(file)}: loads three.js from a URL`);
    for (const m of code.matchAll(/['"]([^'"]*three\.(?:module|core|webgpu|tsl|webgpu\.nodes)(?:\.min)?\.js)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!BUILDS.includes(target)) offenders.push(`${rel(file)}: imports ${m[1]} (not the shared copy)`);
    }
  }
  for (const f of walk(path.join(pub, 'games'))) {
    const base = path.basename(f);
    if (/^three(\.module|\.core|\.webgpu|\.tsl|\.webgpu\.nodes)?(\.min)?\.js$/.test(base) || /OrbitControls|EffectComposer|GLTFLoader|BloomNode/.test(base)) offenders.push(`${rel(f)}: a game keeps its own copy of three.js code`);
  }
  assert.deepEqual(offenders, [], 'Import three.js only from public/vendor/three (see docs/ADDING_A_GAME.md)');
});

test('every three.js add-on a game imports exists in the shared folder', () => {
  const missing = [];
  for (const { file, code } of usesThree) {
    for (const m of code.matchAll(/['"]([^'"]*vendor\/three\/addons\/[^'"]+\.js)['"]/g)) {
      if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) missing.push(`${rel(file)}: ${m[1]}`);
    }
    // pages with an import map name add-ons as 'three/addons/<path>'
    for (const m of code.matchAll(/['"]three\/addons\/([^'"]+\.js)['"]/g)) {
      if (!fs.existsSync(path.join(vendor, 'addons', m[1]))) missing.push(`${rel(file)}: three/addons/${m[1]}`);
    }
    // lazy loaders: const base = 'three/addons/postprocessing/'; [...names].map(n => import(base + n + '.js'))
    for (const m of code.matchAll(/const (\w+) = ['"](?:[^'"]*vendor\/three\/|three\/)addons\/([^'"]*\/)['"];[\s\S]{0,400}?\[([^\]]*)\]\.map\(\s*\(?(\w+)\)?\s*=>\s*import\(\s*\1\s*\+\s*\4\s*\+\s*['"]\.js['"]\s*\)/g)) {
      for (const name of m[3].match(/[\w-]+/g) || []) {
        if (!fs.existsSync(path.join(vendor, 'addons', m[2], `${name}.js`))) missing.push(`${rel(file)}: loads ${m[2]}${name}.js later`);
      }
    }
  }
  assert.deepEqual(missing, [], 'Add the add-on to public/vendor/three/addons.json and run npm run update-three');
});

test("bare 'three' imports only appear in pages with an import map to the shared copy", () => {
  const problems = [];
  for (const { file, code } of usesThree) {
    const bare = /(?:from\s*|import\s*\(\s*)['"]three(?:\/addons\/[^'"]*|\/webgpu|\/tsl)?['"]/.test(code) || /['"]three\/addons\//.test(code);
    if (!bare) continue;
    if (!file.endsWith('.html')) {
      problems.push(`${rel(file)}: modules loaded by the Game Center have no import map — import from '../../vendor/three/…' instead`);
      continue;
    }
    const map = code.match(/<script type="importmap">([\s\S]*?)<\/script>/);
    if (!map) {
      problems.push(`${rel(file)}: uses 'three' without an import map`);
      continue;
    }
    const { imports } = JSON.parse(map[1]);
    if (path.resolve(path.dirname(file), imports.three || '') !== path.join(vendor, 'three.module.min.js')) problems.push(`${rel(file)}: import map "three" must point at the shared three.module.min.js`);
    if (imports['three/addons/'] && path.resolve(path.dirname(file), imports['three/addons/']) !== path.join(vendor, 'addons')) problems.push(`${rel(file)}: import map "three/addons/" must point at the shared addons folder`);
    for (const [spec, f] of [['three/webgpu', 'three.webgpu.min.js'], ['three/tsl', 'three.tsl.min.js']]) {
      const uses = new RegExp(`['"]${spec}['"]`).test(code.replace(map[0], ''));
      if (uses && path.resolve(path.dirname(file), imports[spec] || '') !== path.join(vendor, f)) problems.push(`${rel(file)}: import map "${spec}" must point at the shared ${f}`);
    }
  }
  assert.deepEqual(problems, []);
});

// Games on the WebGPU renderer (three.webgpu.min.js) stay WebGPU-only code: WebGPURenderer falls
// back to WebGL 2 by itself, so a game never needs WebGLRenderer, GLSL shaders or the old
// EffectComposer. Custom shading is TSL (node materials), glow goes through RenderPipeline.
test('WebGPU games use only the WebGPU build, TSL and RenderPipeline', () => {
  const problems = [];
  const webgpuFiles = new Set(
    sources.filter(({ file, code }) => importsOf(code).some((s) => /three\.webgpu\.min\.js$|^three\/webgpu$/.test(s) && (s.startsWith('three/') || path.resolve(path.dirname(file), s) === path.join(vendor, 'three.webgpu.min.js')))).map(({ file }) => file),
  );
  // every module in the same game folder as a WebGPU scene counts as part of that game
  const dirs = new Set([...webgpuFiles].map((f) => path.dirname(f)));
  for (const { file, code } of sources) {
    if (!dirs.has(path.dirname(file))) continue;
    for (const s of importsOf(code)) {
      const target = s.startsWith('.') ? path.resolve(path.dirname(file), s) : s;
      if (target === path.join(vendor, 'three.module.min.js') || s === 'three') problems.push(`${rel(file)}: imports the WebGL build (three.module) — use three.webgpu.min.js`);
      if (/vendor\/three\/addons\//.test(s) || s.startsWith('three/addons/')) {
        const add = fs.readFileSync(s.startsWith('three/') ? path.join(vendor, 'addons', s.slice(13)) : target, 'utf8');
        if (/three\.module\.min\.js/.test(add)) problems.push(`${rel(file)}: add-on ${path.basename(s)} is built on the WebGL build`);
      }
    }
    const code2 = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const bad = [
      [/\bWebGLRenderer\b/, 'WebGLRenderer (WebGPURenderer falls back to WebGL 2 on its own)'],
      [/\bWebGLRenderTarget\b/, 'WebGLRenderTarget (use RenderTarget)'],
      [/\b(?:Raw)?ShaderMaterial\b|\bonBeforeCompile\b|gl_FragColor|gl_Position/, 'GLSL shaders (write the shading in TSL)'],
      [/\bEffectComposer\b|\bUnrealBloomPass\b/, 'EffectComposer passes (use RenderPipeline + tsl/display nodes)'],
      [/\bPostProcessing\b/, 'PostProcessing (renamed RenderPipeline)'],
      [/getContext\(\s*['"](?:webgl2?|experimental-webgl)['"]/, 'a WebGL context'],
      [/\bTHREE\.Clock\b/, 'THREE.Clock (use THREE.Timer)'],
      [/PCFSoftShadowMap/, 'PCFSoftShadowMap (removed: use PCFShadowMap or VSMShadowMap)'],
      [/\.encoding\s*=|outputEncoding/, '.encoding (use colorSpace)'],
    ];
    for (const [re, what] of bad) if (re.test(code2)) problems.push(`${rel(file)}: uses ${what}`);
  }
  assert.deepEqual(problems, []);
});
