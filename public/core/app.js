// The Game Center shell: home page, game setup, online lobby, and the frame around a game
// (back button, room code, chat, settings). Games plug in through games/index.js.
import { $, h, store, toast, avatar, share, escapeHtml, ROBOT_SVG } from './util.js';
import { sound } from './sound.js';
import { HostRoom, GuestClient, SPEEDS } from './room.js';
import { GAME_MODULES } from '../games/index.js';
import { onlineGuide } from './guide.js';
import { Voice } from './voice.js';
import { startUpdates } from './updates.js';
import { rematchControl } from './rematch.js';

const app = document.getElementById('app');
const GAMES = new Map();
let current = null; // { game, client, room, ui, mode }

// ---------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------
function profile() {
  let p = store.get('gc.profile');
  if (!p) {
    p = { name: '', hue: Math.floor(Math.random() * 360) };
    store.set('gc.profile', p);
  }
  return p;
}
function displayName() {
  return profile().name || 'Player';
}

const prefs = {
  get: (k) => store.get(`gc.prefs.${k}`),
  set: (k, v) => store.set(`gc.prefs.${k}`, v),
};

// ---------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------
async function boot() {
  const mods = await Promise.all(GAME_MODULES.map((load) => load().catch((e) => (console.error('Game failed to load', e), null))));
  for (const m of mods) if (m?.default) GAMES.set(m.default.id, m.default);
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  // "update ready" bar + pull to refresh (not at the table: dragging there belongs to the game)
  startUpdates({ games: GAMES, allowPull: () => !/^#\/?table/.test(location.hash) });
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  if (page === 'join' && arg) return joinRoom(arg);
  if (page === 'table') {
    if (current) return showTable();
    const guest = store.get('gc.guest');
    if (guest && Date.now() - guest.at < 6 * 3600e3) return joinRoom(guest.code);
    return go('#/');
  }
  if (page === 'lobby') return current ? showLobby() : go('#/');
  if (page === 'help') {
    leaveCurrent(false);
    showHome();
    return showGuide();
  }
  if (page === 'game' && GAMES.has(arg)) return showSetup(GAMES.get(arg));
  leaveCurrent(false);
  showHome();
}

function leaveCurrent(ask = true) {
  if (!current) return true;
  if (ask) {
    const started = current.client.lobby?.started || current.client.lastState;
    const msg = current.client.isHost
      ? current.room.online
        ? 'Leave the table? Everyone else will be disconnected. Your game is saved so you can reopen it later.'
        : 'Leave the table? Your game is saved — you can continue it from the home page.'
      : 'Leave this game? You can rejoin with the same code while it is still going.';
    if (started && !confirm(msg)) return false;
  }
  current.ui?.destroy?.();
  current.voice?.destroy();
  current.client.leave();
  current = null;
  document.body.classList.remove('in-game');
  return true;
}

// ---------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------
const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e3a1"/><stop offset="1" stop-color="#c58f22"/></linearGradient></defs>
<rect x="9" y="7" width="22" height="31" rx="4" fill="#fff8e7" stroke="url(#lg-a)" stroke-width="2.5" transform="rotate(-12 20 22)"/>
<rect x="17" y="9" width="22" height="31" rx="4" fill="#173153" stroke="url(#lg-a)" stroke-width="2.5" transform="rotate(10 28 24)"/>
<path d="M28 18l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" fill="url(#lg-a)" transform="rotate(10 28 24)"/></svg>`;

function topbar({ back = null, title = null } = {}) {
  const p = profile();
  return h(
    'header.gc-top',
    back
      ? h('button.gc-back', { onclick: back, 'aria-label': 'Back' }, h('span', { html: ICON.back }), 'Game Center')
      : h('a.gc-brand', { href: '#/' }, h('span.gc-logo', { html: LOGO }), h('span', 'Game Center')),
    title ? h('div.gc-title', title) : h('div'),
    h(
      'button.gc-profile',
      { onclick: editProfile, title: 'Your name and color' },
      avatar(displayName(), p.hue, { size: 'sm' }),
      h('span', p.name || 'Set your name'),
    ),
  );
}

function editProfile(after) {
  const p = profile();
  let hue = p.hue;
  const input = h('input.gc-input', { value: p.name, maxlength: 20, placeholder: 'Your name', autocomplete: 'nickname' });
  const preview = h('div.gc-profile-preview');
  const paint = () => preview.replaceChildren(avatar(input.value || 'Player', hue, { size: 'lg' }));
  input.addEventListener('input', paint);
  paint();
  const hues = [0, 20, 40, 95, 140, 175, 200, 225, 260, 290, 320, 345];
  const sheet = modal(
    h(
      'form.gc-form',
      {
        onsubmit: (e) => {
          e.preventDefault();
          const name = input.value.trim().slice(0, 20);
          if (!name) return input.focus();
          store.set('gc.profile', { name, hue });
          sheet.close();
          if (typeof after === 'function') after();
          else route();
        },
      },
      h('h2', 'Who’s playing?'),
      preview,
      h('label', 'Name', input),
      h('div.gc-hues', hues.map((x) => h('button.gc-hue', { type: 'button', style: { '--hue': x }, onclick: () => ((hue = x), paint()) }))),
      h('div.gc-actions', h('button.btn.gold.big', { type: 'submit' }, 'Save')),
    ),
  );
  setTimeout(() => input.focus(), 50);
}

function needName(then) {
  if (profile().name) return then();
  editProfile(then);
}

function modal(content, { closable = true, cls = '' } = {}) {
  const wrap = h('div.gc-modal-wrap', {
    onclick: (e) => {
      if (closable && e.target === wrap) close();
    },
  });
  const box = h('div.gc-modal' + (cls ? '.' + cls : ''), closable ? h('button.gc-x', { onclick: () => close(), 'aria-label': 'Close' }, '×') : null, content);
  wrap.append(box);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  function close() {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 250);
  }
  return { close, el: box };
}

// ---------------------------------------------------------------------
// home
// ---------------------------------------------------------------------
function showHome() {
  document.title = 'Game Center';
  const saves = [...GAMES.values()].map((g) => ({ g, s: store.get(`gc.save.${g.id}`) })).filter(({ s }) => s && !s.over);
  const guest = store.get('gc.guest');
  const code = h('input.gc-input.code', { placeholder: 'ABCDE', maxlength: 5, autocapitalize: 'characters', spellcheck: false, 'aria-label': 'Game code' });
  code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  const tiles = [...GAMES.values()].map((g) =>
    h(
      'article.gc-tile',
      { style: { '--accent': g.accent || '#3b82f6' } },
      h('a.gc-tile-art', { href: `#/game/${g.id}`, html: g.tile, 'aria-label': g.name }, g.version ? h('span.gc-ver', { title: `${g.name} version ${g.version}` }, `v${g.version}`) : null),
      h(
        'div.gc-tile-body',
        h('div.gc-tile-head', h('h3', g.name), h('span.gc-pill', g.players)),
        h('p', g.tagline),
        h(
          'div.gc-tile-actions',
          h('button.btn.gold', { onclick: () => needName(() => startSolo(g)), title: 'Play against computer players' }, 'Single player'),
          h('button.btn.ghost', { onclick: () => needName(() => hostOnline(g)), title: 'Host an online table for friends' }, h('span', { html: ICON.people }), 'Multiplayer'),
          h('a.btn.text', { href: `#/game/${g.id}` }, 'Options'),
        ),
      ),
    ),
  );
  tiles.push(
    h(
      'article.gc-tile.add',
      h('div.gc-add-art', { html: ICON.plus }),
      h(
        'div.gc-tile-body',
        h('h3', 'Your game here'),
        h('p', 'Games plug in with one file listing the rules, the computer player and the screen. Online play comes free.'),
        h('div.gc-tile-actions', h('button.btn.ghost', { onclick: showAddGame }, 'How to add a game')),
      ),
    ),
  );

  app.replaceChildren(
    h(
      'div.gc-page.home',
      topbar(),
      h(
        'section.gc-hero',
        h('div.gc-hero-text', h('h1', 'Pull up a chair.'), h('p', 'Card and board games to play with friends and family online — or against computer players that actually play well.')),
        h(
          'form.gc-join',
          {
            onsubmit: (e) => {
              e.preventDefault();
              const c = code.value.trim();
              if (c.length < 4) return code.focus();
              needName(() => go(`#/join/${c}`));
            },
          },
          h('label', 'Join a friend’s table'),
          h('div.gc-join-row', code, h('button.btn.gold', { type: 'submit' }, 'Join')),
          h('small', 'Ask the host for the 5-letter code, or open their invite link. ', h('button.gc-link', { type: 'button', onclick: () => showGuide() }, 'How does online play work?')),
        ),
      ),
      saves.length || (guest && Date.now() - guest.at < 6 * 3600e3)
        ? h(
            'section.gc-continue',
            h('h2', 'Pick up where you left off'),
            h(
              'div.gc-continue-row',
              saves.map(({ g, s }) =>
                h(
                  'button.gc-resume',
                  { onclick: () => resumeHost(g, s) },
                  h('span.gc-resume-art', { html: g.tile }),
                  h('span.gc-resume-text', h('strong', g.name), h('small', `${s.online ? 'Online table ' + s.code : 'vs computer'} · saved ${ago(s.savedAt)}`)),
                  h('span.gc-resume-go', 'Continue'),
                ),
              ),
              guest && Date.now() - guest.at < 6 * 3600e3
                ? h(
                    'button.gc-resume',
                    { onclick: () => go(`#/join/${guest.code}`) },
                    h('span.gc-resume-art.code', guest.code),
                    h('span.gc-resume-text', h('strong', 'Rejoin table'), h('small', `${GAMES.get(guest.gameId)?.name || 'Game'} · ${ago(guest.at)}`)),
                    h('span.gc-resume-go', 'Rejoin'),
                  )
                : null,
            ),
          )
        : null,
      h('section.gc-games', h('h2', 'Games'), h('div.gc-grid', tiles)),
      h('footer.gc-foot', h('span', 'Online play is peer-to-peer: the host’s device runs the table. Keep the host’s screen open. ', h('button.gc-link', { onclick: () => showGuide() }, 'How to play online')), h('button.btn.text', { onclick: () => ((sound.enabled = !sound.enabled), showHome()) }, sound.enabled ? 'Sound on' : 'Sound off')),
    ),
  );
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function showGuide() {
  const rook = GAMES.get('rook') || [...GAMES.values()][0];
  const inGame = !!current;
  const sheet = modal(
    h(
      'div.gc-doc',
      onlineGuide({
        onHost: inGame || !rook ? null : () => (sheet.close(), needName(() => hostOnline(rook))),
        onJoin: inGame
          ? null
          : () => {
              sheet.close();
              const input = $('.gc-join .gc-input');
              input?.focus();
              input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            },
      }),
      h(
        'div.gc-actions',
        h('button.btn.ghost', { onclick: () => navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/help`).then(() => toast('Guide link copied')) }, 'Copy link to this guide'),
      ),
    ),
    { cls: 'wide' },
  );
}

function showAddGame() {
  modal(
    h(
      'div.gc-doc',
      h('h2', 'Adding a game'),
      h('p', 'Every game is a folder in ', h('code', 'games/'), ' with an ', h('code', 'index.js'), ' that describes it:'),
      h(
        'ol',
        h('li', h('strong', 'Rules engine'), ' — ', h('code', 'setup'), ', ', h('code', 'legal'), ', ', h('code', 'apply'), ', ', h('code', 'view'), '. Pure functions; the host runs them.'),
        h('li', h('strong', 'Computer player'), ' — picks a move from what one seat can see.'),
        h('li', h('strong', 'Screen'), ' — draws the view and sends moves back.'),
      ),
      h('p', 'Then add one line to ', h('code', 'games/index.js'), '. Online tables, lobbies, reconnects, chat, saving and computer players filling empty seats all work automatically.'),
      h('p', 'See ', h('code', 'docs/ADDING_A_GAME.md'), ' and the small ', h('code', 'games/four-in-a-row'), ' example.'),
    ),
  );
}

// ---------------------------------------------------------------------
// game setup page
// ---------------------------------------------------------------------
function showSetup(game) {
  leaveCurrent(false);
  document.title = `${game.name} · Game Center`;
  const saved = prefs.get(`setup.${game.id}`) || {};
  const options = {};
  for (const o of game.options || []) options[o.key] = saved.options?.[o.key] ?? o.default;
  const settings = { speed: saved.speed || 'normal', botLevel: saved.botLevel || 'normal' };
  const persist = () => prefs.set(`setup.${game.id}`, { options, ...settings });

  const select = (label, value, choices, onchange) =>
    h(
      'label.gc-field',
      h('span', label),
      h(
        'div.gc-seg',
        choices.map((c) =>
          h(
            'button.gc-seg-btn' + (c.value === value() ? '.on' : ''),
            {
              type: 'button',
              onclick: (e) => {
                onchange(c.value);
                persist();
                [...e.currentTarget.parentNode.children].forEach((b) => b.classList.remove('on'));
                e.currentTarget.classList.add('on');
              },
            },
            c.label,
          ),
        ),
      ),
    );

  const save = store.get(`gc.save.${game.id}`);
  app.replaceChildren(
    h(
      'div.gc-page.setup',
      topbar({ back: () => go('#/') }),
      h(
        'section.gc-setup',
        { style: { '--accent': game.accent } },
        h('div.gc-setup-art', { html: game.tile }),
        h(
          'div.gc-setup-body',
          h('h1', game.name, game.version ? h('span.gc-ver.inline', `v${game.version}`) : null),
          h('p.lead', game.description),
          ...(game.options || []).map((o) => select(o.label, () => options[o.key], o.choices, (v) => (options[o.key] = v))),
          game.botLevels
            ? select('Computer players', () => settings.botLevel, Object.entries(game.botLevels).map(([value, label]) => ({ value, label })), (v) => (settings.botLevel = v))
            : null,
          select('Game speed', () => settings.speed, Object.entries(SPEEDS).map(([value, s]) => ({ value, label: s.label })), (v) => (settings.speed = v)),
          h(
            'div.gc-actions',
            h('button.btn.gold.big', { onclick: () => needName(() => startSolo(game, options, settings)) }, 'Single player'),
            h('button.btn.ghost.big', { onclick: () => needName(() => hostOnline(game, options, settings)) }, h('span', { html: ICON.people }), 'Multiplayer'),
          ),
          save && !save.over ? h('button.btn.text', { onclick: () => resumeHost(game, save) }, `Continue your saved game (${ago(save.savedAt)})`) : null,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------
function startSolo(game, options, settings) {
  const saved = prefs.get(`setup.${game.id}`) || {};
  options = options || saved.options || {};
  settings = settings || { speed: saved.speed || 'normal', botLevel: saved.botLevel || 'normal' };
  const existing = store.get(`gc.save.${game.id}`);
  if (existing && !existing.over && !confirm(`Start a new ${game.name} game? Your saved game will be replaced.`)) return;
  leaveCurrent(false);
  const room = new HostRoom({ game, profile: { ...profile(), name: displayName() }, online: false, options, settings });
  current = { game, room, client: room.local, mode: 'solo' };
  room.start();
  go('#/table');
}

function hostOnline(game, options, settings) {
  const saved = prefs.get(`setup.${game.id}`) || {};
  options = options || saved.options || {};
  settings = settings || { speed: saved.speed || 'normal', botLevel: saved.botLevel || 'normal' };
  leaveCurrent(false);
  const room = new HostRoom({ game, profile: { ...profile(), name: displayName() }, online: true, options, settings });
  current = { game, room, client: room.local, mode: 'host' };
  go('#/lobby');
}

function resumeHost(game, save) {
  leaveCurrent(false);
  const room = new HostRoom({ game, profile: { ...profile(), name: displayName() }, online: save.online, saved: save });
  current = { game, room, client: room.local, mode: save.online ? 'host' : 'solo' };
  room.local.lobby = room.lobby();
  go('#/table');
  // send the saved table to our own screen
  room.handle('host', { t: 'sync' });
}

function joinRoom(code) {
  code = code.toUpperCase();
  if (!profile().name) return editProfile(() => joinRoom(code));
  if (current && !current.client.isHost && current.client.code === code) return current.client.lobby?.started ? showTable() : showLobby();
  leaveCurrent(false);
  const client = new GuestClient({ code, profile: { ...profile(), name: displayName() } });
  current = { game: null, client, mode: 'guest' };
  showConnecting(code);
  const offStatus = client.on('status', (s, detail) => {
    if (s === 'notfound') {
      offStatus();
      leaveCurrent(false);
      toast(`No table found with code ${code}. Check the code and that the host has the game open.`, { ms: 5000, kind: 'warn' });
      go('#/');
    } else if (current?.client === client) updateConnBadge(s, detail);
  });
  client.on('welcome', (msg) => {
    if (current?.client !== client) return;
    current.game = GAMES.get(msg.gameId);
    if (!current.game) {
      toast('That table is playing a game this Game Center does not have yet.', { kind: 'warn' });
      leaveCurrent(false);
      return go('#/');
    }
  });
  client.on('lobby', (lobby) => {
    if (current?.client !== client || !current.game) return;
    if (lobby.started && !current.tableShown) {
      location.hash = '#/table';
      showTable();
    } else if (!lobby.started && !current.tableShown && !current.lobbyShown) showLobby();
  });
  client.on('kicked', () => {
    toast('The host removed you from the table.', { kind: 'warn' });
    leaveCurrent(false);
    go('#/');
  });
  client.on('closed', () => {
    toast('The host closed the table.', { kind: 'warn' });
    leaveCurrent(false);
    go('#/');
  });
}

function showConnecting(code) {
  app.replaceChildren(
    h(
      'div.gc-page.connecting',
      topbar({ back: () => (leaveCurrent(false), go('#/')) }),
      h('div.gc-center', h('div.gc-spinner'), h('h2', `Joining table ${code}…`), h('p.gc-conn-detail', 'Connecting to the host')),
    ),
  );
}

function updateConnBadge(status, detail) {
  const el = $('.gc-conn-detail');
  if (el) el.textContent = detail || (status === 'online' ? 'Connected' : 'Connecting…');
  const badge = $('.gc-conn');
  if (badge) {
    badge.dataset.status = status;
    badge.title = detail || status;
  }
}

// ---------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------
function showLobby() {
  const { game, client, room } = current;
  current.lobbyShown = true;
  document.title = `${game.name} table · Game Center`;
  const page = h('div.gc-page.lobby');
  app.replaceChildren(page);
  const chat = chatBox(client);
  const render = (lobby) => {
    if (!lobby) return;
    if (lobby.started) {
      location.hash = '#/table';
      return;
    }
    const url = `${location.origin}${location.pathname}#/join/${lobby.code}`;
    const isHost = client.isHost;
    const seatCard = (s) => {
      const label = game.seatLabels?.[s.seat] || `Seat ${s.seat + 1}`;
      const team = game.teams ? game.teams.findIndex((t) => t.includes(s.seat)) : -1;
      const mine = s.playerId === client.playerId;
      return h(
        `div.gc-seat.kind-${s.kind}${mine ? '.mine' : ''}`,
        { dataset: { team } },
        h('div.gc-seat-label', label, team >= 0 ? h('span.gc-team-tag', `Team ${team + 1}`) : null),
        s.kind === 'open'
          ? h('div.gc-seat-empty', h('div.gc-seat-plus', '+'), h('span', 'Waiting for a player'))
          : h(
              'div.gc-seat-who',
              avatar(s.name, s.hue, { bot: s.kind === 'bot' }),
              h('div', h('strong', s.name + (mine ? ' (you)' : '')), h('small', s.kind === 'bot' ? `Computer · ${game.botLevels?.[s.level] || ''}` : s.isHost ? 'Host' : s.connected ? 'Ready' : 'Reconnecting…')),
            ),
        h(
          'div.gc-seat-actions',
          isHost && !mine && s.kind !== 'human' ? h('button.btn.chip', { onclick: () => room.setSeat(s.seat, 'human', client.playerId) }, 'Sit here') : null,
          isHost && s.kind === 'open' ? h('button.btn.chip', { onclick: () => room.setSeat(s.seat, 'bot') }, h('span', { html: ROBOT_SVG }), 'Add computer') : null,
          isHost && s.kind === 'bot' ? h('button.btn.chip', { onclick: () => room.setSeat(s.seat, 'open') }, 'Open seat') : null,
          isHost && s.kind === 'human' && !s.isHost ? h('button.btn.chip.danger', { onclick: () => confirm(`Remove ${s.name}?`) && room.kick(s.playerId) }, 'Remove') : null,
        ),
      );
    };
    const watchers = lobby.players.filter((p) => p.seat == null);
    page.replaceChildren(
      topbar({ back: () => leaveCurrent() && go('#/'), title: `${game.name} · online table` }),
      h(
        'div.gc-lobby',
        h(
          'section.gc-invite',
          h('small', 'Table code'),
          h('div.gc-code', lobby.code || '·····'),
          h(
            'div.gc-conn-line',
            h('span.gc-conn', { dataset: { status: client.isHost ? lobby.status : client.status } }),
            client.isHost ? (lobby.status === 'online' ? 'Open — friends can join now' : lobby.status === 'error' ? 'Could not open the table' : 'Opening the table…') : 'Connected to the host',
          ),
          h(
            'div.gc-invite-actions',
            h('button.btn.gold', { onclick: () => share({ title: `Play ${game.name}`, text: `Join my ${game.name} table — code ${lobby.code}`, url }) }, h('span', { html: ICON.share }), 'Invite'),
            h('button.btn.ghost', { onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Invite link copied')) }, 'Copy link'),
          ),
          h('p.gc-hint', 'Friends open the link (or enter the code on the home page). Empty seats get computer players when you start. ', h('button.gc-link', { onclick: () => showGuide() }, 'Step-by-step guide')),
        ),
        h(
          'section.gc-seats',
          h('h2', 'Seats'),
          game.teams ? h('p.gc-hint', 'Partners sit across from each other: South & North vs West & East.') : null,
          h('div.gc-seat-grid', { dataset: { seats: lobby.seats.length } }, lobby.seats.map(seatCard)),
          watchers.length ? h('p.gc-hint', `Watching: ${watchers.map((w) => w.name).join(', ')}`) : null,
        ),
        h(
          'section.gc-lobby-side',
          h('h2', 'Table rules'),
          h(
            'ul.gc-rules-list',
            (game.options || []).map((o) => h('li', h('span', o.label), h('strong', o.choices.find((c) => c.value === lobby.options[o.key])?.label || ''))),
            h('li', h('span', 'Computer players'), h('strong', game.botLevels?.[lobby.settings.botLevel] || '')),
            h('li', h('span', 'Speed'), h('strong', SPEEDS[lobby.settings.speed]?.label || '')),
          ),
          isHost ? h('button.btn.text', { onclick: () => lobbyOptions(game, room) }, 'Change rules') : null,
          h('h2', 'Voice chat'),
          voiceBox(),
          h('h2', 'Chat'),
          chat.el,
        ),
        h(
          'div.gc-lobby-start',
          isHost
            ? h('button.btn.gold.big', { onclick: () => room.start() }, 'Start game')
            : h('div.gc-wait', h('div.gc-spinner.small'), 'Waiting for the host to start…'),
        ),
      ),
    );
  };
  render(client.lobby);
  current.offLobby?.();
  current.offLobby = client.on('lobby', render);
  if (client.isHost) client.on('status', () => render(room.lobby()));
}

function lobbyOptions(game, room) {
  const body = h('div.gc-form', h('h2', 'Table rules'));
  const draw = () => {
    body.replaceChildren(
      h('h2', 'Table rules'),
      ...(game.options || []).map((o) => seg(o.label, room.options[o.key], o.choices, (v) => (room.setOption(o.key, v), draw()))),
      game.botLevels ? seg('Computer players', room.settings.botLevel, Object.entries(game.botLevels).map(([value, label]) => ({ value, label })), (v) => (room.setSetting('botLevel', v), draw())) : null,
      seg('Game speed', room.settings.speed, Object.entries(SPEEDS).map(([value, s]) => ({ value, label: s.label })), (v) => (room.setSetting('speed', v), draw())),
    );
  };
  draw();
  modal(body);
}

function seg(label, value, choices, onchange) {
  return h(
    'label.gc-field',
    h('span', label),
    h('div.gc-seg', choices.map((c) => h('button.gc-seg-btn' + (c.value === value ? '.on' : ''), { type: 'button', onclick: () => onchange(c.value) }, c.label))),
  );
}

function chatBox(client) {
  const log = h('div.gc-chat-log');
  const input = h('input.gc-input', { placeholder: 'Say something…', maxlength: 300 });
  const add = (m) => {
    const time = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    log.append(
      m.system
        ? h('div.gc-chat-sys', m.text)
        : h('div.gc-chat-msg', h('span.gc-chat-name', { style: { '--hue': m.hue } }, m.name), h('span.gc-chat-text', m.text), h('time', time)),
    );
    log.scrollTop = log.scrollHeight;
  };
  const off = client.on('chat', add);
  const el = h(
    'div.gc-chat',
    log,
    h(
      'form.gc-chat-form',
      {
        onsubmit: (e) => {
          e.preventDefault();
          if (!input.value.trim()) return;
          client.chat(input.value);
          input.value = '';
        },
      },
      input,
      h('button.btn.gold', { type: 'submit' }, 'Send'),
    ),
    h(
      'div.gc-emotes',
      ['Nice!', 'Good game', 'Oops 😅', 'Thanks partner', '👏', '🔥', '😂'].map((t) => h('button.btn.chip', { type: 'button', onclick: () => client.chat(t, true) }, t)),
    ),
  );
  return { el, off };
}

// ---------------------------------------------------------------------
// table
// ---------------------------------------------------------------------
async function showTable() {
  if (!current) return go('#/');
  const { game, client } = current;
  if (!game) return;
  if (current.ui || current.tableShown) return;
  current.tableShown = true;
  document.title = `${game.name} · Game Center`;
  document.body.classList.add('in-game');
  current.offLobby?.();
  const stage = h('div.gc-stage');
  const online = client.isHost ? current.room.online : true;
  const chatPanel = online ? chatBox(client) : null;
  const drawer = online ? h('aside.gc-drawer', h('div.gc-drawer-head', h('strong', 'Table chat'), h('button.gc-x', { onclick: () => drawer.classList.remove('open') }, '×')), chatPanel.el) : null;
  const unread = h('span.gc-unread');
  if (online) {
    client.on('chat', (m) => {
      if (!drawer.classList.contains('open') && !m.replay && !m.system) {
        unread.textContent = String((Number(unread.textContent) || 0) + 1);
        unread.classList.add('show');
      }
    });
  }
  const code = client.isHost ? current.room.code : client.code;
  const bar = h(
    'div.gc-gamebar',
    h('button.gc-icon-btn', { onclick: () => leaveCurrent() && go('#/'), title: 'Back to Game Center', 'aria-label': 'Back' }, h('span', { html: ICON.back })),
    h('div.gc-gamebar-title', h('strong', game.name), online ? h('button.gc-room-chip', { onclick: () => inviteSheet(game, code) }, h('span.gc-conn', { dataset: { status: client.isHost ? current.room.status : client.status } }), code) : null, online ? voiceStrip() : null),
    h(
      'div.gc-gamebar-right',
      online ? micButton() : null,
      online
        ? h(
            'button.gc-icon-btn',
            {
              title: 'Chat',
              onclick: () => {
                drawer.classList.toggle('open');
                unread.textContent = '';
                unread.classList.remove('show');
              },
            },
            h('span', { html: ICON.chat }),
            unread,
          )
        : null,
      h('button.gc-icon-btn', { title: 'Sound', onclick: (e) => ((sound.enabled = !sound.enabled), (e.currentTarget.firstChild.innerHTML = sound.enabled ? ICON.sound : ICON.mute)) }, h('span', { html: sound.enabled ? ICON.sound : ICON.mute })),
      h('button.gc-icon-btn', { title: 'Settings', onclick: () => settingsSheet() }, h('span', { html: ICON.gear })),
      h('button.gc-icon-btn', { title: 'How to play', onclick: () => rulesSheet(game, online) }, h('span', { html: ICON.help })),
    ),
  );
  const offline = h('div.gc-offline-banner');
  app.replaceChildren(h('div.gc-table-page', bar, stage, offline, drawer));
  client.on('status', (s, detail) => {
    $('.gc-gamebar .gc-conn')?.setAttribute('data-status', s);
    offline.textContent = s === 'online' || s === 'offline' ? '' : detail || 'Reconnecting…';
    offline.classList.toggle('show', !(s === 'online' || s === 'offline'));
  });
  client.on('toast', (t) => toast(t));
  await loadStyles(game);
  const mod = await game.ui();
  if (!current || current.client !== client) return;
  current.ui = mod.mount({
    el: stage,
    client,
    game,
    prefs,
    toast,
    voice: online ? voiceFor() : null,
    rematch: (opts) => rematchControl(client, opts), // the shared Rematch button for game-over screens
    leave: () => {
      leaveCurrent(false);
      go('#/');
    },
  });
  rematchFallback(stage, client);
  if (client.isHost) client.send({ t: 'sync' });
  else client.send({ t: 'sync' });
}

// A game that ends without putting ctx.rematch() on its screen (or marking the stage with
// data-own-rematch) still gets the shared Rematch button, in a bar along the bottom.
function rematchFallback(stage, client) {
  let bar = null;
  let timer = null;
  const drop = () => {
    clearTimeout(timer);
    bar?.remove();
    bar = null;
  };
  client.on('state', (msg) => {
    if (!stage.isConnected) return drop();
    if (!msg.over) return drop();
    if (bar || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!stage.isConnected || !client.lastState?.over || stage.querySelector('.gc-rematch, [data-own-rematch]')) return;
      bar = h('div.gc-rematch-bar', rematchControl(client));
      stage.append(bar);
    }, 1500); // give the game's own end screen time to appear first
  });
}

// ---------------------------------------------------------------------
// voice chat (see core/voice.js)
// ---------------------------------------------------------------------
function voiceFor() {
  if (!current) return null;
  if (!current.voice) {
    const voice = new Voice(current.client);
    voice.on('state', (state, detail) => state === 'error' && toast(detail, { kind: 'warn', ms: 5000 }));
    voice.on('forced', (muted) => toast(muted ? 'The host muted your microphone' : 'The host unmuted you — you can talk again', { kind: muted ? 'warn' : '' }));
    voice.on('blocked', () => toast('Tap anywhere to hear voice chat'));
    current.voice = voice;
  }
  return current.voice;
}

// Re-render `build()` into `el` whenever voice changes, until `el` leaves the page.
// Only things without buttons re-render on 'speaking' (it fires many times a second while
// people talk); anything with buttons re-renders on 'change' and updates the glow in place,
// so a tap never lands on a button that was just replaced.
function live(el, build, events = ['change']) {
  const voice = voiceFor();
  const paint = () => el.replaceChildren(...[build(voice)].flat());
  const offs = events.map((ev) =>
    voice.on(ev, () => {
      if (!el.isConnected && el.dataset.mounted) return offs.forEach((off) => off());
      paint();
    }),
  );
  requestAnimationFrame(() => (el.dataset.mounted = '1'));
  paint();
  return el;
}

function onSpeaking(el, fn) {
  const voice = voiceFor();
  const off = voice.on('speaking', () => {
    if (!el.isConnected && el.dataset.mounted) return off();
    fn(voice.speaking);
  });
  fn(voice.speaking);
}

function micState(voice) {
  if (voice.state === 'starting') return { cls: 'starting', icon: ICON.mic, label: 'Starting voice…' };
  if (voice.state !== 'on') return { cls: 'off', icon: ICON.micPlus, label: 'Join voice chat' };
  if (voice.hostMuted) return { cls: 'host-muted', icon: ICON.micOff, label: 'The host muted you' };
  if (voice.muted) return { cls: 'muted', icon: ICON.micOff, label: 'You are muted — tap to talk' };
  return { cls: 'live', icon: ICON.mic, label: 'Your mic is on — tap to mute' };
}

function pressMic(voice) {
  if (voice.state === 'on') {
    if (!voice.toggleMute()) toast('The host muted you. Ask them to unmute you.');
  } else voice.join();
}

function micButton() {
  const wrap = h('div.gc-mic-wrap');
  onSpeaking(wrap, (speaking) => wrap.classList.toggle('talking', speaking.has(current?.client.playerId)));
  return live(wrap, (voice) => {
    const st = micState(voice);
    return [
      h(`button.gc-icon-btn.gc-mic.${st.cls}`, { title: st.label, 'aria-label': st.label, onclick: () => pressMic(voice) }, h('span', { html: st.icon }), h('i.gc-mic-level')),
      voice.state === 'on' ? h('button.gc-icon-btn.gc-mic-more', { title: 'Voice chat', 'aria-label': 'Voice chat people', onclick: () => voicePanel() }, h('span', { html: ICON.people })) : null,
    ];
  });
}

function voiceStrip() {
  const el = h('button.gc-voice-strip', { title: 'Voice chat', onclick: () => voicePanel() });
  return live(
    el,
    (voice) =>
    voice.roster().map((r) =>
      h(
        'span.gc-vs-face' + (r.speaking ? '.speaking' : '') + (r.muted || r.hostMuted || r.localMuted ? '.muted' : ''),
        { title: `${r.name}${r.me ? ' (you)' : ''}${r.hostMuted ? ' — muted by host' : r.muted ? ' — muted' : ''}` },
        avatar(r.name, r.hue, { size: 'sm' }),
        r.muted || r.hostMuted || r.localMuted ? h('i', { html: ICON.micOff }) : null,
      ),
    ),
    ['change', 'speaking'],
  );
}

function voiceBox() {
  const el = h('div.gc-voice-box');
  return live(el, (voice) => {
    const st = micState(voice);
    const people = voice.roster();
    return [
      voice.state === 'on'
        ? h('div.gc-voice-row', h(`button.btn.${st.cls === 'live' ? 'ghost' : 'gold'}`, { onclick: () => pressMic(voice) }, h('span', { html: st.icon }), st.cls === 'live' ? 'Mute' : st.cls === 'host-muted' ? 'Muted by host' : 'Unmute'), h('button.btn.text', { onclick: () => voicePanel() }, `${people.length} in voice`), h('button.btn.text', { onclick: () => voice.leave() }, 'Leave'))
        : h('div.gc-voice-row', h('button.btn.gold', { onclick: () => voice.join(), disabled: voice.state === 'starting' }, h('span', { html: ICON.mic }), voice.state === 'starting' ? 'Starting…' : 'Join voice'), people.length ? h('small', `${people.length} talking now`) : h('small', 'Talk while you play. Your mic stays on; mute any time.')),
      people.length ? h('div.gc-voice-faces', voiceStrip()) : null,
    ];
  });
}

function voicePanel() {
  const voice = voiceFor();
  const isHost = current.client.isHost;
  const body = h('div.gc-form.gc-voice-panel');
  const sheet = modal(body);
  let statusOf = null;
  live(body, () => {
    const roster = voice.roster();
    const inVoice = new Set(roster.map((r) => r.id));
    const others = (current?.client.lobby?.players || []).filter((p) => !inVoice.has(p.id) && p.connected);
    const status = (r) =>
      r.hostMuted ? 'Muted by host' : r.muted ? 'Muted' : !r.connected ? 'Connecting…' : r.speaking ? 'Talking' : r.me ? 'Mic on' : 'Listening';
    statusOf = status;
    return [
      h('h2', 'Voice chat'),
      h('p.gc-hint', 'Everyone in voice hears everyone else. ', isHost ? 'As the host you can mute anyone for the whole table.' : 'Mute someone just for yourself with the speaker button.'),
      h(
        'div.gc-voice-list',
        roster.map((r) =>
          h(
            'div.gc-voice-person' + (r.speaking ? '.speaking' : ''),
            { dataset: { id: r.id } },
            h('span.gc-vs-face' + (r.speaking ? '.speaking' : ''), avatar(r.name, r.hue)),
            h('div.gc-voice-who', h('strong', r.name, r.me ? ' (you)' : '', r.isHost ? h('span.gc-host-tag', 'Host') : null), h('small.' + (r.hostMuted || r.muted ? 'off' : r.speaking ? 'on' : ''), status(r))),
            h(
              'div.gc-voice-actions',
              r.me
                ? h(`button.btn.chip${voice.muted ? '.on' : ''}`, { disabled: voice.hostMuted, onclick: () => voice.toggleMute() }, h('span', { html: voice.muted || voice.hostMuted ? ICON.micOff : ICON.mic }), voice.muted ? 'Unmute' : 'Mute')
                : h(`button.btn.chip${r.localMuted ? '.on' : ''}`, { title: 'Only you stop hearing them', onclick: () => voice.setLocalMute(r.id, !r.localMuted) }, h('span', { html: r.localMuted ? ICON.mute : ICON.sound }), r.localMuted ? 'Hear' : 'Silence'),
              isHost && !r.me ? h(`button.btn.chip${r.hostMuted ? '.on' : '.danger'}`, { onclick: () => voice.hostMute(r.id, !r.hostMuted) }, r.hostMuted ? 'Allow to talk' : 'Mute for all') : null,
            ),
          ),
        ),
      ),
      others.length ? h('p.gc-hint', `Not in voice: ${others.map((p) => p.name).join(', ')}`) : null,
      isHost && others.some((p) => p.hostMuted) ? h('p.gc-hint', 'Players you muted stay muted if they rejoin voice.') : null,
      h(
        'div.gc-actions',
        voice.state === 'on' ? h('button.btn.ghost', { onclick: () => (voice.leave(), sheet.close()) }, 'Leave voice') : h('button.btn.gold', { onclick: () => voice.join() }, h('span', { html: ICON.mic }), 'Join voice'),
        h('button.btn.ghost', { onclick: () => sheet.close() }, 'Done'),
      ),
    ];
  });
  // the talking glow updates in place, without replacing any buttons
  onSpeaking(body, () => {
    if (!statusOf) return;
    for (const r of voice.roster()) {
      const row = body.querySelector(`.gc-voice-person[data-id="${r.id}"]`);
      if (!row) continue;
      row.classList.toggle('speaking', r.speaking);
      row.querySelector('.gc-vs-face')?.classList.toggle('speaking', r.speaking);
      const small = row.querySelector('.gc-voice-who small');
      if (small) {
        small.textContent = statusOf(r);
        small.className = r.hostMuted || r.muted ? 'off' : r.speaking ? 'on' : '';
      }
    }
  });
}

function loadStyles(game) {
  return Promise.all(
    (game.styles || []).map((href) => {
      if (document.querySelector(`link[href="${href}"]`)) return null;
      return new Promise((resolve) => {
        const link = h('link', { rel: 'stylesheet', href });
        link.onload = link.onerror = resolve;
        document.head.append(link);
      });
    }),
  );
}

function inviteSheet(game, code) {
  const url = `${location.origin}${location.pathname}#/join/${code}`;
  modal(
    h(
      'div.gc-form',
      h('h2', 'Invite to this table'),
      h('div.gc-code', code),
      h('p.gc-hint', 'People who join during a game can be seated in place of a computer player from Settings. ', h('button.gc-link', { onclick: () => showGuide() }, 'Online play help')),
      h(
        'div.gc-actions',
        h('button.btn.gold', { onclick: () => share({ title: `Play ${game.name}`, text: `Join my ${game.name} table — code ${code}`, url }) }, 'Share invite'),
        h('button.btn.ghost', { onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Link copied')) }, 'Copy link'),
      ),
    ),
  );
}

function settingsSheet() {
  const { game, client, room } = current;
  const body = h('div.gc-form.settings');
  const sheet = modal(body);
  const toggle = (label, value, set, note) =>
    h(
      'label.gc-toggle',
      h('span', label, note ? h('small', note) : null),
      h('input', {
        type: 'checkbox',
        checked: value,
        onchange: (e) => {
          set(e.target.checked);
          draw();
        },
      }),
    );
  const draw = () => {
    const lobby = client.isHost ? room.lobby() : client.lobby;
    const mySeat = lobby?.seats.find((s) => s.playerId === client.playerId);
    const items = current.ui?.settings?.() || [];
    body.replaceChildren(
      h('h2', 'Settings'),
      h('h3', 'You'),
      toggle('Sound effects', sound.enabled, (v) => (sound.enabled = v)),
      mySeat ? toggle('Autopilot', !!mySeat.autopilot, (v) => client.setAutopilot(v), 'Let the computer play your seat until you turn this off.') : null,
      ...items.map((it) => toggle(it.label, it.value, it.set)),
      client.isHost
        ? [
            h('h3', 'Table'),
            seg('Game speed', room.settings.speed, Object.entries(SPEEDS).map(([value, s]) => ({ value, label: s.label })), (v) => (room.setSetting('speed', v), draw())),
            game.botLevels ? seg('Computer players', room.settings.botLevel, Object.entries(game.botLevels).map(([value, label]) => ({ value, label })), (v) => (room.setSetting('botLevel', v), draw())) : null,
            game.engine.claim ? toggle('Play out sure tricks automatically', room.settings.autoClaim, (v) => room.setSetting('autoClaim', v)) : null,
          ]
        : null,
      client.isHost && room.online ? seatManager(room, draw) : null,
      h('div.gc-actions', h('button.btn.ghost', { onclick: () => sheet.close() }, 'Done')),
    );
  };
  draw();
}

function seatManager(room, redraw) {
  const lobby = room.lobby();
  const waiting = lobby.players.filter((p) => p.seat == null && p.connected);
  return h(
    'div.gc-seat-manager',
    h('h3', 'Players'),
    lobby.seats.map((s) =>
      h(
        'div.gc-seat-line',
        avatar(s.name, s.hue, { bot: s.kind === 'bot', size: 'sm' }),
        h('span', `${room.game.seatLabels?.[s.seat] || 'Seat ' + (s.seat + 1)}: ${s.name}`, s.kind === 'human' && !s.connected ? h('small', ' (offline — computer covers)') : null),
        s.kind === 'bot' && waiting.length
          ? h(
              'select.gc-input.small',
              {
                onchange: (e) => {
                  if (e.target.value) {
                    room.setSeat(s.seat, 'human', e.target.value);
                    redraw();
                  }
                },
              },
              h('option', { value: '' }, 'Seat a player…'),
              waiting.map((p) => h('option', { value: p.id }, p.name)),
            )
          : null,
        s.kind === 'human' && !s.isHost ? h('button.btn.chip.danger', { onclick: () => (room.kick(s.playerId), redraw()) }, 'Remove') : null,
      ),
    ),
    waiting.length ? h('p.gc-hint', `Waiting to play: ${waiting.map((p) => p.name).join(', ')}`) : null,
  );
}

async function rulesSheet(game, online = false) {
  let html = '<p>No rules page yet.</p>';
  try {
    const res = await fetch(new URL(`../games/${game.id}/rules.html`, import.meta.url));
    if (res.ok) html = await res.text();
  } catch {
    /* offline */
  }
  const sheet = modal(
    h(
      'div',
      h('div.gc-doc.rules', { html }),
      h('div.gc-actions', h('button.btn.ghost', { onclick: () => (sheet.close(), showGuide()) }, online ? 'Online play help' : 'How to play online with friends')),
    ),
    { cls: 'wide' },
  );
}

const ICON = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  micPlus: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M3.5 11a6.5 6.5 0 0 0 11.6 4M10 17.5V21M6.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6v6M16 9h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 13.8c1.8.7 3 2.4 3 5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1.1" fill="currentColor"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 6"/><path d="M32 20v24M20 32h24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>',
};

window.gameCenter = { get current() { return current; }, GAMES };
boot();
void escapeHtml;
