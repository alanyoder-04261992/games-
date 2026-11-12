// Ridgeline Rally's screen: the game itself lives in play.html, shown in a frame so its
// 3D circuit, styles and keyboard handling stay separate from the Game Center. This file is
// the bridge between the two: it tells the game who is at the table, passes real-time
// messages both ways, and turns "the host called the results" into a normal Game Center action.
export function mount(ctx) {
  const frame = document.createElement('iframe');
  frame.className = 'rl-frame';
  frame.title = 'Ridgeline Rally';
  frame.allow = 'fullscreen; gamepad; autoplay';
  frame.setAttribute('allowfullscreen', '');
  frame.src = new URL('./play.html?embed=1', import.meta.url).href;
  ctx.el.append(frame);

  let ready = false;
  let last = null;
  let wasOver = false;
  const post = (msg) => frame.contentWindow?.postMessage({ df: 1, ...msg }, location.origin);
  const roster = (seats) => (seats || []).map((s) => ({ seat: s.seat, name: s.name, hue: s.hue, kind: s.kind, connected: s.connected, isHost: !!s.isHost, level: s.level }));
  const mySeat = (seats, fallback) => {
    const s = (seats || []).find((x) => x.playerId === ctx.client.playerId);
    return s ? s.seat : fallback ?? null;
  };
  const init = (type = 'init') => {
    if (!ready || !last) return;
    post({ type, seat: last.seat, isHost: ctx.client.isHost, roster: roster(last.seats), options: last.view.options });
    if (last.view.over) post({ type: 'over', results: last.view.results });
    wasOver = !!last.view.over;
  };

  const offState = ctx.client.on('state', (msg) => {
    const prev = last;
    last = msg;
    if (!ready) return;
    if (!prev) return init();
    if (msg.event?.type === 'start') return init(); // a new round (rematch) resets the game
    post({ type: 'roster', roster: roster(msg.seats), seat: msg.seat });
    if (msg.view.over && !wasOver) post({ type: 'over', results: msg.view.results });
    wasOver = !!msg.view.over;
  });
  // seat changes and players dropping in and out arrive with the lobby
  const offLobby = ctx.client.on('lobby', (lobby) => {
    if (ready && last && lobby?.started) post({ type: 'roster', roster: roster(lobby.seats), seat: mySeat(lobby.seats, last.seat) });
  });
  const offRt = ctx.client.on('rt', (m) => ready && post({ type: 'rt', from: m.from, data: m.data }));

  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || !e.data?.df) return;
    const d = e.data;
    if (d.type === 'ready') {
      ready = true;
      init();
    } else if (d.type === 'rt') ctx.client.send({ t: 'rt', data: d.data });
    else if (d.type === 'finish' && ctx.client.isHost) ctx.client.act({ type: 'finish', results: d.results });
    else if (d.type === 'rematch' && ctx.client.isHost) ctx.client.send({ t: 'rematch' });
    else if (d.type === 'leave') ctx.leave();
  };
  window.addEventListener('message', onMessage);
  frame.addEventListener('load', () => frame.focus());

  return {
    destroy() {
      offState();
      offLobby();
      offRt();
      window.removeEventListener('message', onMessage);
      frame.remove();
    },
  };
}
