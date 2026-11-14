// A stand-in for Netlify Blobs when the site runs locally (npm start): the same small API the
// insights functions use (setJSON, get, list), stored as JSON files under .insights-dev/.
import fs from 'node:fs';
import path from 'node:path';

export function fileStore(dir) {
  const file = (key) => path.join(dir, ...key.split('/').map(encodeURIComponent)) + '.json';
  return {
    async setJSON(key, value) {
      const f = file(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(value));
    },
    async get(key) {
      try {
        return JSON.parse(fs.readFileSync(file(key), 'utf8'));
      } catch {
        return null;
      }
    },
    async list({ prefix = '' } = {}) {
      const blobs = [];
      const walk = (d, parts) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const name = decodeURIComponent(e.name.replace(/\.json$/, ''));
          if (e.isDirectory()) walk(path.join(d, e.name), [...parts, name]);
          else {
            const key = [...parts, name].join('/');
            if (key.startsWith(prefix)) blobs.push({ key });
          }
        }
      };
      walk(dir, []);
      return { blobs };
    },
  };
}
