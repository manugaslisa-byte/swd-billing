/* ======================================================================
   printer.js - what gets printed, and how it is sent to the printer
   1. billText / receiptText : the text of the bill and receipt, 32 characters
      per line (fits a 58 mm thermal printer roll).
   2. connectPrinter / printBluetooth : sends the text to a Bluetooth Low
      Energy ESC/POS printer using the browser's Web Bluetooth feature.
   3. printBrowser : fallback using the normal browser print dialog.
   Web Bluetooth needs Chrome and HTTPS (or localhost). iPhone/Safari does not
   support it.
   ====================================================================== */

const LINE = 32;
const center = text => ' '.repeat(Math.max(0, Math.floor((LINE - text.length) / 2))) + text;
const row = (left, right) => left + ' '.repeat(Math.max(1, LINE - String(left).length - String(right).length)) + right;
const rule = '-'.repeat(LINE);
const wrap = text => text.replace(/(.{1,32})(\s+|$)/g, '$1\n').trim();   // wrap long names

/* The printed bill follows the layout of the district's Billing Notice. */
function billText(bill) {
  const c = customerOf(bill.account);
  const cfg = DATA.config;
  const minimum = Math.min(bill.amount, bill.minimumCharge);
  const excess = round2(bill.amount - minimum);
  const lines = [
    center('SINDANGAN WATER DISTRICT'),
    center('Provincial Road, Magsaysay,'),
    center('Sindangan, Zamboanga del Norte'),
    center('(65) 224-2324 | NON-VAT'),
    center('TIN 004-315-466-00000'),
    rule,
    center('BILLING NOTICE'),
    center('No. ' + bill.no),
    rule,
    wrap('NAME: ' + c.name),
    wrap('ADDR: ' + c.address),
    'ACCOUNT NO.: ' + bill.account,
    'METER NO.: ' + c.meter,
    wrap('CLASS: ' + bill.classification),
    'PERIOD COVERED:',
    fmtDate(bill.periodFrom) + ' TO ' + fmtDate(bill.readingDate),
    rule,
    'COMPUTATION:',
    row('READING DATE:', fmtDate(bill.readingDate)),
    row('PRESENT READING:', bill.present),
    row('PREVIOUS READING:', bill.previous),
    rule,
    row('AMOUNT:', money(bill.amount)),
    row('Minimum:', money(minimum))
  ];
  if (excess > 0) {
    lines.push(row('Excess (' + Math.max(0, bill.consumption - cfg.minimumCubicMeters) + ' cu.m):', money(excess)));
  }
  lines.push(
    row('ADJUSTMENT:', '0.00'),
    row('ARREARS:', money(bill.arrears)),
    'OTHERS:',
    rule,
    row('TOTAL:', money(bill.total)),
    rule,
    row('DUE DATE:', fmtDate(bill.dueDate)),
    row('DISCONNECTION DATE:', fmtDate(bill.disconnectionDate)),
    row('CONSUMPTION (cu.m.):', bill.consumption),
    rule,
    'AMOUNT DUE IF PAID',
    row('ON OR BEFORE DUE DATE:', money(bill.total)),
    'AMOUNT DUE IF PAID',
    row('AFTER DUE DATE:', money(bill.totalAfterDue)),
    rule,
    'This document is not valid for',
    'claim of input tax.',
    'Read by: ' + bill.readBy,
    'Pay at the SWD Office only.'
  );
  return lines.join('\n');
}

function receiptText(payment) {
  const bill = DATA.bills.find(b => b.no === payment.billNo);
  const c = customerOf(payment.account);
  const when = new Date(payment.date).toLocaleString('en-US');
  return [
    center('SINDANGAN WATER DISTRICT'),
    center('OFFICIAL RECEIPT'),
    rule,
    'OR No: ' + payment.or,
    'Date: ' + when,
    'Received from:',
    wrap(c.name),
    'Account: ' + payment.account,
    'Bill No: ' + payment.billNo,
    rule,
    row('Current billing', money(bill.amount)),
    row('Arrears', money(bill.arrears)),
    row('Amount due', money(payment.amountDue)),
    row('Amount paid', money(payment.amountPaid)),
    row('Tendered', money(payment.tendered)),
    row('Change', money(payment.change)),
    row('Balance', money(payment.balance)),
    rule,
    'Teller: ' + payment.teller,
    center('Thank you!')
  ].join('\n');
}

/* The preview box + the three print buttons shown under a bill or receipt */
function printCard(text) {
  return `<div class="card"><h3>Print preview (58 mm)</h3>
    <pre id="pt">${esc(text)}</pre>
    <button class="p" onclick="printBluetooth()">Print via Bluetooth</button>
    <button class="s" onclick="connectPrinter()">Connect printer</button>
    <button class="s" onclick="printBrowser()">Browser print</button>
    <span id="ps" class="mut"></span></div>`;
}

/* ---------- Bluetooth (BLE) ---------- */
let printerChannel = null;     // the writable "characteristic" of the printer

// Common service IDs used by cheap 58 mm BLE thermal printers
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455'
];

function bluetoothReady() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth is not available here.\nUse Chrome on Android over HTTPS, or use "Browser print".');
    return false;
  }
  return true;
}

async function connectPrinter() {
  if (!bluetoothReady()) return;
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    const server = await device.gatt.connect();
    for (const service of await server.getPrimaryServices()) {
      for (const channel of await service.getCharacteristics()) {
        if (channel.properties.write || channel.properties.writeWithoutResponse) {
          printerChannel = channel;
          $('#ps').textContent = 'Connected: ' + device.name;
          return;
        }
      }
    }
    throw new Error('No writable printer channel found');
  } catch (e) {
    alert('Printer: ' + e.message);
  }
}

// ESC/POS: "ESC @" resets the printer, then the plain text, then blank lines
async function printBluetooth() {
  if (!bluetoothReady()) return;
  if (!printerChannel) await connectPrinter();
  if (!printerChannel) return;
  const bytes = new TextEncoder().encode('\x1b@' + $('#pt').textContent + '\n\n\n\n');
  for (let i = 0; i < bytes.length; i += 100) {            // BLE accepts small blocks
    const block = bytes.slice(i, i + 100);
    if (printerChannel.properties.writeWithoutResponse) await printerChannel.writeValueWithoutResponse(block);
    else await printerChannel.writeValue(block);
  }
  $('#ps').textContent = 'Printed.';
}

function printBrowser() {
  const win = window.open('', '_blank');
  if (!win) { alert('Allow pop-ups to print.'); return; }
  win.document.write('<pre style="font:12px monospace;width:58mm">' + esc($('#pt').textContent) + '</pre>');
  win.document.close();
  win.print();
}
