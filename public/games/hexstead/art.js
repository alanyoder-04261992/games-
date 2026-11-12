// Hexstead artwork shared by the 2D hand/HUD and the 3D scene: player colors and original
// resource and almanac icons (inline SVG, 64×64).

export const SEAT_COLORS = ['#c8372d', '#2f6fd6', '#efe6d2', '#e8892b'];
export const SEAT_NAMES = ['Red', 'Blue', 'Ivory', 'Orange'];
export const SEAT_INK = ['#fff', '#fff', '#2a241c', '#2a1606'];

export const RES_COLORS = {
  timber: ['#3f7d3a', '#1f4a22'],
  brick: ['#cf6a3f', '#8a3219'],
  wool: ['#a6d16a', '#5d8f2f'],
  grain: ['#f0c650', '#b78414'],
  stone: ['#9aa4ad', '#58616a'],
};

export const RES_ICON = {
  timber: `<svg viewBox="0 0 64 64"><g stroke="#3b2412" stroke-width="2"><rect x="10" y="34" width="44" height="13" rx="6.5" fill="#9b6a3c"/><rect x="16" y="22" width="34" height="13" rx="6.5" fill="#b07a46"/><rect x="22" y="10" width="24" height="13" rx="6.5" fill="#c08a52"/></g><g fill="#e8c49a" stroke="#6d4524" stroke-width="1.5"><circle cx="16.5" cy="40.5" r="5"/><circle cx="22.5" cy="28.5" r="5"/><circle cx="28.5" cy="16.5" r="5"/></g><g fill="none" stroke="#8a5b30" stroke-width="1"><circle cx="16.5" cy="40.5" r="2.2"/><circle cx="22.5" cy="28.5" r="2.2"/><circle cx="28.5" cy="16.5" r="2.2"/></g><path d="M44 47 l4 9 M52 47 l-3 9" stroke="#4d8f3a" stroke-width="3" stroke-linecap="round"/></svg>`,
  brick: `<svg viewBox="0 0 64 64"><g stroke="#5a1d0c" stroke-width="2" fill="#c4532c"><rect x="6" y="40" width="25" height="12" rx="2"/><rect x="33" y="40" width="25" height="12" rx="2"/><rect x="19" y="26" width="25" height="12" rx="2" fill="#d8673b"/><rect x="25" y="12" width="25" height="12" rx="2" fill="#b94a26"/></g><g fill="#fff" opacity=".22"><rect x="9" y="42" width="19" height="2.5" rx="1"/><rect x="36" y="42" width="19" height="2.5" rx="1"/><rect x="22" y="28" width="19" height="2.5" rx="1"/><rect x="28" y="14" width="19" height="2.5" rx="1"/></g></svg>`,
  wool: `<svg viewBox="0 0 64 64"><g fill="#f6f3ea" stroke="#9c9586" stroke-width="1.6"><circle cx="22" cy="30" r="9"/><circle cx="33" cy="25" r="10"/><circle cx="43" cy="31" r="9"/><circle cx="28" cy="38" r="9"/><circle cx="40" cy="39" r="8"/></g><ellipse cx="51" cy="28" rx="6" ry="7.5" fill="#2e2824"/><circle cx="53" cy="26" r="1.3" fill="#fff"/><path d="M25 45 v9 M32 46 v9 M39 45 v9 M45 44 v9" stroke="#2e2824" stroke-width="3.2" stroke-linecap="round"/></svg>`,
  grain: `<svg viewBox="0 0 64 64"><g stroke="#8a6410" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M32 58 V14"/><path d="M24 58 Q26 36 20 18"/><path d="M40 58 Q38 36 44 18"/></g><g fill="#f2c84b" stroke="#a37812" stroke-width="1.2">${[14, 21, 28, 35]
    .map((y) => `<ellipse cx="28.5" cy="${y}" rx="3" ry="5.2" transform="rotate(-25 28.5 ${y})"/><ellipse cx="35.5" cy="${y}" rx="3" ry="5.2" transform="rotate(25 35.5 ${y})"/>`)
    .join('')}<ellipse cx="32" cy="9" rx="2.8" ry="5"/>${[20, 27]
    .map((y) => `<ellipse cx="18" cy="${y}" rx="2.4" ry="4.4" transform="rotate(-30 18 ${y})"/><ellipse cx="46" cy="${y}" rx="2.4" ry="4.4" transform="rotate(30 46 ${y})"/>`)
    .join('')}</g><path d="M22 47 Q32 51 42 47" stroke="#b5452e" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,
  stone: `<svg viewBox="0 0 64 64"><g stroke="#3b4148" stroke-width="2" stroke-linejoin="round"><path d="M6 52 L14 30 L28 24 L36 36 L32 52 Z" fill="#8f99a3"/><path d="M28 52 L34 30 L46 18 L58 32 L56 52 Z" fill="#a8b1ba"/><path d="M18 52 L24 42 L36 40 L42 52 Z" fill="#7a848e"/></g><g fill="#fff" opacity=".35"><path d="M15 31 L27 26 L24 33 Z"/><path d="M35 30 L45 20 L44 30 Z"/></g></svg>`,
};

export const CARD_ICON = {
  sheriff: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" fill="#e9b949" stroke="#8a6410" stroke-width="2.5"/><path d="M32 11 l5.6 13.2 14.3 1.2 -10.9 9.3 3.3 14 -12.3 -7.5 -12.3 7.5 3.3 -14 -10.9 -9.3 14.3 -1.2z" fill="#fbe28b" stroke="#8a6410" stroke-width="2" stroke-linejoin="round"/><circle cx="32" cy="33" r="4.5" fill="#c99528"/></svg>`,
  trailblazer: `<svg viewBox="0 0 64 64"><rect x="29" y="12" width="6" height="46" rx="2" fill="#8a5b30"/><path d="M12 16 h30 l8 7 -8 7 h-30z" fill="#d9a35a" stroke="#6d4524" stroke-width="2" stroke-linejoin="round"/><path d="M52 32 h-30 l-8 7 8 7 h30z" fill="#c58a45" stroke="#6d4524" stroke-width="2" stroke-linejoin="round"/><path d="M8 60 Q32 50 56 60" stroke="#6aa84f" stroke-width="4" fill="none"/></svg>`,
  harvest: `<svg viewBox="0 0 64 64"><path d="M10 30 h44 l-5 24 h-34z" fill="#b5793d" stroke="#5c3a1a" stroke-width="2" stroke-linejoin="round"/><path d="M14 38 h36 M16 46 h32" stroke="#7a4f26" stroke-width="2"/><circle cx="22" cy="24" r="8" fill="#d8402f"/><circle cx="36" cy="22" r="9" fill="#f2c84b"/><circle cx="46" cy="27" r="6" fill="#6aa84f"/><path d="M14 30 Q32 6 50 30" stroke="#5c3a1a" stroke-width="3" fill="none"/></svg>`,
  market: `<svg viewBox="0 0 64 64"><path d="M32 10 v42 M18 56 h28" stroke="#5c3a1a" stroke-width="3.5" stroke-linecap="round"/><path d="M10 20 h44" stroke="#5c3a1a" stroke-width="3" stroke-linecap="round"/><path d="M10 20 l-6 16 h12z M54 20 l-6 16 h12z" fill="none" stroke="#5c3a1a" stroke-width="2"/><path d="M3 36 a7 4 0 0 0 14 0z M47 36 a7 4 0 0 0 14 0z" fill="#e9b949" stroke="#8a6410" stroke-width="1.5"/><circle cx="32" cy="10" r="4" fill="#e9b949"/></svg>`,
  landmark: `<svg viewBox="0 0 64 64"><path d="M24 58 L28 26 h8 l4 32z" fill="#efe6d2" stroke="#5c4a36" stroke-width="2" stroke-linejoin="round"/><path d="M26 26 L32 16 L38 26z" fill="#c8372d" stroke="#5c4a36" stroke-width="2" stroke-linejoin="round"/><g stroke="#5c4a36" stroke-width="2.5" stroke-linecap="round"><path d="M32 22 L14 8 M32 22 L50 8 M32 22 L12 34 M32 22 L52 34"/></g><g fill="#d9c7a3" stroke="#5c4a36" stroke-width="1.5"><path d="M14 8 l5 -2 10 10z"/><path d="M50 8 l2 5 -16 3z"/><path d="M12 34 l-1 -5 16 -6z"/><path d="M52 34 l-5 1 -12 -11z"/></g><rect x="29.5" y="46" width="5" height="12" fill="#6d4524"/></svg>`,
};

export const PIECE_ICON = {
  road: (c) => `<svg viewBox="0 0 64 64"><rect x="6" y="26" width="52" height="12" rx="3" fill="${c}" stroke="#0006" stroke-width="2" transform="rotate(-20 32 32)"/></svg>`,
  homestead: (c) => `<svg viewBox="0 0 64 64"><path d="M14 30 L32 14 L50 30 V52 H14Z" fill="${c}" stroke="#0007" stroke-width="2.5" stroke-linejoin="round"/><path d="M10 32 L32 12 L54 32" fill="none" stroke="#0007" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="27" y="38" width="10" height="14" fill="#fff" opacity=".85"/></svg>`,
  town: (c) => `<svg viewBox="0 0 64 64"><rect x="44" y="18" width="12" height="36" rx="2" fill="#c9ccd1" stroke="#0007" stroke-width="2"/><path d="M44 18 a6 6 0 0 1 12 0" fill="#9aa1a8" stroke="#0007" stroke-width="2"/><path d="M6 54 V32 L12 22 L25 15 L38 22 L44 32 V54Z" fill="${c}" stroke="#0007" stroke-width="2.5" stroke-linejoin="round"/><rect x="17" y="36" width="16" height="18" fill="none" stroke="#fff" stroke-width="2.5"/><path d="M17 36 L33 54 M33 36 L17 54" stroke="#fff" stroke-width="2"/></svg>`,
  card: () => `<svg viewBox="0 0 64 64"><rect x="14" y="8" width="36" height="48" rx="5" fill="#3a2a1a" stroke="#e9b949" stroke-width="2.5"/><rect x="19" y="13" width="26" height="38" rx="3" fill="none" stroke="#e9b949" stroke-width="1.2" opacity=".7"/><text x="32" y="40" font-size="22" text-anchor="middle" fill="#e9b949" font-family="Georgia,serif" font-weight="700">A</text></svg>`,
};

export const DICE_ICON = `<svg viewBox="0 0 64 64"><rect x="6" y="18" width="30" height="30" rx="6" fill="#f4ecd8" stroke="#0006" stroke-width="2" transform="rotate(-12 21 33)"/><rect x="30" y="12" width="28" height="28" rx="6" fill="#c8372d" stroke="#0006" stroke-width="2" transform="rotate(10 44 26)"/><g fill="#2a2118"><circle cx="15" cy="27" r="2.6"/><circle cx="21" cy="33" r="2.6"/><circle cx="27" cy="39" r="2.6"/></g><g fill="#fff"><circle cx="39" cy="21" r="2.4"/><circle cx="49" cy="23" r="2.4"/><circle cx="37" cy="30" r="2.4"/><circle cx="47" cy="32" r="2.4"/></g></svg>`;

export const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
