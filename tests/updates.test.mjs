// Version numbers on the home tiles and the "update ready" check.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const games = path.join(root, 'public', 'games');
const registered = [...fs.readFileSync(path.join(games, 'index.js'), 'utf8').matchAll(/import\(\s*['"]\.\/([\w-]+)\/index\.js['"]\s*\)/g)].map((m) => m[1]);

test('every game has a version for its home tile', () => {
  assert.ok(registered.length >= 7);
  for (const folder of registered) {
    const src = fs.readFileSync(path.join(games, folder, 'index.js'), 'utf8');
    assert.match(src, /^\s*version:\s*'\d+\.\d+(\.\d+)?'/m, `public/games/${folder}/index.js needs version: '1.0' (bump it when you improve the game)`);
  }
});

test('stamp-build writes every game version into build.json', () => {
  const out = path.join(root, 'public', 'build.json');
  const before = fs.existsSync(out) ? fs.readFileSync(out) : null;
  try {
    execFileSync(process.execPath, [path.join(root, 'tools', 'stamp-build.mjs')], { env: { ...process.env, COMMIT_REF: 'abcdef1234567890', DEPLOY_ID: 'd1' }, stdio: 'ignore' });
    const info = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(info.id, 'abcdef123456-d1');
    assert.deepEqual(Object.keys(info.games).sort(), registered.slice().sort());
    for (const v of Object.values(info.games)) assert.match(v, /^\d+\.\d+(\.\d+)?$/);
  } finally {
    if (before) fs.writeFileSync(out, before);
    else fs.rmSync(out, { force: true });
  }
});

test('version comparison', async () => {
  const { newer } = await import('../public/core/version.js');
  assert.ok(newer('1.8', '1.7'));
  assert.ok(newer('1.10', '1.9'));
  assert.ok(newer('2.0', '1.12'));
  assert.ok(newer('1.7.1', '1.7'));
  assert.ok(!newer('1.7', '1.7'));
  assert.ok(!newer('1.6', '1.7'));
});
