// Connection help for online play: public servers, or Cloudflare relay credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIce, PUBLIC_ICE, _resetCache } from '../netlify/lib/ice.mjs';

test('without a Cloudflare key: public STUN servers and the shared PeerJS relay', async () => {
  _resetCache();
  const body = await (await handleIce({})).json();
  assert.equal(body.relay, 'public');
  assert.deepEqual(body.iceServers, PUBLIC_ICE);
  assert.ok(body.iceServers.some((s) => [s.urls].flat().some((u) => u.startsWith('turn:'))), 'includes a relay');
});

test('with a Cloudflare key: relay credentials, port 53 dropped, cached for hours', async () => {
  _resetCache();
  let calls = 0;
  const fake = async (url, init) => {
    calls++;
    assert.match(url, /rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/KEY1\/credentials\/generate-ice-servers$/);
    assert.equal(init.headers.authorization, 'Bearer TOKEN1');
    return new Response(JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' }] }));
  };
  const env = { CF_TURN_KEY_ID: 'KEY1', CF_TURN_API_TOKEN: 'TOKEN1' };
  const body = await (await handleIce(env, fake, 1000)).json();
  assert.equal(body.relay, 'cloudflare');
  const urls = body.iceServers.flatMap((s) => [s.urls].flat());
  assert.ok(!urls.some((u) => /:53(\?|$)/.test(u)), 'no port 53');
  assert.ok(urls.includes('turns:turn.cloudflare.com:443?transport=tcp'));
  assert.equal(body.iceServers.find((s) => s.username).credential, 'c');
  await handleIce(env, fake, 1000 + 3600e3);
  assert.equal(calls, 1, 'second request within 12 hours uses the cache');
  await handleIce(env, fake, 1000 + 13 * 3600e3);
  assert.equal(calls, 2, 'refreshed after 12 hours');
});

test('if Cloudflare fails, players still get the public servers', async () => {
  _resetCache();
  const body = await (await handleIce({ CF_TURN_KEY_ID: 'K', CF_TURN_API_TOKEN: 'T' }, async () => new Response('nope', { status: 401 }))).json();
  assert.equal(body.relay, 'public');
  assert.equal(body.error, 'relay-unavailable');
  assert.deepEqual(body.iceServers, PUBLIC_ICE);
});

test('keys are trimmed, the older Cloudflare address is tried on 404, and failures say why', async () => {
  _resetCache();
  const seen = [];
  const fake = async (url, init) => {
    seen.push(url.split('/').pop());
    assert.equal(init.headers.authorization, 'Bearer TOK');
    if (url.endsWith('generate-ice-servers')) return new Response('not here', { status: 404 });
    return new Response(JSON.stringify({ iceServers: { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' } }));
  };
  const body = await (await handleIce({ CF_TURN_KEY_ID: ' "KEY" \n', CF_TURN_API_TOKEN: "'Bearer TOK'\n" }, fake)).json();
  assert.deepEqual(seen, ['generate-ice-servers', 'generate']);
  assert.equal(body.relay, 'cloudflare');
  _resetCache();
  const bad = await (await handleIce({ CF_TURN_KEY_ID: 'K', CF_TURN_API_TOKEN: 'T' }, async () => new Response('', { status: 401 }))).json();
  assert.equal(bad.cloudflareStatus, 401);
  assert.equal(bad.hint, 'check CF_TURN_API_TOKEN');
  assert.ok(!JSON.stringify(bad).includes('"T"'), 'never echoes the key');
});
