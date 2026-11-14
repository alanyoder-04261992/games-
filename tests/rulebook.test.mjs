// Every game has an illustrated rule book (see docs/RULEBOOK.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const games = path.join(root, 'public', 'games');
const registered = [...fs.readFileSync(path.join(games, 'index.js'), 'utf8').matchAll(/import\(\s*['"]\.\/([\w-]+)\/index\.js['"]\s*\)/g)].map((m) => m[1]);

for (const id of registered) {
  test(`${id} has an illustrated rule book`, () => {
    const file = path.join(games, id, 'rules.html');
    assert.ok(fs.existsSync(file), `public/games/${id}/rules.html is missing (see docs/RULEBOOK.md)`);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<header class="rb-hero">[\s\S]*<h1>/, 'starts with an rb-hero header and an <h1>');
    assert.ok((html.match(/<h2[\s>]/g) || []).length >= 6, 'has at least six <h2> sections for the contents bar');
    const svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
    assert.ok(svgs.length >= 6, `has at least six pictures (inline SVG), found ${svgs.length}`);
    for (const svg of svgs) {
      const open = svg.match(/<svg[^>]*>/)[0];
      assert.match(open, /viewBox=/, 'every <svg> has a viewBox so it scales to phones');
      assert.match(open, /aria-label=/, 'every <svg> has an aria-label');
    }
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
    assert.deepEqual([...new Set(dupes)], [], 'ids are unique within the rule book');
    assert.ok(!/<script|<style|<html|<head[\s>]|<link\b/i.test(html), 'a fragment: no <script>, <style>, <html>, <head> or <link>');
    assert.ok(!/(?:src|href)="https?:/i.test(html.replace(/xmlns(:\w+)?="[^"]*"/g, '')), 'no outside images or links');
    assert.ok(Buffer.byteLength(html) < 160_000, 'under 160 KB');
  });
}
