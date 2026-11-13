// Escape the Grind — game data: jobs, the two boards, and every deck.
// All names, numbers and companies here are made up for this game.

// ---------------------------------------------------------------------------------------------
// Jobs. Each job's monthly budget is built from its salary so every job plays fair:
// better-paid jobs have bigger bills, so they need more passive income to break free.
// ---------------------------------------------------------------------------------------------
const JOB_LIST = [
  { id: 'builder', name: 'Shed Builder', salary: 3800, savings: 900, degree: false },
  { id: 'dealer', name: 'Shed Lot Dealer', salary: 4600, savings: 1200, degree: false },
  { id: 'driver', name: 'Delivery Driver', salary: 3900, savings: 700, degree: false },
  { id: 'teacher', name: 'Teacher', salary: 3400, savings: 500, degree: true },
  { id: 'nurse', name: 'Nurse', salary: 5000, savings: 600, degree: true },
  { id: 'electrician', name: 'Electrician', salary: 5400, savings: 1100, degree: false },
  { id: 'officer', name: 'Police Officer', salary: 3700, savings: 600, degree: false },
  { id: 'manager', name: 'Office Manager', salary: 4300, savings: 500, degree: true },
  { id: 'developer', name: 'Software Developer', salary: 7800, savings: 400, degree: true },
  { id: 'dentist', name: 'Dentist', salary: 12500, savings: 300, degree: true },
];

const r10 = (n) => Math.round(n / 10) * 10;
const r100 = (n) => Math.round(n / 100) * 100;

export function buildJob(j) {
  const s = j.salary;
  const pay = {
    taxes: r10(s * 0.18),
    home: r10(s * 0.16),
    school: j.degree ? r10(s * 0.035) : 0,
    car: r10(s * 0.045),
    card: r10(s * 0.035),
    retail: 50,
    other: r10(s * 0.15),
  };
  return {
    id: j.id,
    name: j.name,
    salary: s,
    savings: j.savings,
    perChild: r10(s * 0.055),
    expenses: pay,
    debts: {
      home: { label: 'Home mortgage', balance: r100(pay.home * 105), pay: 'home' },
      school: pay.school ? { label: 'Student loan', balance: r100(pay.school * 60), pay: 'school' } : null,
      car: { label: 'Car loan', balance: r100(pay.car * 48), pay: 'car' },
      card: { label: 'Credit cards', balance: r100(pay.card * 32), pay: 'card' },
      retail: { label: 'Store card', balance: 1000, pay: 'retail' },
    },
  };
}
export const JOBS = JOB_LIST.map(buildJob);

export const EXPENSE_LABELS = {
  taxes: 'Taxes',
  home: 'Home payment',
  school: 'Student loan payment',
  car: 'Car payment',
  card: 'Credit card payment',
  retail: 'Store card payment',
  other: 'Groceries, phone & other',
};

// ---------------------------------------------------------------------------------------------
// Boards. The Grind is the inner loop; the Freedom Ring is the outer one.
// ---------------------------------------------------------------------------------------------
// opp = Opportunity, pay = Payday, mkt = Market, spl = Splurge, chr = Give, kid = New baby, lay = Laid off
export const GRIND = [
  'pay', 'opp', 'spl', 'opp', 'chr', 'opp',
  'pay', 'opp', 'mkt', 'opp', 'kid', 'opp',
  'pay', 'opp', 'spl', 'opp', 'mkt', 'opp',
  'pay', 'opp', 'lay', 'opp', 'mkt', 'spl',
];
// fpay = Freedom payday, ven = Venture, drm = Dream, set = Setback
export const RING = [
  'fpay', 'ven', 'drm', 'ven', 'set', 'ven',
  'fpay', 'drm', 'ven', 'ven', 'drm', 'set',
  'fpay', 'ven', 'drm', 'ven', 'ven', 'fpay',
  'drm', 'set', 'ven', 'fpay', 'drm', 'ven',
];
// Each kind of space has its own hue (no two spaces on the same loop look alike) that matches its
// deck where it has one; colors are deep enough to stay saturated under the table's lighting.
export const SPACE_INFO = {
  pay: { label: 'Payday', color: '#17914c' },
  opp: { label: 'Opportunity', color: '#1c58c9' },
  mkt: { label: 'Market', color: '#7434cf' },
  spl: { label: 'Splurge', color: '#e0521f' },
  chr: { label: 'Give', color: '#0b8f8a' },
  kid: { label: 'New Baby', color: '#d63f8c' },
  lay: { label: 'Laid Off', color: '#3b414d' },
  fpay: { label: 'Freedom Payday', color: '#138a4e' },
  ven: { label: 'Venture', color: '#0a7fae' },
  drm: { label: 'Dream', color: '#dc9a06' },
  set: { label: 'Setback', color: '#b3202b' },
};

// Dreams sit on fixed Dream spaces of the Freedom Ring (in RING order).
export const DREAMS = [
  { name: 'Lake Cabin & Dock', cost: 200000, text: 'A log cabin on the water, a dock, and a boat for the grandkids.' },
  { name: 'Sail Around the World', cost: 320000, text: 'A year at sea on your own blue-water sailboat.' },
  { name: 'Horse Ranch', cost: 380000, text: '200 acres, a red barn and a string of good horses.' },
  { name: 'Youth Camp', cost: 450000, text: 'Build a summer camp where kids learn to work, build and lead.' },
  { name: 'Shed Factory', cost: 600000, text: 'Your own plant turning out 40 portable buildings a week.' },
  { name: 'Family Foundation', cost: 900000, text: 'Fund schools, clinics and wells for generations.' },
];

// ---------------------------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------------------------
export const STOCKS = {
  OAK: { name: 'Oakline Lumber', note: 'Lumber prices swing with the housing market.' },
  NPK: { name: 'Northpeak Tech', note: 'A young software company. Wild price swings.' },
  CRL: { name: 'Coastal Rail', note: 'A freight railroad. Slow and steady.' },
  BMF: { name: 'Brightway Fund', note: 'A broad index fund. Rarely cheap, rarely crazy.' },
};

// ---------------------------------------------------------------------------------------------
// Decks. Each card is plain JSON. Variants are generated so the decks feel big.
// ---------------------------------------------------------------------------------------------
// Positive cash flows are scaled up a little so a game lasts about an evening.
const boost = (flow) => (flow > 0 ? r10(flow * 1.5) : flow);
function estate(name, cat, model, cost, down, flow, text, extra = {}) {
  flow = boost(flow);
  return { type: 'asset', kind: 'estate', name, cat, model, cost, down, mortgage: cost - down, flow, text, ...extra };
}
function biz(name, cat, model, cost, down, flow, text, extra = {}) {
  flow = boost(flow);
  return { type: 'asset', kind: 'business', name, cat, model, cost, down, mortgage: cost - down, flow, text, ...extra };
}

export function smallDeals() {
  const cards = [];
  const prices = { OAK: [1, 5, 10, 20, 30, 40], NPK: [1, 5, 10, 20, 30, 40], CRL: [5, 10, 20, 30], BMF: [10, 20, 30] };
  for (const [sym, list] of Object.entries(prices))
    for (const price of list) {
      cards.push({ type: 'stock', sym, price, name: `${STOCKS[sym].name} (${sym})`, text: `${STOCKS[sym].note} Shares trade at $${price} today. Buy as many as you like, or sell what you own.` });
      if (price <= 10 || price >= 30) cards.push({ type: 'stock', sym, price, name: `${STOCKS[sym].name} (${sym})`, text: `${price <= 10 ? 'Bad news drags the price down.' : 'Great earnings push the price up.'} Shares trade at $${price}.` });
    }
  cards.push({ type: 'split', sym: 'NPK', factor: 2, name: 'Northpeak Tech splits 2-for-1', text: 'Everyone holding NPK now owns twice as many shares.' });
  cards.push({ type: 'split', sym: 'OAK', factor: 2, name: 'Oakline Lumber splits 2-for-1', text: 'Everyone holding OAK now owns twice as many shares.' });
  cards.push({ type: 'split', sym: 'NPK', factor: 0.5, name: 'Northpeak Tech reverse split', text: 'Every two NPK shares become one. Holders lose half their shares.' });
  const houses = [
    ['Starter House 3BR/2BA', 65000, 6500, 180, 'A tired 1990s ranch. Paint, carpet and it rents fast.'],
    ['Starter House 3BR/2BA', 58000, 5000, 140, 'Seller is moving for work and wants a quick close.'],
    ['Fixer-Upper 2BR/1BA', 45000, 3000, 120, 'Bank-owned. Needs a roof, but the numbers work.'],
    ['Fixer-Upper 2BR/1BA', 40000, 2500, 60, 'Cheap, but the neighborhood is slow to rent.'],
    ['Starter House 3BR/2BA', 72000, 7000, -50, 'Pretty house, but rent will not cover the payment.'],
  ];
  for (const [n, c, d, f, t] of houses) cards.push(estate(n, 'house', 'house', c, d, f, t));
  cards.push(estate('Condo 2BR/2BA', 'condo', 'condo', 42000, 4000, 140, 'Foreclosed condo near the hospital. Nurses rent these fast.'));
  cards.push(estate('Condo 2BR/2BA', 'condo', 'condo', 50000, 5000, 100, 'Owner is retiring to Florida and wants out.'));
  cards.push(estate('Condo 2BR/1BA', 'condo', 'condo', 38000, 3500, -20, 'HOA fees eat the rent. Only a bargain if prices rise.'));
  cards.push(estate('Rent-to-Own Shed Lot', 'shedlot', 'shed', 24000, 4000, 320, 'Eight portable buildings on rent-to-own contracts along a busy highway.'));
  cards.push(estate('Rent-to-Own Shed Lot', 'shedlot', 'shed', 30000, 5000, 380, 'Ten buildings on contract, two paid off soon. A retiring dealer sells out.'));
  cards.push(estate('Backyard Storage Shed', 'shedlot', 'shed', 6000, 1000, 90, 'A 12x24 barn-style shed rented to a neighbor for storage.'));
  cards.push(estate('Backyard Storage Shed', 'shedlot', 'shed', 5000, 1000, 70, 'A 10x16 lofted shed rented as a hobby shop.'));
  cards.push(biz('Vending Route', 'biz', 'store', 3500, 3500, 110, 'Twelve snack machines in truck stops. Cash business, no loan.'));
  cards.push(biz('Lawn & Snow Route', 'biz', 'store', 2500, 2500, 120, 'Forty steady customers. The owner is moving and sells the trailer and mowers.'));
  cards.push(biz('Mobile Car Detailing', 'biz', 'store', 4000, 4000, 160, 'A van, a pressure washer and a full calendar.'));
  cards.push({ type: 'asset', kind: 'coin', name: 'Silver Coins (10)', cat: 'coins', model: 'coins', cost: 3000, down: 3000, mortgage: 0, flow: 0, count: 10, text: 'Ten one-ounce silver coins at $300 each. No income, but a Market card may pay more.' });
  cards.push({ type: 'asset', kind: 'coin', name: 'Gold Coins (2)', cat: 'coins', model: 'coins', cost: 4000, down: 4000, mortgage: 0, flow: 0, count: 2, text: 'Two gold coins at $2,000 each. A hedge for hard times.' });
  cards.push({ type: 'asset', kind: 'land', name: '10 Acres of Land', cat: 'land', model: 'land', cost: 5000, down: 5000, mortgage: 0, flow: 0, text: 'Raw land outside town. No income now; a builder may want it someday.' });
  return cards;
}

export function bigDeals() {
  return [
    estate('Duplex', 'plex', 'plex', 90000, 10000, 420, 'Both sides rented to long-term tenants.', { units: 2 }),
    estate('Duplex', 'plex', 'plex', 100000, 12000, 300, 'Needs new windows, but it is always full.', { units: 2 }),
    estate('4-Plex', 'plex', 'plex', 160000, 24000, 900, 'Brick fourplex near the college.', { units: 4 }),
    estate('4-Plex', 'plex', 'plex', 140000, 20000, 700, 'Estate sale. The heirs want cash and a fast close.', { units: 4 }),
    estate('8-Unit Apartments', 'apt', 'apt', 320000, 40000, 1800, 'Two stories, eight units, coin laundry on site.', { units: 8 }),
    estate('8-Unit Apartments', 'apt', 'apt', 280000, 35000, 1300, 'A tired building with a great location.', { units: 8 }),
    estate('16-Unit Apartments', 'apt', 'apt', 560000, 70000, 3200, 'Fully rented. The owner is retiring after 30 years.', { units: 16 }),
    estate('House 3BR/2BA on the Lake', 'house', 'house', 120000, 15000, 600, 'A vacation rental booked solid every summer.'),
    estate('House 4BR/3BA', 'house', 'house', 110000, 12000, 450, 'A big family home in a top school district.'),
    estate('Self-Storage Facility', 'storage', 'storage', 240000, 36000, 1600, 'Forty climate-controlled units off the interstate.'),
    estate('Self-Storage Facility', 'storage', 'storage', 200000, 30000, 1200, 'Thirty drive-up units and room to add more.'),
    biz('Shed Dealership', 'shedlot', 'shed', 180000, 30000, 2200, 'A display lot with 30 rent-to-own contracts and a steady stream of buyers.'),
    biz('Shed Dealership', 'shedlot', 'shed', 140000, 25000, 1500, 'Two lots on the same highway. The owner wants to retire.'),
    biz('Car Wash', 'biz', 'store', 220000, 40000, 2000, 'Four self-serve bays and an automatic tunnel.'),
    biz('Laundromat', 'biz', 'store', 110000, 18000, 1100, 'Thirty machines near the apartments. Mostly coins and cards.'),
    biz('Pizza Shop', 'biz', 'store', 90000, 15000, 800, 'A busy corner shop with a loyal lunch crowd.'),
    biz('Hardware Store', 'biz', 'store', 260000, 45000, 2400, 'The only hardware store in a growing town.'),
    biz('Pizza Shop', 'biz', 'store', 80000, 20000, -100, 'Charming, but it loses money every month.'),
  ];
}

export function marketCards() {
  return [
    { type: 'offer', cat: 'house', price: 95000, name: 'Young family wants a house', text: 'Buyers offer $95,000 for any house. Sell if you like.' },
    { type: 'offer', cat: 'house', price: 130000, name: 'Hot housing market', text: 'Buyers offer $130,000 for any house.' },
    { type: 'offer', cat: 'house', price: 70000, name: 'Investor wants a house', text: 'An investor offers $70,000 for any house.' },
    { type: 'offer', cat: 'condo', price: 75000, name: 'Condo buyer', text: 'A retired couple offers $75,000 for any condo.' },
    { type: 'offer', cat: 'condo', price: 55000, name: 'Condo buyer', text: 'Someone offers $55,000 for any condo.' },
    { type: 'offer', cat: 'plex', perUnit: 55000, name: 'Multi-family buyer', text: 'A buyer pays $55,000 per unit for any duplex or 4-plex.' },
    { type: 'offer', cat: 'plex', perUnit: 40000, name: 'Multi-family buyer', text: 'A buyer pays $40,000 per unit for any duplex or 4-plex.' },
    { type: 'offer', cat: 'apt', perUnit: 50000, name: 'Apartment REIT', text: 'A big fund pays $50,000 per unit for any apartment building.' },
    { type: 'offer', cat: 'apt', perUnit: 38000, name: 'Apartment buyer', text: 'A buyer pays $38,000 per unit for apartments.' },
    { type: 'offer', cat: 'shedlot', mult: 2.5, name: 'Shed company buyout', text: 'A regional shed company buys any shed lot or dealership for 2.5x what you paid.' },
    { type: 'offer', cat: 'shedlot', mult: 1.6, name: 'Shed dealer wants inventory', text: 'A dealer buys any shed lot or dealership for 1.6x what you paid.' },
    { type: 'offer', cat: 'storage', mult: 2, name: 'Storage chain expands', text: 'A national chain buys any storage facility for 2x what you paid.' },
    { type: 'offer', cat: 'biz', mult: 2.2, name: 'Business buyer', text: 'An entrepreneur buys any small business for 2.2x what you paid.' },
    { type: 'offer', cat: 'coins', mult: 3, name: 'Metals spike', text: 'Silver and gold soar. Sell any coins for 3x what you paid.' },
    { type: 'offer', cat: 'land', price: 30000, name: 'Builder wants land', text: 'A home builder offers $30,000 for any land.' },
    { type: 'boom', cat: 'biz', flow: 250, name: 'Town is booming', text: 'Every small business you own earns $250 more each month.' },
    { type: 'boom', cat: 'shedlot', flow: 150, name: 'Backyard storage craze', text: 'Every shed lot and dealership earns $150 more each month.' },
    { type: 'repair', cat: 'estate', amount: 1500, name: 'Burst pipes', text: 'If you own any rental property, pay $1,500 for repairs.' },
    { type: 'repair', cat: 'estate', amount: 800, name: 'Tenant skips out', text: 'If you own any rental property, pay $800 to clean and re-rent.' },
  ];
}

export function splurgeCards() {
  return [
    ['New phone', 900],
    ['Weekend getaway', 1200],
    ['Big-screen TV', 1500],
    ['Dinner out with friends', 160],
    ['Concert tickets', 320],
    ['Golf clubs', 700],
    ['Fishing boat down payment', 3500],
    ['Hot tub', 5000],
    ['Designer sunglasses', 280],
    ['Kids’ sports camp', 600],
    ['Coffee shop habit (this month)', 140],
    ['Lifted truck accessories', 2200],
    ['Theme park trip', 1800],
    ['New gaming console', 550],
  ].map(([name, amount]) => ({ type: 'splurge', name, amount, text: `You just had to have it. Pay $${amount.toLocaleString('en-US')}.` }));
}

export function ventureCards() {
  return [
    { type: 'venture', name: 'Pizza Franchise', cost: 100000, flow: 6000, text: 'Three locations with proven managers.' },
    { type: 'venture', name: 'Shed Manufacturing Plant', cost: 300000, flow: 22000, text: 'A plant building portable buildings for 60 dealers.' },
    { type: 'venture', name: 'Mini-Storage Chain', cost: 250000, flow: 16000, text: 'Six facilities in growing towns.' },
    { type: 'venture', name: 'Apartment Complex (120 units)', cost: 400000, flow: 30000, text: 'A partnership in a big, well-run complex.' },
    { type: 'venture', name: 'Regional Trucking Company', cost: 200000, flow: 12000, text: 'Forty trucks and long-term contracts.' },
    { type: 'venture', name: 'Software Startup', cost: 150000, flow: 8000, text: 'Profitable, small and growing.' },
    { type: 'venture', name: 'Lumber Yard', cost: 180000, flow: 11000, text: 'Supplies every builder in three counties.' },
    { type: 'venture', name: 'Car Dealership', cost: 350000, flow: 25000, text: 'A busy dealership with a strong service department.' },
    { type: 'venture', name: 'Farm Land Lease', cost: 120000, flow: 7000, text: '800 acres leased to a corn and soybean grower.' },
    { type: 'venture', name: 'Strip Mall', cost: 280000, flow: 19000, text: 'Ten shops, all leased.' },
    { type: 'venture', name: 'Medical Office Building', cost: 220000, flow: 14000, text: 'Leased to doctors and a pharmacy.' },
    { type: 'venture', name: 'RV Park', cost: 160000, flow: 9500, text: 'Ninety sites on the river, full every summer.' },
  ];
}

export function setbackCards() {
  return [
    { type: 'setback', name: 'Lawsuit', half: true, text: 'A customer sues and wins. Lose half of your cash.' },
    { type: 'setback', name: 'Tax Audit', half: true, text: 'The audit goes badly. Lose half of your cash.' },
    { type: 'setback', name: 'Health Scare', amount: 60000, text: 'A surgery and a long recovery. Pay $60,000.' },
    { type: 'setback', name: 'Bad Partner', amount: 40000, text: 'A partner cleans out an account. Pay $40,000.' },
    { type: 'setback', name: 'Storm Damage', amount: 30000, text: 'A tornado hits one of your properties. Pay $30,000.' },
  ];
}

export const PLAYER_COLORS = ['#e2453c', '#2f7fe0', '#2fb36a', '#f0b429'];
export const PLAYER_NAMES = ['Red', 'Blue', 'Green', 'Gold'];
