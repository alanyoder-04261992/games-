// GET /api/insights: the owner's dashboard data. Needs the INSIGHTS_KEY environment variable,
// set in Netlify (Site configuration → Environment variables), sent as "Authorization: Bearer".
import { getStore } from '@netlify/blobs';
import { handleInsights } from '../lib/insights.mjs';

export default (request) => handleInsights(request, getStore('insights'), globalThis.Netlify?.env.get('INSIGHTS_KEY') ?? process.env.INSIGHTS_KEY);

export const config = { path: '/api/insights' };
