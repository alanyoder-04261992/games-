// The one Rematch button every game shows when a game ends: same players, same seats, same
// table options and the same room code, so nobody has to rejoin.
//
//   ctx.rematch()                  → element to put on your game-over screen
//   ctx.rematch({ big: true })     → a larger button (Rook's end screen)
//   ctx.rematch({ label: 'Race again' })   → your own wording for the host's button
//
// The host's tap starts the new game for everyone. Anyone else's tap says "I'm in": their
// button then waits for the host, and the host's button lists who is ready. Playing alone
// (computer players only) it is simply "Play again".
//
// Games that never draw an end screen of their own still get this control: the table shows
// it in a floating bar once the game is over (see app.js).
import { h } from './util.js';

export function rematchControl(client, { big = false, label } = {}) {
  const el = h('div.gc-rematch');
  let sent = false;
  const paint = () => {
    const lobby = client.lobby;
    const players = lobby?.players || [];
    const humans = players.filter((p) => p.seat != null);
    const solo = !lobby?.online || humans.length <= 1;
    const ready = new Set(lobby?.rematch || []);
    const names = humans.filter((p) => ready.has(p.id)).map((p) => p.name);
    const host = players.find((p) => p.isHost);
    const seated = humans.some((p) => p.id === client.playerId);
    const btn = (text, opts = {}) => h(`button.btn.gold${big ? '.big' : ''}.gc-rematch-btn`, { type: 'button', ...opts }, text);
    if (client.isHost) {
      const waiting = humans.filter((p) => !p.isHost && p.connected && !ready.has(p.id)).length;
      el.replaceChildren(
        btn(label || (solo ? 'Play again' : 'Rematch — same players'), {
          onclick: () => client.send({ t: 'rematch' }),
          title: solo ? 'Start a new game' : 'Start a new game with everyone at this table, same seats and room code',
        }),
        solo ? null : h('small.gc-rematch-note', names.length ? `${list(names)} ${names.length === 1 ? 'is' : 'are'} in${waiting ? ` · waiting on ${waiting} more` : ''}` : 'Starts a new game for everyone here'),
      );
    } else if (!seated) {
      el.replaceChildren(h('small.gc-rematch-note', `Watching · ${host?.name || 'the host'} can start a rematch`));
    } else if (sent || ready.has(client.playerId)) {
      el.replaceChildren(
        btn("You're in ✓", { disabled: true }),
        h('small.gc-rematch-note', `Waiting for ${host?.name || 'the host'} to start${names.length > 1 ? ` · ${list(names.filter((n) => n !== myName(players, client)))} also in` : ''}`),
      );
    } else {
      el.replaceChildren(
        btn(label && !/again/i.test(label) ? label : 'Rematch', {
          onclick: () => {
            sent = true;
            client.send({ t: 'rematch' });
            paint();
          },
          title: `Tell ${host?.name || 'the host'} you're in for another game with the same players`,
        }),
        h('small.gc-rematch-note', `Same players and seats · ${host?.name || 'the host'} starts it`),
      );
    }
  };
  const offLobby = client.on('lobby', () => (el.isConnected || !el.dataset.mounted ? paint() : offAll()));
  // a new game resets the button (the old end screen usually goes away too)
  const offState = client.on('state', (msg) => {
    if (msg.event?.type === 'start') sent = false;
    if (!el.isConnected && el.dataset.mounted) offAll();
  });
  const offAll = () => {
    offLobby();
    offState();
  };
  requestAnimationFrame(() => (el.dataset.mounted = '1'));
  paint();
  return el;
}

const list = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const myName = (players, client) => players.find((p) => p.id === client.playerId)?.name;
