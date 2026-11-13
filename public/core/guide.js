// "How to play online" guide, shown from the home page, the lobby and the table.
// It can also be linked directly: …/#/help
import { h } from './util.js';

const I = {
  host: '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  seats: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 20c0-3 2.2-5 5-5s5 2 5 5M11 20c0-3 2.2-5 5-5s5 2 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  code: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12h.01M10.5 12h.01M14 12h.01M17.5 12h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  name: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  robot: '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3v5" stroke="currentColor" stroke-width="2"/><circle cx="9.5" cy="13" r="1.5" fill="currentColor"/><circle cx="14.5" cy="13" r="1.5" fill="currentColor"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const step = (n, icon, title, ...body) =>
  h('li.gd-step', h('div.gd-num', String(n)), h('div.gd-icon', { html: I[icon] }), h('div.gd-text', h('strong', title), h('p', ...body)));

const tip = (icon, title, ...body) => h('div.gd-tip', h('div.gd-icon.small', { html: I[icon] }), h('div', h('strong', title), h('p', ...body)));

const qa = (q, ...a) => h('details.gd-qa', h('summary', q), h('p', ...a));

export function onlineGuide({ onHost, onJoin } = {}) {
  return h(
    'div.gd',
    h('h2', 'How to play online'),
    h('p.gd-lead', 'Play with family and friends on their own phones, tablets or computers — in the same room or across the country. Nothing to install and no accounts: one person opens a table and the others join with a code.'),

    h('section.gd-section', h('h3', 'Start a table (the host)'),
      h('ol.gd-steps',
        step(1, 'host', 'Tap “Multiplayer”', 'On the home page, pick a game and tap ', h('b', 'Multiplayer'), '. A 5-letter table code appears, like ', h('code', 'KDRWP'), '.'),
        step(2, 'share', 'Invite people', 'Tap ', h('b', 'Invite'), ' to text or email the link, or just read the code out loud. ', h('b', 'Copy link'), ' works too.'),
        step(3, 'seats', 'Check the seats', 'Friends appear in seats as they join. In Rook the first friend sits across from you as your partner. Use ', h('b', 'Sit here'), ' to move yourself, ', h('b', 'Add computer'), ' to fill a chair, or ', h('b', 'Remove'), ' if someone joined by mistake.'),
        step(4, 'play', 'Start the game', 'Tap ', h('b', 'Start game'), '. Any empty seats get computer players automatically, so you can start with just two people.'),
      ),
      onHost ? h('div.gd-cta', h('button.btn.gold', { onclick: onHost }, 'Host a Rook table now')) : null,
    ),

    h('section.gd-section', h('h3', 'Join a table (everyone else)'),
      h('ol.gd-steps',
        step(1, 'link', 'Open the invite link', 'Tap the link the host sent. It opens the Game Center right at their table.'),
        step(2, 'code', 'Or type the code', 'Open the Game Center, type the 5 letters into ', h('b', 'Join a friend’s table'), ' on the home page, and tap ', h('b', 'Join'), '.'),
        step(3, 'name', 'Pick your name', 'The first time, choose a name and a color so everyone knows who’s who. Then wait for the host to start.'),
      ),
      onJoin ? h('div.gd-cta', h('button.btn.ghost', { onclick: onJoin }, 'I have a code')) : null,
    ),

    h('section.gd-section', h('h3', 'During the game'),
      h('div.gd-tips',
        tip('chat', 'Chat and cheer', 'Tap the chat bubble at the top for messages and quick reactions. They pop up over your seat at the table.'),
        tip('robot', 'Nobody gets stuck waiting', 'If someone’s phone drops off, a computer player covers their seat after a few seconds. When they come back, they get their seat back.'),
        tip('refresh', 'Lost connection? Just reopen', 'Refreshing or reopening the page puts you right back at your seat. The home page also shows a ', h('b', 'Rejoin table'), ' button.'),
        tip('seats', 'Late arrivals', 'Someone can join after the game starts. The host opens ', h('b', 'Settings → Players'), ' and seats them in place of a computer player.'),
        tip('play', 'Rematch with the same players', 'When a game ends, tap ', h('b', 'Rematch'), '. Same players, same seats, same table code — nobody rejoins. The host’s tap starts it; everyone else’s tells the host they’re in.'),
      ),
    ),

    h('section.gd-section', h('h3', 'Talk while you play (voice chat)'),
      h('div.gd-tips',
        tip('mic', 'Join voice', 'Tap the ', h('b', 'microphone'), ' at the top of the table (or ', h('b', 'Join voice'), ' in the lobby) and allow the microphone. Everyone in voice hears everyone — players and people watching.'),
        tip('mic', 'Always on, with mute', 'Your mic stays on so you can just talk. Tap the green mic to mute; tap the red one to talk again. Whoever is talking lights up green.'),
        tip('seats', 'The host can mute anyone', 'The host taps the people button next to the mic and picks ', h('b', 'Mute for all'), '. That person can’t unmute until the host taps ', h('b', 'Allow to talk'), '.'),
        tip('chat', 'Too loud? Silence just for you', 'In the same list, ', h('b', 'Silence'), ' stops you hearing one person without muting them for anyone else.'),
      ),
      h('p.gd-note', 'Voice goes straight between your devices — nothing is recorded. Use headphones or keep the volume moderate to avoid echo.'),
    ),

    h('section.gd-section', h('h3', 'Good to know'),
      h('ul.gd-list',
        h('li', h('b', 'The host’s device runs the game.'), ' Keep the host’s screen on and the Game Center open. If the host’s phone locks, the table pauses until it wakes up. A tablet or computer on a charger makes a great host.'),
        h('li', h('b', 'Any internet works.'), ' Players don’t need to be on the same Wi-Fi — home Wi-Fi, cellular, anywhere.'),
        h('li', h('b', 'Games are saved.'), ' If the host closes the page, they can reopen the table from ', h('b', 'Pick up where you left off'), ' on the home page — same code, and everyone rejoins.'),
        h('li', h('b', 'Seats:'), ' Rook is for 4 (partners sit across), Four in a Row for 2. Computer players fill any extra chairs.'),
      ),
    ),

    h('section.gd-section', h('h3', 'If something isn’t working'),
      qa('“No table found with that code”', 'Check the letters — codes never use the letters I or O or the numbers 0 and 1. Then make sure the host still has the table open. If the host closed it, ask them to tap Continue on their home page.'),
      qa('It says “Connecting…” and never joins', 'Try switching between Wi-Fi and cellular on the phone that is stuck. Some work, school and hotel networks block direct connections between devices; cellular data almost always works.'),
      qa('Someone shows “Reconnecting…”', 'Their device lost the connection or went to sleep. A computer player is covering for them — they just reopen the link or refresh to take their seat back.'),
      qa('The game froze for everybody', 'The host’s device probably went to sleep. Have the host unlock their screen and open the Game Center again.'),
      qa('Voice chat: nobody can hear me', 'Check the mic at the top is green, not red. If it says the host muted you, ask them to tap Allow to talk. If the browser blocked the microphone, allow it in the browser’s site settings (on iPhone: Settings → Safari → Microphone) and tap Join voice again.'),
      qa('Voice chat: I can’t hear anyone', 'Turn up the volume and make sure the phone isn’t on silent. On iPhone, tap the screen once — phones only start sound after a tap. If one person is missing, they may be on a network that blocks direct connections; switching them to cellular usually fixes it.'),
            qa('Can I play from a computer and others on phones?', 'Yes — any mix of phones, tablets and computers works, in any modern browser (Safari, Chrome, Edge, Firefox).'),
    ),

    h('section.gd-section', h('h3', 'Put it on your home screen'),
      h('div.gd-tips',
        tip('phone', 'iPhone and iPad', 'Open the Game Center in Safari, tap the ', h('b', 'Share'), ' button, then ', h('b', 'Add to Home Screen'), '. It opens full-screen like an app.'),
        tip('phone', 'Android', 'Open it in Chrome, tap the ', h('b', '⋮'), ' menu, then ', h('b', 'Add to Home screen'), ' or ', h('b', 'Install app'), '.'),
      ),
    ),
  );
}
