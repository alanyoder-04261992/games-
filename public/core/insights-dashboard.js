// The owner's play insights (#/insights): who plays, which games, how much. Not linked from
// anywhere. The data comes from /api/insights, which only answers with the owner's key (the
// INSIGHTS_KEY setting in Netlify). The key is remembered on this device only.
import { h, store, avatar, escapeHtml } from './util.js';

const KEY = 'gc.insights.key';
const MODE = { solo: 'Single player', local: 'Pass and play', host: 'Hosted online', guest: 'Joined online' };
const MODE_COLOR = { solo: '#f0c35a', local: '#3ccf8e', host: '#5b8cff', guest: '#c084fc' };
const WHAT = { open: 'opened the Game Center', start: 'started', end: 'finished', leave: 'left', join: 'joined a table for' };

export function showInsights({ app, games, topbar, go }) {
  document.title = 'Play insights · Game Center';
  const page = h('div.gc-page.gi');
  app.replaceChildren(page);
  let days = store.get('gc.insights.days') || 30;
  const gameName = (id) => games.get(id)?.name || id;

  const ask = (message) => {
    const input = h('input.gc-input', { type: 'password', placeholder: 'Owner key', autocomplete: 'current-password', 'aria-label': 'Owner key' });
    const go2 = () => {
      const k = input.value.trim();
      if (!k) return input.focus();
      store.set(KEY, k);
      load();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go2());
    page.replaceChildren(
      topbar({ back: () => go('#/'), title: 'Play insights' }),
      h('section.gi-lock', h('h1', 'Play insights'), h('p', message), input, h('button.btn.gold.big', { onclick: go2 }, 'Open')),
    );
    setTimeout(() => input.focus(), 50);
  };

  async function load() {
    const key = store.get(KEY);
    if (!key) return ask('Only the Game Center’s owner can see this page. Enter your owner key.');
    page.replaceChildren(topbar({ back: () => go('#/'), title: 'Play insights' }), h('div.gi-loading', h('div.gc-spinner'), 'Loading…'));
    let res;
    try {
      res = await fetch(`api/insights?days=${days}`, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store' });
    } catch {
      return ask('Couldn’t reach the server. Check your connection and try again.');
    }
    if (res.status === 401) {
      store.del(KEY);
      return ask('That key didn’t work. Enter your owner key.');
    }
    if (res.status === 503) return ask('Insights aren’t set up yet: add an INSIGHTS_KEY setting in Netlify (see docs/INSIGHTS.md), then enter it here.');
    if (!res.ok) return ask(`The server answered ${res.status}. Try again in a moment.`);
    render(await res.json());
  }

  function render(d) {
    const t = d.totals;
    const tiles = [
      ['Players this week', t.playersThisWeek, `${t.newThisWeek} new · ${t.players} in ${d.days} days`],
      ['Games this week', t.gamesThisWeek, `${t.gamesStarted} in ${d.days} days`],
      t.minutes < 120 ? ['Time played', `${Math.round(t.minutes)} min`, `in ${d.days} days`] : ['Hours played', Math.round((t.minutes / 60) * 10) / 10, `in ${d.days} days`],
      ['Games finished', t.finishRate == null ? '—' : `${t.finishRate}%`, 'the rest were left part-way'],
    ];
    page.replaceChildren(
      topbar({ back: () => go('#/'), title: 'Play insights' }),
      h(
        'div.gi-wrap',
        h(
          'header.gi-head',
          h('div', h('h1', 'Play insights'), h('small', `Updated ${new Date(d.generatedAt).toLocaleString()}`)),
          h(
            'div.gi-controls',
            h('div.gc-seg', [7, 30, 90].map((n) => h('button.gc-seg-btn' + (n === days ? '.on' : ''), { type: 'button', onclick: () => ((days = n), store.set('gc.insights.days', n), load()) }, `${n} days`))),
            h('button.btn.ghost', { onclick: load }, 'Refresh'),
            h('button.btn.text', { onclick: () => (store.del(KEY), ask('Key forgotten on this device. Enter it again to come back.')) }, 'Forget key'),
          ),
        ),
        h('section.gi-tiles', tiles.map(([label, value, sub]) => h('div.gi-tile', h('small', label), h('strong', String(value)), h('span', sub)))),
        h('section.gi-card', h('h2', 'Every day'), chart(d.daily), h('p.gi-legend', h('i.bar'), 'games started', h('i.dot'), 'players')),
        h('section.gi-card', h('h2', 'How people play'), modeBar(t.modes)),
        h('section.gi-card', h('h2', 'Games'), gamesTable(d.games)),
        h('section.gi-card', h('h2', `Players (${d.players.length})`), h('p.gi-hint', 'Tap a player for the games they play.'), playersList(d.players)),
        h('section.gi-card', h('h2', 'Recent activity'), feed(d.recent)),
      ),
    );
  }

  function chart(daily) {
    // drawn at the screen's own width, so the labels stay readable on a phone
    const W = Math.max(300, Math.min(720, innerWidth - 72)), H = 200, pad = 26;
    const maxG = Math.max(1, ...daily.map((x) => x.games));
    const maxP = Math.max(1, ...daily.map((x) => x.players));
    const bw = (W - pad * 2) / daily.length;
    const y = (v, m) => H - pad - (v / m) * (H - pad * 2);
    const bars = daily.map((x, i) => `<rect x="${pad + i * bw + bw * 0.15}" y="${y(x.games, maxG)}" width="${bw * 0.7}" height="${H - pad - y(x.games, maxG)}" rx="2" fill="#f0c35a" opacity=".85"><title>${x.day}: ${x.games} games, ${x.players} players, ${x.minutes} min</title></rect>`).join('');
    const line = daily.map((x, i) => `${pad + i * bw + bw / 2},${y(x.players, maxP)}`).join(' ');
    const dots = daily.map((x, i) => (x.players ? `<circle cx="${pad + i * bw + bw / 2}" cy="${y(x.players, maxP)}" r="3" fill="#5b8cff"/>` : '')).join('');
    const labels = daily.map((x, i) => (i % Math.ceil(daily.length / (W < 500 ? 4 : 7)) === 0 || i === daily.length - 1 ? `<text x="${pad + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="12" fill="#9fb0c6">${x.day.slice(5).replace('-', '/')}</text>` : '')).join('');
    return h('div.gi-chart', { html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Games started and players per day" font-family="Inter, system-ui, sans-serif"><line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="rgba(255,255,255,.15)"/>${bars}<polyline points="${line}" fill="none" stroke="#5b8cff" stroke-width="2"/>${dots}${labels}<text x="${pad}" y="14" font-size="12" fill="#9fb0c6">max ${maxG} games · ${maxP} players a day</text></svg>` });
  }

  function modeBar(modes) {
    const total = Object.values(modes).reduce((a, b) => a + b, 0);
    if (!total) return h('p.gi-hint', 'No games yet.');
    return h(
      'div',
      h('div.gi-modebar', Object.entries(modes).map(([m, n]) => h('span', { style: { flex: n, background: MODE_COLOR[m] || '#888' }, title: `${MODE[m] || m}: ${n}` }))),
      h('div.gi-modekey', Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([m, n]) => h('span', h('i', { style: { background: MODE_COLOR[m] || '#888' } }), `${MODE[m] || m} · ${n} (${Math.round((n / total) * 100)}%)`))),
    );
  }

  function gamesTable(list) {
    if (!list.length) return h('p.gi-hint', 'No games played yet.');
    const max = Math.max(...list.map((g) => g.started), 1);
    return h(
      'div.rb-table-wrap',
      h(
        'table.gi-table',
        h('tr', h('th', 'Game'), h('th', 'Plays'), h('th', 'Finished'), h('th.gi-wide', 'Avg min'), h('th.gi-wide', 'Players'), h('th.gi-wide', 'Last played')),
        list.map((g) =>
          h(
            'tr',
            h('td', h('div.gi-game', h('span.gi-game-art', { html: games.get(g.id)?.tile || '' }), h('div', h('strong', gameName(g.id)), h('div.gi-spark', h('span', { style: { width: `${(g.started / max) * 100}%` } }))))),
            h('td', String(g.started)),
            h('td', g.finished + g.left ? `${Math.round((g.finished / (g.finished + g.left)) * 100)}%` : '—'),
            h('td.gi-wide', String(g.avgMinutes || '—')),
            h('td.gi-wide', String(g.players)),
            h('td.gi-wide', ago(g.last)),
          ),
        ),
      ),
    );
  }

  function playersList(list) {
    if (!list.length) return h('p.gi-hint', 'Nobody yet.');
    return h(
      'div.gi-players',
      list.map((p) => {
        const detail = h(
          'div.gi-player-more',
          h('p', h('b', 'Games: '), Object.entries(p.byGame).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${gameName(g)} ×${n}`).join(', ') || 'none yet'),
          h('p', h('b', 'How: '), Object.entries(p.modes).map(([m, n]) => `${MODE[m] || m} ×${n}`).join(', ') || '—'),
          p.playsWith.length ? h('p', h('b', 'Plays with: '), p.playsWith.join(', ')) : null,
          p.otherNames.length ? h('p', h('b', 'Also went by: '), p.otherNames.join(', ')) : null,
          h('p', h('b', 'First seen: '), new Date(p.first).toLocaleDateString(), ' · ', h('b', 'Visits: '), String(p.visits), ' · ', h('b', 'Left part-way: '), String(p.left)),
          h('p.gi-device', `Device ${p.device}`),
        );
        detail.hidden = true;
        return h(
          'div.gi-player',
          h(
            'button.gi-player-row',
            { type: 'button', onclick: () => (detail.hidden = !detail.hidden) },
            avatar(p.name, hueOf(p.name), { size: 'sm' }),
            h('div.gi-player-main', h('strong', p.name), h('small', `${p.started} games · ${Math.round(p.minutes)} min${p.favorite ? ` · loves ${gameName(p.favorite)}` : ''}`)),
            h('span.gi-when', ago(p.last)),
          ),
          detail,
        );
      }),
    );
  }

  function feed(list) {
    if (!list.length) return h('p.gi-hint', 'Nothing yet.');
    return h(
      'ul.gi-feed',
      list.map((e) =>
        h(
          'li',
          h('span.gi-when', ago(e.ts)),
          h(
            'span',
            { html: `<b>${escapeHtml(e.name)}</b> ${WHAT[e.t] || e.t}${e.g ? ` <b>${escapeHtml(gameName(e.g))}</b>` : ''}${e.m && e.t === 'start' ? ` · ${MODE[e.m] || e.m}` : ''}${e.r ? ' (resumed)' : ''}${e.dur != null ? ` · ${Math.max(1, Math.round(e.dur / 60))} min` : ''}${e.p && e.p.length > 1 ? ` · with ${escapeHtml(e.p.filter((n) => n !== e.name).join(', '))}` : ''}` },
          ),
        ),
      ),
    );
  }

  load();
}

const hueOf = (name) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
