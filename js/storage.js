/* ======================================================================
   storage.js - data model, rates, saving and loading
   All records are kept in the browser's localStorage, so the app works
   fully offline. Each phone/computer keeps its own copy of the data.
   ====================================================================== */

const STORAGE_KEY = 'swd-billing-data-v4';

/* ---------- small helpers used by every file ---------- */
const $ = selector => document.querySelector(selector);

// Escape text before putting it inside HTML (prevents broken pages)
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const round2 = n => Math.round(n * 100) / 100;     // keep money to 2 decimals
const money = n => round2(n).toFixed(2);           // 154 -> "154.00"
const sumOf = (list, pick) => round2(list.reduce((total, item) => total + pick(item), 0));

// Dates are stored as "YYYY-MM-DD" text. Local time is used on purpose:
// toISOString() uses UTC and would give the wrong day in the Philippines.
function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const today = () => toIso(new Date());
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toIso(d);
}
function fmtDate(iso) {                              // "2026-02-05" -> "02/05/26"
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

/* ---------- accounts (demo only: stored in the code, not secure) ---------- */
const DEFAULT_USERS = {
  admin:   { username: 'admin',   password: 'admin123',   name: 'Administrator', role: 'admin' },
  reader:  { username: 'reader',  password: 'reader123',  name: 'Meter Reader',  role: 'reader' },
  teller:  { username: 'teller',  password: 'teller123',  name: 'Teller',       role: 'teller' },
  cashier: { username: 'cashier', password: 'cashier123', name: 'Cashier',      role: 'cashier' }
};
const LEGACY_USERS = {
  admin: { username: 'admin', password: 'admin123' },
  reader: { username: 'reader', password: 'reader123' },
  teller: { username: 'teller', password: 'teller123' },
  cashier: { username: 'cashier', password: 'cashier123' }
};
const USER_STORAGE_KEY = 'swd-billing-users-v1';
const USERS = {};

function loadUsers() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || '{}');
  } catch (e) {
    throw new Error('Could not load user accounts from this device.');
  }
  Object.keys(USERS).forEach(username => delete USERS[username]);
  let migrated = false;
  Object.values(DEFAULT_USERS).forEach(defaultUser => {
    const stored = saved[defaultUser.role];
    const legacy = LEGACY_USERS[defaultUser.role];
    if (stored && stored.username === legacy.username && stored.password === legacy.password) {
      saved[defaultUser.role] = { username: defaultUser.username, password: defaultUser.password };
      migrated = true;
    } else if (stored && typeof stored.password === 'string' && (stored.password.length < 8 || stored.password.length > 10)) {
      const username = typeof stored.username === 'string' && stored.username.trim().length >= 5 && stored.username.trim().length <= 15
        ? stored.username.trim().toLowerCase()
        : defaultUser.username;
      saved[defaultUser.role] = { username, password: defaultUser.password };
      migrated = true;
    }
    const storedUsername = saved[defaultUser.role] && saved[defaultUser.role].username;
    if (typeof storedUsername === 'string' && (storedUsername.trim().length < 5 || storedUsername.trim().length > 15)) {
      saved[defaultUser.role] = {
        ...saved[defaultUser.role],
        username: defaultUser.username
      };
      migrated = true;
    }
    const current = saved[defaultUser.role];
    const username = current && typeof current.username === 'string' ? current.username.trim().toLowerCase() : defaultUser.username;
    const password = current && typeof current.password === 'string' ? current.password : defaultUser.password;
    USERS[username] = { ...defaultUser, username, password };
  });
  if (migrated) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(saved));
}

function saveUsers(accounts) {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(accounts));
    loadUsers();
    return true;
  } catch (e) {
    alert(e.message || 'Could not save user accounts on this device.');
    return false;
  }
}
loadUsers();

/* ---------- the water rate table of the Sindangan Water District ----------
   The minimum charge covers the first 10 cu.m. Every cu.m after that is
   priced by block: 11-20, 21-30, 31-40, 41-50, 51-60, and 61 and above.
   Blank rates (null) were not given by the district yet: the system refuses to
   bill a customer whose consumption reaches a block with no rate. */
const BLOCKS = [
  { label: '11-20',      size: 10 },
  { label: '21-30',      size: 10 },
  { label: '31-40',      size: 10 },
  { label: '41-50',      size: 10 },
  { label: '51-60',      size: 10 },
  { label: '61 & above', size: Infinity }
];
const DEFAULT_CLASS = 'Domestic/Government';

/* The district has 9 zones (one per barangay). The meter reader picks one on the
   Meter Reading screen. To show barangay names instead of numbers, change the
   names in this list, e.g. ['Datu Tangkilan', 'Poblacion', ...]. */
const ZONES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const NO_ZONE = 'none';                                  // customers that have no zone yet
const zoneOf = customer => customer.zone || NO_ZONE;
const zoneLabel = z => z === NO_ZONE ? 'No zone' : 'Zone ' + z;
/* "1", "Zone 1", "zone 1" -> "1". Blank -> ''. Not in the list -> null. */
function normalizeZone(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^(zone|brgy\.?|barangay)\s*/, '');
  if (!t) return '';
  return ZONES.find(z => z.toLowerCase() === t) || null;
}

/* ---------- starting data (fictional customers) ---------- */
const DEFAULT_DATA = {
  customers: [
    { account: '081-102-003', name: 'DELA CRUZ, JUAN', address: 'DATU TANGKILAN, SINDANGAN', meter: '14120293', size: '1/2', classification: 'Domestic/Government', lastReading: 2760, zone: '1' },
    { account: '061-102-347', name: 'SANTOS, MARIA', address: 'SINDANGAN, ZN', meter: '14060207', size: '1/2', classification: 'Domestic/Government', lastReading: 436, zone: '2' },
    { account: '061-102-500', name: 'LIM TRADING', address: 'PUROK 3, SINDANGAN', meter: '14070011', size: '1/2', classification: 'Commercial/Industrial', lastReading: 120, zone: '3' },
    { account: '011-200-100', name: 'REYES, PEDRO', address: 'PUROK 1, ZONE 1', meter: '14200000', size: '1/2', classification: 'Domestic/Government', lastReading: 50, zone: '1' },
    { account: '011-200-101', name: 'GARCIA, ANA', address: 'PUROK 2, ZONE 1', meter: '14200037', size: '1/2', classification: 'Domestic/Government', lastReading: 73, zone: '1' },
    { account: '021-200-102', name: 'MENDOZA, LITO', address: 'PUROK 3, ZONE 2', meter: '14200074', size: '1/2', classification: 'Domestic/Government', lastReading: 96, zone: '2' },
    { account: '031-200-104', name: 'RAMOS, ELENA', address: 'PUROK 5, ZONE 3', meter: '14200148', size: '1/2', classification: 'Domestic/Government', lastReading: 142, zone: '3' },
    { account: '041-200-105', name: 'TAN, WILSON', address: 'PUROK 1, ZONE 4', meter: '14200185', size: '1/2', classification: 'Domestic/Government', lastReading: 165, zone: '4' },
    { account: '041-200-106', name: 'VILLANUEVA, ROSA', address: 'PUROK 2, ZONE 4', meter: '14200222', size: '1/2', classification: 'Domestic/Government', lastReading: 188, zone: '4' },
    { account: '051-200-107', name: 'PACQUIAO, JOEL', address: 'PUROK 3, ZONE 5', meter: '14200259', size: '1/2', classification: 'Domestic/Government', lastReading: 211, zone: '5' },
    { account: '051-200-108', name: 'AQUINO, LINDA', address: 'PUROK 4, ZONE 5', meter: '14200296', size: '1/2', classification: 'Commercial B', lastReading: 234, zone: '5' },
    { account: '061-200-109', name: 'BAUTISTA, CARLO', address: 'PUROK 5, ZONE 6', meter: '14200333', size: '1/2', classification: 'Domestic/Government', lastReading: 257, zone: '6' },
    { account: '061-200-110', name: 'FLORES, NENA', address: 'PUROK 1, ZONE 6', meter: '14200370', size: '1/2', classification: 'Domestic/Government', lastReading: 280, zone: '6' },
    { account: '071-200-111', name: 'NAVARRO, ELMER', address: 'PUROK 2, ZONE 7', meter: '14200407', size: '1/2', classification: 'Domestic/Government', lastReading: 303, zone: '7' },
    { account: '071-200-112', name: 'CASTILLO BAKERY', address: 'PUROK 3, ZONE 7', meter: '14200444', size: '1/2', classification: 'Commercial/Industrial', lastReading: 326, zone: '7' },
    { account: '081-200-113', name: 'DOMINGO, ROMY', address: 'PUROK 4, ZONE 8', meter: '14200481', size: '1/2', classification: 'Domestic/Government', lastReading: 349, zone: '8' },
    { account: '081-200-114', name: 'SALAZAR, GINA', address: 'PUROK 5, ZONE 8', meter: '14200518', size: '1/2', classification: 'Domestic/Government', lastReading: 372, zone: '8' },
    { account: '091-200-115', name: 'OCAMPO, DANTE', address: 'PUROK 1, ZONE 9', meter: '14200555', size: '1/2', classification: 'Domestic/Government', lastReading: 395, zone: '9' },
    { account: '091-200-116', name: 'PEREZ, LUZ', address: 'PUROK 2, ZONE 9', meter: '14200592', size: '1/2', classification: 'Domestic/Government', lastReading: 418, zone: '9' }
  ],
  audit: [],         // who did what, when (append-only, see admin.js)
  staff: {},         // per role: last login, password changed
  loginFails: {},    // wrong-password counter per username
  bills: [],         // generated bills             (billing.js generateBill)
  payments: [],      // payments taken by the teller (billing.js recordPayment)
  remittances: [],   // teller turns collections over to the cashier
  deposits: [],      // cashier deposits the collections in the bank
  config: {
    minimumCubicMeters: 10,      // cu.m covered by the minimum charge
    dueDays: 20,                 // days from reading date to due date
    disconnectionDays: 28,       // days from reading date to disconnection date
    nextBill: 112, nextReceipt: 1, nextRemittance: 1, nextDeposit: 1,
    rates: [
      { classification: 'Domestic/Government',  minimum: 154,    blocks: [16.5, 17.9, 19.5, null, null, null],    latePercent: 10 },
      { classification: 'Commercial/Industrial', minimum: 308,    blocks: [33, 35.8, 39, null, null, null],        latePercent: 10 },
      { classification: 'Commercial A',          minimum: 269.5,  blocks: [28.85, 31.3, 34.1, null, null, null],   latePercent: 10 },
      { classification: 'Commercial B',          minimum: 231,    blocks: [24.75, 26.85, 29.25, null, null, null], latePercent: 10 },
      { classification: 'Commercial C',          minimum: 192.5,  blocks: [20.63, 22.38, 25.3, null, null, null],  latePercent: 10 },
      { classification: 'Commercial D',          minimum: null,   blocks: [null, null, null, null, null, null],    latePercent: 10 },
      { classification: 'Bulk Sales',            minimum: null,   blocks: [null, null, null, null, null, null],    latePercent: 10 }
    ]
  }
};

/* Data saved before zones existed: every customer without a zone goes to Zone 1,
   and the old bills take the zone of their customer. */
function fixOldData(data) {
  if (!Array.isArray(data.audit)) data.audit = [];
  if (!data.staff || typeof data.staff !== 'object') data.staff = {};
  if (!data.loginFails || typeof data.loginFails !== 'object') data.loginFails = {};
  data.customers = (data.customers || []).filter(c => c.account !== '021-200-103');
  (data.customers || []).forEach(c => { if (!c.zone) c.zone = '1'; });
  (data.bills || []).forEach(b => {
    if (!b.zone) { const c = data.customers.find(x => x.account === b.account); b.zone = c ? c.zone : ''; }
  });
  return data;
}

/* ---------- load / save ---------- */
let DATA = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return fixOldData(JSON.parse(raw));
  } catch (e) { /* storage blocked or corrupted: start fresh */ }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA));
  } catch (e) {
    alert('Could not save the data on this device.');
  }
}

/* ---------- audit log: one line for every important action ----------
   Append-only: no screen can edit or delete it. Kept to the latest 5,000 lines
   (export it as CSV from Settings > Audit Log to keep older ones). */
function audit(action, target = '', detail = '', ok = true, actor, role) {
  if (!DATA) return;
  DATA.audit.push({
    id: Date.now().toString(36) + DATA.audit.length,
    ts: new Date().toISOString(),
    user: actor || (typeof user !== 'undefined' && user ? (user.username || user.role) : 'anonymous'),
    role: role || (typeof user !== 'undefined' && user ? user.role : '-'),
    action, target: String(target), detail: String(detail), ok
  });
  if (DATA.audit.length > 5000) DATA.audit.splice(0, DATA.audit.length - 5000);
  saveData();
}

/* ---------- backup and restore (downloads a .json file) ---------- */
function downloadBackup() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'swd-backup-' + today() + '.json';
  link.click();
  audit('BACKUP DOWNLOADED', 'JSON file');
}

function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const ok = ['customers', 'bills', 'payments', 'remittances', 'deposits', 'config'].every(k => data[k]);
      if (!ok || !data.config.rates) throw new Error('bad file');
      if (!confirm('Replace all data on this device with the backup?')) return;
      DATA = fixOldData(data);
      saveData();
      audit('BACKUP RESTORED', 'JSON file');
      render();
    } catch (e) {
      alert('That is not a valid backup file.');
    }
  };
  reader.readAsText(file);
}
