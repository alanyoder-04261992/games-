// Writes public/build.json at deploy time: an id for this deploy plus every game's version.
// The site reads it to tell players "Improved: Hexstead v1.8 — tap to reload" when a newer
// deploy goes live while their page is open (see public/core/updates.js).
//
// Netlify runs this from netlify.toml. On Cloudflare Pages set the build command to
// `node tools/stamp-build.mjs`. Without it everything still works; there's just no bar.
import fs from 'node:fs';
import path from 'node:path';
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
