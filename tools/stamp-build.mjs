// Writes public/build.json at deploy time: an id for this deploy plus every game's version.
// The site reads it to tell players "Improved: Hexstead v1.8 — tap to reload" when a newer
// deploy goes live while their page is open (see public/core/updates.js).
//
// Netlify runs this from netlify.toml. On Cloudflare Pages set the build command to
// `node tools/stamp-build.mjs`. Without it everything still works; there's just no bar.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

// one entry per registered game: games/index.js → games/<id>/index.js → version: '1.4'
const list = fs.readFileSync(path.join(pub, 'games', 'index.js'), 'utf8');
const games = {};
for (const [, folder] of list.matchAll(/import\(\s*['"]\.\/([\w-]+)\/index\.js['"]\s*\)/g)) {
  const manifest = fs.readFileSync(path.join(pub, 'games', folder, 'index.js'), 'utf8');
  const id = manifest.match(/^\s*id:\s*['"]([\w-]+)['"]/m)?.[1] || folder;
  const version = manifest.match(/^\s*version:\s*['"]([\d.]+)['"]/m)?.[1];
  if (version) games[id] = version;
}

const commit = process.env.COMMIT_REF || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '';
const deploy = process.env.DEPLOY_ID || process.env.CF_PAGES_URL || '';
const id = [commit.slice(0, 12), deploy].filter(Boolean).join('-') || `t${Date.now()}`;
const info = { id, builtAt: new Date().toISOString(), games };
fs.writeFileSync(path.join(pub, 'build.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`public/build.json: ${id}, ${Object.keys(games).length} games`);

// public/precache.json: every file of the site with a short fingerprint of its contents. The
// offline helper (public/sw.js) downloads them all once, then only the ones that changed, so
// every game opens with no internet, even one never opened before.
const SKIP = new Set(['build.json', 'precache.json', 'sw.js', '_headers', '_redirects']);
const files = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(pub, full).split(path.sep).join('/');
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(full);
    else if (!SKIP.has(rel) && !/\.(md|txt|map)$/i.test(e.name)) files[rel] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
  }
})(pub);
fs.writeFileSync(path.join(pub, 'precache.json'), JSON.stringify({ id, files }) + '\n');
const kb = Object.keys(files).reduce((a, f) => a + fs.statSync(path.join(pub, f)).size, 0) / 1024;
console.log(`public/precache.json: ${Object.keys(files).length} files, ${Math.round(kb)} KB for offline play`);
