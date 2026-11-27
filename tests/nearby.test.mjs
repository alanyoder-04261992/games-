// Nearby play (public/core/nearby.js): the codes players swap by QR code.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Element ??= class {};
globalThis.DocumentFragment ??= class {};
const { b45encode, b45decode, pack, unpack } = await import('../public/core/nearby.js');

test('base45 round trip (RFC 9285 examples, and every byte value)', () => {
  const enc = (s) => b45encode(new TextEncoder().encode(s));
  assert.equal(enc('AB'), 'BB8');
  assert.equal(enc('Hello!!'), '%69 VD92EX0');
  assert.equal(enc('ietf!'), 'QED8WEX0');
  const all = new Uint8Array(513).map((_, i) => (i * 37) % 256);
  assert.deepEqual(b45decode(b45encode(all)), all);
  assert.throws(() => b45decode('GGW'), /Game Center code/); // 65535 < value: not base45
});

test('a join code survives the trip, fits a QR code, and only Game Center codes are read', async () => {
  const sdp = 'v=0\r\no=- 8758724377608111458 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:3424565384 1 udp 2113937151 192.168.1.23 38116 typ host\r\na=candidate:3424565385 1 udp 2113937151 172.20.10.2 38117 typ host\r\na=ice-ufrag:9lah\r\na=ice-pwd:pR0m2W/rV6t5uy5fo0pLy5W9\r\na=fingerprint:sha-256 D5:75:25:12:AA:FD:75:63:CF:6C:FA:DE:CB:DC:C7:B2:63:02:AD:44:A1:2D:EE:33:64:FE:30:6C:F7:4C:91:E8\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n';
  const msg = { k: 'o', i: 'ab12c', c: 'HJKMN', h: 'Alan', g: 'rook', s: sdp };
  const text = await pack(msg);
  assert.match(text, /^GC1[0-9A-Z $%*+\-./:]+$/, 'only QR alphanumeric characters');
  assert.ok(text.length < 900, `small enough for a phone to scan (${text.length} characters)`);
  assert.deepEqual(await unpack(text), msg);
  assert.deepEqual(await unpack(`  ${text.slice(0, 40)}\n${text.slice(40)}  `), msg, 'pasted with a line break');
  await assert.rejects(unpack('https://example.com'), /isn’t a Game Center code/);
  await assert.rejects(unpack('GC1ABCDEF'), /didn’t read right/);
});
