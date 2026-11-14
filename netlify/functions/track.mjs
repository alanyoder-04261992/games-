// POST /api/track: the Game Center app reports play events (see netlify/lib/insights.mjs).
import { getStore } from '@netlify/blobs';
import { handleTrack, storeName } from '../lib/insights.mjs';

export default (request, context) => handleTrack(request, getStore(storeName(context)));

export const config = { path: '/api/track' };
