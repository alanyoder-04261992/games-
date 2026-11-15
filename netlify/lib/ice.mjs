// Connection help for online play (WebRTC "ICE servers"). Players' devices connect straight to
// the host; STUN servers help them find each other, and a TURN relay carries the game when a
// network (often mobile data or strict Wi-Fi) blocks a direct connection. Without a relay those
// players can never join: they sit on "Connecting to the host".
//
// With CF_TURN_KEY_ID and CF_TURN_API_TOKEN set in Netlify (a free Cloudflare TURN key, see
// docs/PLAYING_ONLINE.md), this hands out short-lived Cloudflare relay credentials. Without them
// it returns public servers only, including PeerJS's free shared relay.

export const PUBLIC_ICE = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

const TTL = 24 * 3600; // credentials last a day; we hand the same ones out for 12 hours
let cache = null;
export const _resetCache = () => (cache = null);

const json = (body, maxAge = 0) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `private, max-age=${maxAge}` : 'no-store' } });

// GET /api/ice  →  { iceServers: [...], relay: 'cloudflare' | 'public' }
export async function handleIce(env, fetchImpl = fetch, now = Date.now()) {
  // trimmed: a key pasted with a space or line break is the commonest setup slip
  const id = String(env.CF_TURN_KEY_ID || '').trim();
  const token = String(env.CF_TURN_API_TOKEN || '').trim();
  if (!id || !token) return json({ iceServers: PUBLIC_ICE, relay: 'public' }, 3600);
  if (cache && cache.until > now) return json(cache.body, 3600);
  let status = 0;
  try {
    const ask = (path) =>
      fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: TTL }),
      });
    let res = await ask('generate-ice-servers');
    if (res.status === 404) res = await ask('generate'); // Cloudflare's older address for the same thing
    status = res.status;
    if (!res.ok) throw new Error(`Cloudflare answered ${res.status}`);
    const data = await res.json();
    const list = [data.iceServers].flat().filter(Boolean);
    // browsers often can't use port 53 (it's DNS); Cloudflare suggests leaving those URLs out
    const servers = list
      .map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    if (!servers.some((s) => s.urls.some((u) => u.startsWith('turn')))) throw new Error('no relay in the answer');
    const body = { iceServers: [...servers, PUBLIC_ICE[0]], relay: 'cloudflare' };
    cache = { body, until: now + (TTL / 2) * 1000 };
    return json(body, 3600);
  } catch (e) {
    console.warn('TURN credentials failed:', e.message);
    // the reason, never the key: 401/403 = wrong API token, 404 = wrong Turn Token ID
    const hint = status === 401 || status === 403 ? 'check CF_TURN_API_TOKEN' : status === 404 ? 'check CF_TURN_KEY_ID' : status ? 'Cloudflare error' : 'could not reach Cloudflare';
    return json({ iceServers: PUBLIC_ICE, relay: 'public', error: 'relay-unavailable', cloudflareStatus: status || null, hint });
  }
}
