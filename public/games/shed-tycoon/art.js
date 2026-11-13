// Shed Tycoon drawings: material tokens and the little buildings on the order cards (SVG).
export const MAT_COLORS = ['#a8703c', '#7d8a96', '#6fb7d6', '#c8433a', '#3f7d48', '#e6b43c'];

const ICONS = [
  // lumber: a stack of boards
  '<rect x="5" y="7" width="14" height="3" rx="1" fill="#fff"/><rect x="5" y="11" width="14" height="3" rx="1" fill="#fff" opacity=".85"/><rect x="5" y="15" width="14" height="3" rx="1" fill="#fff" opacity=".7"/>',
  // steel: an I-beam
  '<path d="M6 6h12v3h-4.5v6H18v3H6v-3h4.5V9H6z" fill="#fff"/>',
  // glass: a window
  '<rect x="6" y="6" width="12" height="12" rx="1" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="1.6"/>',
  // paint: a drop
  '<path d="M12 4c3 4.5 5.5 7.5 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 11.5 9 8.5 12 4z" fill="#fff"/>',
  // shingles: a little roof
  '<path d="M4 15 12 7l8 8z" fill="#fff"/><path d="M7 15h10M8.5 12.5h7" stroke="#0005" stroke-width="1.2"/><rect x="7" y="15" width="10" height="3" fill="#fff" opacity=".7"/>',
  // cash
  '<text x="12" y="17" font-size="13" font-weight="800" text-anchor="middle" fill="#5a3b00" font-family="system-ui,sans-serif">$</text>',
];

export const matIcon = (m) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[m]}</svg>`;

// a building silhouette for an order card, by tier
export function buildingArt(tier, bonus) {
  const k = MAT_COLORS[bonus];
  const wall = `color-mix(in srgb, ${k} 70%, #fff)`;
  const roof = '#3b3029';
  if (tier === 0)
    return `<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="0" y="44" width="80" height="6" fill="#0003"/><path d="M22 22 40 10l18 12z" fill="${roof}"/><rect x="25" y="22" width="30" height="22" fill="${wall}"/><rect x="35" y="29" width="10" height="15" fill="#0004"/><circle cx="62" cy="40" r="5" fill="#4b7d3e"/></svg>`;
  if (tier === 1)
    return `<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="0" y="44" width="80" height="6" fill="#0003"/><path d="M14 24 22 12h36l8 12z" fill="${roof}"/><rect x="16" y="24" width="48" height="20" fill="${wall}"/><path d="M31 44V30h18v14" fill="#0004"/><path d="M31 30l18 14M49 30 31 44" stroke="#fff6" stroke-width="1.5"/><rect x="36" y="16" width="8" height="6" fill="#fff8"/></svg>`;
  return `<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="0" y="44" width="80" height="6" fill="#0003"/><path d="M6 22 28 8l22 14z" fill="${roof}"/><rect x="9" y="22" width="38" height="22" fill="${wall}"/><path d="M44 26 58 14l16 12z" fill="${roof}"/><rect x="47" y="26" width="25" height="18" fill="${wall}"/><rect x="14" y="30" width="12" height="14" fill="#0004"/><rect x="31" y="27" width="10" height="8" fill="#fff8"/><rect x="51" y="31" width="17" height="13" fill="#0004"/><path d="M51 35h17M51 39h17" stroke="#fff4"/></svg>`;
}

export const TILE_ART = (() => {
  const token = (x, y, m) =>
    `<g transform="translate(${x} ${y})"><circle r="17" fill="${MAT_COLORS[m]}" stroke="#0005" stroke-width="2"/><circle r="12" fill="none" stroke="#fff5" stroke-width="2"/><g transform="translate(-12 -12)">${ICONS[m]}</g></g>`;
  const cardAt = (x, y, tier, bonus, pts) =>
    `<g transform="translate(${x} ${y}) rotate(${(bonus - 2) * 3})"><rect width="92" height="120" rx="9" fill="#f6efe1" stroke="#0004" stroke-width="2"/><rect x="5" y="5" width="82" height="30" rx="6" fill="${MAT_COLORS[bonus]}" opacity=".85"/><text x="12" y="28" font-size="22" font-weight="800" fill="#fff" font-family="system-ui,sans-serif">${pts}</text><g transform="translate(6 40) scale(1)">${buildingArt(tier, bonus).replace('<svg', '<svg width="80" height="50"')}</g><circle cx="20" cy="104" r="8" fill="${MAT_COLORS[(bonus + 1) % 5]}"/><circle cx="40" cy="104" r="8" fill="${MAT_COLORS[(bonus + 2) % 5]}"/><circle cx="60" cy="104" r="8" fill="${MAT_COLORS[(bonus + 3) % 5]}"/></g>`;
  return `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="stbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e4a3a"/><stop offset="1" stop-color="#13251c"/></linearGradient></defs>
  <rect width="400" height="240" fill="url(#stbg)"/>
  ${cardAt(70, 40, 0, 2, 1)}${cardAt(160, 30, 1, 4, 2)}${cardAt(250, 44, 2, 3, 4)}
  ${token(60, 200, 0)}${token(104, 206, 1)}${token(148, 200, 2)}${token(252, 206, 3)}${token(296, 200, 4)}${token(340, 206, 5)}
</svg>`;
})();
