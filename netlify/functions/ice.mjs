// GET /api/ice: connection help (STUN/TURN servers) for online play. See netlify/lib/ice.mjs.
import { handleIce } from '../lib/ice.mjs';

const env = (k) => globalThis.Netlify?.env.get(k) ?? process.env[k];

export default () => handleIce({ CF_TURN_KEY_ID: env('CF_TURN_KEY_ID'), CF_TURN_API_TOKEN: env('CF_TURN_API_TOKEN') });

export const config = { path: '/api/ice' };
