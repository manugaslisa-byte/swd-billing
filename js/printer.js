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
const formatBillingMonth = bill => {
  const month = (bill.billingMonth || bill.readingDate || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month)
    ? new Date(month + '-01T00:00:00').toLocaleDateString('en', { month: 'long', year: 'numeric' })
    : month;
};

/* The printed bill follows the layout of the district's Billing Notice. */
function billText(bill) {
  if (!bill || !hasMeterReading(bill.previous)) {
    throw new Error('Cannot print this bill: a valid previous meter reading is missing.');
  }
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
    wrap('ADDR: ' + displayAddress(c.address)),
    'ACCOUNT NO.: ' + bill.account,
    'METER NO.: ' + c.meter,
    wrap('CLASS: ' + bill.classification),
    'BILLING MONTH: ' + formatBillingMonth(bill),
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
    'Billing month: ' + formatBillingMonth(bill),
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
    <p class="printer-status mut" role="status" aria-live="polite"></p>
    <details class="printer-help">
      <summary>How to connect a Bluetooth printer</summary>
      <ol>
        <li>Turn on the printer, load paper, and enable its Bluetooth/pairing mode.</li>
        <li>Use Chrome or Microsoft Edge on a device with Bluetooth. Bluetooth printing needs a secure connection (HTTPS or localhost); it may not work when this app is opened as a local file.</li>
        <li>Select <b>Connect printer</b>, choose the printer in the browser's device chooser, then press <b>Pair</b> or <b>Connect</b> if prompted.</li>
        <li>When the status says connected, select <b>Print via Bluetooth</b>.</li>
      </ol>
      <p class="mut">If the chooser is cancelled or the printer is missing, close it, check power/pairing mode and browser support, then try Connect printer again. Use Browser print as an alternative.</p>
    </details></div>`;
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
    setPrinterStatus('Bluetooth is not available in this browser or page. Use Chrome or Edge over HTTPS/localhost, or choose Browser print.', true);
    return false;
  }
  return true;
}

function setPrinterStatus(message, isError = false) {
  document.querySelectorAll('.printer-status').forEach(status => {
    status.textContent = message;
    status.classList.toggle('form-error', isError);
    status.classList.toggle('mut', !isError);
  });
}

async function connectPrinter() {
  if (!bluetoothReady()) return false;
  try {
    setPrinterStatus('Choose your printer in the browser Bluetooth window. Make sure the printer is on and in pairing mode.');
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    const server = await device.gatt.connect();
    for (const service of await server.getPrimaryServices()) {
      for (const channel of await service.getCharacteristics()) {
        if (channel.properties.write || channel.properties.writeWithoutResponse) {
          printerChannel = channel;
          setPrinterStatus('Connected: ' + (device.name || 'Bluetooth printer') + '. Select Print via Bluetooth.');
          return true;
        }
      }
    }
    throw new Error('No writable printer channel found');
  } catch (e) {
    if (e.name === 'NotFoundError' || /cancel(l)?ed/i.test(e.message)) {
      setPrinterStatus('Printer selection was cancelled. No printer was connected. Select Connect printer and choose a device, or open How to connect a Bluetooth printer.');
      return false;
    }
    setPrinterStatus('Could not connect to the printer: ' + e.message + ' Check that it is on, nearby, in pairing mode, and supported by this browser.', true);
    return false;
  }
}

// ESC/POS: "ESC @" resets the printer, then the plain text, then blank lines
async function printBluetooth() {
  if (!bluetoothReady()) return;
  if (!printerChannel) await connectPrinter();
  if (!printerChannel) return;
  const preview = document.querySelector('#pt');
  if (!preview) {
    setPrinterStatus('No bill or receipt is available to print.', true);
    return;
  }
  try {
    const bytes = new TextEncoder().encode('\x1b@' + preview.textContent + '\n\n\n\n');
    for (let i = 0; i < bytes.length; i += 100) {            // BLE accepts small blocks
      const block = bytes.slice(i, i + 100);
      if (printerChannel.properties.writeWithoutResponse) await printerChannel.writeValueWithoutResponse(block);
      else await printerChannel.writeValue(block);
    }
    setPrinterStatus('Printed via Bluetooth.');
  } catch (e) {
    printerChannel = null;
    setPrinterStatus('Could not print: ' + e.message + ' Reconnect the printer and try again.', true);
  }
}

function printBrowser() {
  const win = window.open('', '_blank');
  if (!win) { appAlert('Allow pop-ups to print.', 'Unable to print'); return; }
  win.document.write('<pre style="font:12px monospace;width:58mm">' + esc($('#pt').textContent) + '</pre>');
  win.document.close();
  win.print();
}

/* ---------- full-page printouts (reports, slips) ----------
   Uses the normal browser print dialog: choose a printer, or "Save as PDF". */
function printDoc(title, bodyHtml) {
  let area = document.getElementById('printArea');
  if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `<h1>Sindangan Water District</h1><h2>${esc(title)}</h2>
    <p class="meta">Printed ${new Date().toLocaleString('en-PH')} by ${esc(user ? user.name : '')}</p>${bodyHtml}`;
  const clear = () => { area.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  window.print();
}

/* a plain table for printouts: head = ['A','B'], rows = [[..],[..]], foot = totals row (optional) */
function printTable(head, rows, foot) {
  const line = (cells, tag) => '<tr>' + cells.map(c => `<${tag}>${esc(c)}</${tag}>`).join('') + '</tr>';
  return `<table class="pt">${line(head, 'th')}${rows.map(r => line(r, 'td')).join('') || `<tr><td colspan="${head.length}">Nothing to show.</td></tr>`}${foot ? line(foot, 'th') : ''}</table>`;
}
