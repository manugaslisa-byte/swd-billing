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
const USERS = {
  admin:   { password: 'admin123',   name: 'Administrator', role: 'admin' },
  reader:  { password: 'reader123',  name: 'Meter Reader',  role: 'reader' },
  teller:  { password: 'teller123',  name: 'Teller',        role: 'teller' },
  cashier: { password: 'cashier123', name: 'Cashier',       role: 'cashier' }
};
const ROLE_NAMES = { reader: 'Meter Reader', teller: 'Teller', cashier: 'Cashier', admin: 'Administrator' };

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

/* ---------- starting data (fictional customers) ---------- */
const DEFAULT_DATA = {
  customers: [
    { account: '081-102-003', name: 'DELA CRUZ, JUAN', address: 'DATU TANGKILAN, SINDANGAN', meter: '14120293', size: '1/2', classification: 'Domestic/Government', lastReading: 2760 },
    { account: '061-102-347', name: 'SANTOS, MARIA',   address: 'SINDANGAN, ZN',             meter: '14060207', size: '1/2', classification: 'Domestic/Government', lastReading: 436 },
    { account: '061-102-500', name: 'LIM TRADING',     address: 'PUROK 3, SINDANGAN',        meter: '14070011', size: '3/4', classification: 'Commercial/Industrial', lastReading: 120 }
  ],
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

/* ---------- load / save ---------- */
let DATA = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
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

/* ---------- backup and restore (downloads a .json file) ---------- */
function downloadBackup() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'swd-backup-' + today() + '.json';
  link.click();
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
      DATA = data;
      saveData();
      render();
    } catch (e) {
      alert('That is not a valid backup file.');
    }
  };
  reader.readAsText(file);
}
