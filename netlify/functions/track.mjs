// POST /api/track: the Game Center app reports play events (see netlify/lib/insights.mjs).
import { getStore } from '@netlify/blobs';
import { handleTrack } from '../lib/insights.mjs';

export default (request) => handleTrack(request, getStore('insights'));

export const config = { path: '/api/track' };
