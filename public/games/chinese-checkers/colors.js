// Marble colours, by seat. The board tints each player's home point in their colour.
export const COLORS = [
  { name: 'Red', hex: '#e0362b', light: '#ff8a7a', dark: '#7d130d' },
  { name: 'Blue', hex: '#2f6fe0', light: '#8cb6ff', dark: '#0f2f7a' },
  { name: 'Green', hex: '#2fa84f', light: '#8fe6a5', dark: '#0d4f1f' },
  { name: 'Gold', hex: '#f2b81c', light: '#ffe28a', dark: '#8f6400' },
  { name: 'Purple', hex: '#8b4fd6', light: '#c8a2ff', dark: '#3d1a70' },
  { name: 'White', hex: '#e9ecef', light: '#ffffff', dark: '#8a9099' },
];
export const SEAT_NAMES = COLORS.map((c) => c.name);
