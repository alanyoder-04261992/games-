// Every 3D game runs on the same three.js, the shared copy in public/vendor/three/, and draws
// with WebGPU (WebGPURenderer, which falls back to WebGL2 by itself on devices without it).
// These checks fail if a game loads three.js from anywhere else (a CDN, its own copy, a
// different version), imports an add-on that isn't in the shared folder, or still uses the
// WebGL-only renderer, shaders or post-processing.
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
const usesThree = sources.filter(({ code }) => /vendor\/three\/|['"]three['"]|['"]three\/addons\/|three(?:@|\.module|\.core)/.test(code));

test(`shared three.js is r${REQUIRED_REVISION}`, async () => {
  const info = JSON.parse(fs.readFileSync(path.join(vendor, 'VERSION.json'), 'utf8'));
  assert.equal(info.revision, REQUIRED_REVISION, 'public/vendor/three/VERSION.json');
  for (const build of ['three.webgpu.min.js', 'three.tsl.min.js', 'three.module.min.js']) assert.ok(info.files.includes(build), `VERSION.json lists ${build}`);
  const THREE = await import(path.join(vendor, 'three.webgpu.min.js'));
  assert.equal(THREE.REVISION, REQUIRED_REVISION, 'REVISION inside three.webgpu.min.js');
  assert.equal(typeof THREE.WebGPURenderer, 'function');
  assert.equal(typeof THREE.RenderPipeline, 'function');
  const TSL = await import(path.join(vendor, 'three.tsl.min.js'));
  assert.equal(typeof TSL.Fn, 'function');
  for (const f of info.files) assert.ok(fs.existsSync(path.join(vendor, f)), `listed in VERSION.json but missing: ${f}`);
});

test('every add-on in addons.json is vendored and loads', async () => {
  const { addons } = JSON.parse(fs.readFileSync(path.join(vendor, 'addons.json'), 'utf8'));
  for (const a of addons) {
    const file = path.join(vendor, 'addons', a);
    assert.ok(fs.existsSync(file), `public/vendor/three/addons/${a} is missing — run npm run update-three`);
    const code = fs.readFileSync(file, 'utf8');
    assert.ok(!/(?:from\s*|import\s*\(\s*)['"]three(?:\/|['"])/.test(code), `${a} still imports a bare 'three…' specifier`);
    await import(file); // resolves its imports against the shared build
  }
});

test('no game loads three.js from a CDN or its own copy', () => {
  const offenders = [];
  for (const { file, code } of sources) {
    if (/https?:\/\/[^'"\s]*\bthree(?:@|\/build|\.module|\.core|\/examples)/i.test(code)) offenders.push(`${rel(file)}: loads three.js from a URL`);
    for (const m of code.matchAll(/['"]([^'"]*three\.(?:module|core|webgpu|tsl)(?:\.nodes)?(?:\.min)?\.js)['"]/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!['three.webgpu.min.js', 'three.tsl.min.js', 'three.core.min.js', 'three.module.min.js'].some((b) => target === path.join(vendor, b))) offenders.push(`${rel(file)}: imports ${m[1]} (not the shared copy)`);
    }
  }
  for (const f of walk(path.join(pub, 'games'))) {
    const base = path.basename(f);
    if (/^three(\.module|\.core|\.webgpu|\.tsl)?(\.nodes)?(\.min)?\.js$/.test(base) || /OrbitControls|EffectComposer|GLTFLoader|WaterMesh|SkyMesh|BloomNode/.test(base)) offenders.push(`${rel(f)}: a game keeps its own copy of three.js code`);
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
    const bare = /(?:from\s*|import\s*\(\s*)['"]three(?:\/webgpu|\/tsl|\/addons\/[^'"]*)?['"]/.test(code) || /['"]three\/addons\//.test(code);
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
    const at = (key) => imports[key] && path.resolve(path.dirname(file), imports[key]);
    if (at('three') !== path.join(vendor, 'three.webgpu.min.js')) problems.push(`${rel(file)}: import map "three" must point at the shared three.webgpu.min.js`);
    if (imports['three/webgpu'] && at('three/webgpu') !== path.join(vendor, 'three.webgpu.min.js')) problems.push(`${rel(file)}: import map "three/webgpu" must point at the shared three.webgpu.min.js`);
    if (imports['three/tsl'] && at('three/tsl') !== path.join(vendor, 'three.tsl.min.js')) problems.push(`${rel(file)}: import map "three/tsl" must point at the shared three.tsl.min.js`);
    if (imports['three/addons/'] && path.resolve(path.dirname(file), imports['three/addons/']) !== path.join(vendor, 'addons')) problems.push(`${rel(file)}: import map "three/addons/" must point at the shared addons folder`);
  }
  assert.deepEqual(problems, []);
});

test('3D games draw with WebGPU (WebGPURenderer), not the WebGL-only renderer', () => {
  const problems = [];
  const webglOnly = [
    [/\bWebGLRenderer\b/, 'WebGLRenderer — use THREE.WebGPURenderer (it falls back to WebGL2 by itself)'],
    [/\bWebGLRenderTarget\b/, 'WebGLRenderTarget — use THREE.RenderTarget'],
    [/\b(?:Raw)?ShaderMaterial\b/, 'ShaderMaterial — write a TSL node material'],
    [/\bonBeforeCompile\b/, 'onBeforeCompile — use node material inputs (colorNode, positionNode, …)'],
    [/\b(?:EffectComposer|UnrealBloomPass|GTAOPass|OutputPass)\b/, 'WebGL post-processing — use THREE.RenderPipeline with TSL pass()/bloom()/ao()'],
    [/\bgl_FragColor\b|\bgl_Position\b/, 'GLSL — write the shader in TSL'],
    [/['"][^'"]*three\.module(?:\.min)?\.js['"]/, 'the classic WebGL build — import three.webgpu.min.js'],
    [/['"][^'"]*addons\/objects\/(?:Water|Sky)\.js['"]/, 'WebGL Water/Sky — use WaterMesh/SkyMesh'],
  ];
  for (const { file, code } of usesThree) {
    const js = file.endsWith('.html') ? [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n') : code;
    const plain = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1'); // comments may mention the old names
    for (const [re, why] of webglOnly) if (re.test(plain)) problems.push(`${rel(file)}: ${why}`);
    const builds = [...js.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => /^three(?:\/webgpu|\/tsl)?$|vendor\/three\/three\./.test(s));
    if (builds.length && !builds.some((s) => /^three(?:\/webgpu)?$|three\.webgpu\.min\.js$/.test(s))) problems.push(`${rel(file)}: import THREE from the shared three.webgpu.min.js`);
  }
  assert.deepEqual(problems, [], 'See the 3D section of docs/ADDING_A_GAME.md');
});
