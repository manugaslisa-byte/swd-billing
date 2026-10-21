/* ======================================================================
   views.js - the screens
   Each screen is a function that returns HTML text. app.js puts that HTML
   on the page. Buttons call the functions in this file (onclick="...").
   Screen state (user, selected, lastBill ...) lives in app.js.
   Screens: Dashboard, Customers, Meter Reading, Payments (teller),
            Turn Over (teller), Deposits (cashier), Records, Settings.
   ====================================================================== */

const VIEWS = {};

/* A list of customers the user can pick from while typing */
const customerDatalist = () =>
  `<datalist id="cl">${DATA.customers.map(c => `<option value="${esc(c.account)}">${esc(c.name)}</option>`).join('')}</datalist>`;

const classOptions = chosen =>
  DATA.config.rates.map(r => `<option ${r.classification === chosen ? 'selected' : ''}>${esc(r.classification)}</option>`).join('');

const miniButton = (label, onclick) =>
  `<button class="s" style="margin:0;padding:4px 8px" onclick="${onclick}">${label}</button>`;

/* ---------------------------------------------------------------- Dashboard */
VIEWS.dash = () => {
  const open = DATA.bills.filter(isOpen);
  const outstanding = sumOf(open, b => amountDueOn(b));
  const collected = sumOf(DATA.payments, p => p.amountPaid);
  const toTurnOver = sumOf(DATA.payments.filter(p => !p.remittanceId), p => p.amountPaid);
  const forDeposit = sumOf(DATA.remittances.filter(r => r.status !== 'Deposited'), r => r.status === 'Received' ? r.counted : r.total);
  const box = (value, label) => `<div class="st"><b>${value}</b><span>${label}</span></div>`;
  return `<div class="g">
      ${box(DATA.customers.length, 'Customers')}
      ${box(DATA.bills.length, 'Bills generated')}
      ${box(open.length, 'Outstanding bills')}
      ${box(money(outstanding), 'Outstanding (PHP)')}
      ${box(money(collected), 'Collected (PHP)')}
      ${box(money(toTurnOver), 'With teller, not turned over')}
      ${box(money(forDeposit), 'With cashier, not deposited')}
    </div>
    <div class="card" style="margin-top:14px"><h3>Workflow</h3>
      <p><b>1.</b> The meter reader reads the meter, generates the bill, and prints it on site.<br>
      <b>2.</b> The customer pays the <b>teller</b> at the district office.<br>
      <b>3.</b> The teller turns the collections over to the <b>cashier</b>.<br>
      <b>4.</b> The cashier counts the cash and deposits it in the bank.<br>
      Meter readers and cashiers never take a customer's payment.</p></div>`;
};

/* ---------------------------------------------------------------- Customers */
function customerRows(query = '') {
  const q = query.toLowerCase();
  return DATA.customers
    .filter(c => (c.account + c.name).toLowerCase().includes(q))
    .slice(0, 300)                                     // keep the screen fast
    .map(c => `<tr><td>${esc(c.account)}</td><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${esc(c.meter)}</td><td>${esc(c.classification)}</td><td>${c.lastReading}</td></tr>`)
    .join('');
}

function addCustomerCard() {
  return `<div class="card"><h3>Add customer</h3><div class="g">
      <label>Account no.<input id="a1" placeholder="081-102-003"></label>
      <label>Name<input id="a2" placeholder="LAST, FIRST"></label>
      <label>Service address<input id="a3"></label>
      <label>Meter no.<input id="a4"></label>
      <label>Meter size<input id="a5" value="1/2"></label>
      <label>Classification<select id="a7">${classOptions(DEFAULT_CLASS)}</select></label>
      <label>Initial reading<input id="a6" type="number" value="0"></label>
    </div><button class="p" onclick="addCustomer()">Save customer</button></div>`;
}

function uploadCard() {
  const p = importPreview;
  const preview = p ? `
      <p>Ready: <b>${p.newCount}</b> new, <b>${p.existingCount}</b> already exist, <b>${p.invalid.length}</b> with problems.</p>
      ${p.invalid.slice(0, 5).map(b => `<p class="mut">Row ${b.rowNo}: ${esc(b.reason)}</p>`).join('')}
      <button class="p" onclick="applyImport()">Import now</button>
      <button class="s" onclick="importPreview=null;render()">Cancel</button>` : '';
  return `<div class="card"><h3>Upload many customers (CSV)</h3>
      <p class="mut">Columns: account no., name, address, meter no., meter size, last reading, classification
      (blank = Domestic/Government). In Excel use Save As, then CSV. Format the columns as Text first so Excel does not turn 1/2 into a date.</p>
      <button class="s" onclick="downloadTemplate()">Download template</button>
      <label>CSV file<input type="file" accept=".csv,text/csv" onchange="readCustomerFile(this.files[0])"></label>
      <label><input type="checkbox" ${importUpdateExisting ? 'checked' : ''} onchange="importUpdateExisting=this.checked">Update customers that already exist</label>
      ${preview}</div>`;
}

VIEWS.customers = () => `
  ${user.role === 'admin' ? addCustomerCard() + uploadCard() : ''}
  <div class="card"><h3>Customer records (${DATA.customers.length})</h3>
    <input placeholder="Search name or account" oninput="$('#custRows').innerHTML = customerRows(this.value)">
    <div class="tw"><table><tr><th>Account</th><th>Name</th><th>Address</th><th>Meter</th><th>Class</th><th>Last reading</th></tr>
    <tbody id="custRows">${customerRows()}</tbody></table></div></div>`;

function addCustomer() {
  const v = [1, 2, 3, 4, 5, 6, 7].map(i => $('#a' + i).value.trim());
  const [account, name, address, meter, size, reading, classification] = v;
  if (!account || !name || !meter) return alert('Account no., name and meter no. are required.');
  if (customerOf(account)) return alert('That account number already exists.');
  DATA.customers.push({ account, name: name.toUpperCase(), address: address.toUpperCase(), meter, size: size || '1/2', classification, lastReading: Number(reading) || 0 });
  saveData();
  render();
}

/* ------------------------------------------------------------ Meter reading */
VIEWS.read = () => {
  const c = selected && customerOf(selected);
  const form = c ? `
      <p><b>${esc(c.name)}</b> <span class="tag">${esc(c.classification)}</span><br>${esc(c.address)}<br>
      Meter ${esc(c.meter)} | Previous reading: <b>${c.lastReading}</b></p>
      <label>Present reading<input id="pr" type="number" min="0" inputmode="numeric" oninput="previewAmount()"></label>
      <label>Reading date<input id="rd" type="date" value="${today()}"></label>
      <label>Remarks (optional)<input id="rm"></label>
      <p id="pv" class="mut"></p>
      <button class="p" onclick="submitReading()">Generate bill</button>` : '';
  return `<div class="card"><h3>Meter reading</h3>
      <input list="cl" placeholder="Account no. or name" onchange="selectCustomer(this.value)" value="${c ? esc(c.account) : ''}">
      ${customerDatalist()}${form}</div>
      ${lastBill ? printCard(billText(lastBill)) : ''}
      ${c ? readingCard(c) : ''}`;
};

/* The digital version of the paper Meter Reading Card (Form BC-15) */
function readingCard(c) {
  const rows = DATA.bills.filter(b => b.account === c.account).slice(-12).reverse()
    .map(b => `<tr><td>${fmtDate(b.readingDate)}</td><td>${b.present}</td><td>${b.consumption}</td><td>${money(b.amount)}</td><td>${esc(b.remarks || '')}</td><td>${esc(b.readBy)}</td></tr>`).join('');
  return `<div class="card"><h3>Meter reading card</h3>
      <div class="tw"><table><tr><th>Date</th><th>Reading</th><th>Cu.m</th><th>Amount</th><th>Remarks</th><th>Read by</th></tr>
      ${rows || '<tr><td colspan="6" class="mut">No readings yet.</td></tr>'}</table></div></div>`;
}

function selectCustomer(text) {
  const t = text.trim().toLowerCase();
  const c = DATA.customers.find(x => x.account.toLowerCase() === t || x.name.toLowerCase() === t);
  if (!c) alert('Customer not found.');
  selected = c ? c.account : null;
  lastBill = null;
  lastReceipt = null;
  render();
}

// Shows consumption and amount while the reader is still typing
function previewAmount() {
  const c = customerOf(selected);
  const value = $('#pr').value;
  if (value === '') { $('#pv').textContent = ''; return; }
  const consumption = Math.max(0, Number(value) - c.lastReading);
  try {
    $('#pv').innerHTML = `Consumption <b>${consumption} cu.m</b> | Amount <b>PHP ${money(computeAmount(consumption, c.classification))}</b> (before any arrears)`;
  } catch (e) {
    $('#pv').innerHTML = `<span class="Unpaid">${esc(e.message)}</span>`;
  }
}

function submitReading() {
  const c = customerOf(selected);
  const raw = $('#pr').value;
  const present = raw === '' ? NaN : Number(raw);
  let allowLower = false;
  if (raw !== '' && present < c.lastReading) {
    if (!confirm('Present reading is lower than the previous one. Continue (meter replaced or reset)?')) return;
    allowLower = true;
  }
  try {
    lastBill = generateBill({ account: selected, present, readingDate: $('#rd').value, allowLower, readBy: user.name, remarks: $('#rm').value.trim() });
    render();
  } catch (e) { alert(e.message); }
}

/* ------------------------------------------------- Payments (the teller) */
VIEWS.pay = () => {
  const c = selected && customerOf(selected);
  const bill = c && openBillOf(c.account);
  let body = '';
  if (c && !bill) body = `<p>${esc(c.name)} has no outstanding bill.</p>`;
  if (c && bill) {
    const late = today() > bill.dueDate ? ` + ${bill.latePercent}% late charge` : '';
    body = `<p><b>${esc(c.name)}</b><br>Bill ${bill.no} | Due ${fmtDate(bill.dueDate)}</p>
      <div class="mut">Amount due today</div><div class="big">PHP ${money(amountDueOn(bill))}</div>
      <p class="mut">Current ${money(bill.amount)} + arrears ${money(bill.arrears)}${late}</p>
      <label>Amount tendered<input id="tn" type="number" step="0.01" inputmode="decimal"></label>
      <button class="p" onclick="submitPayment()">Record payment and receipt</button>`;
  }
  return `<div class="card"><h3>Record payment (teller)</h3>
      <input list="cl" placeholder="Account no. or name" onchange="selectCustomer(this.value)" value="${c ? esc(c.account) : ''}">
      ${customerDatalist()}${body}</div>
      ${lastReceipt ? printCard(receiptText(lastReceipt)) : ''}`;
};

function submitPayment() {
  try {
    lastReceipt = recordPayment({ account: selected, tendered: Number($('#tn').value), teller: user.name });
    render();
  } catch (e) { alert(e.message); }
}

/* ------------------------------- Turn over collections (teller -> cashier) */
VIEWS.turnover = () => {
  const mine = uncollectedBy(user.name);
  const rows = mine.map(p => `<tr><td>${p.or}</td><td>${esc(p.account)}</td><td>${fmtDate(p.date)}</td><td>${money(p.amountPaid)}</td></tr>`).join('');
  const history = [...DATA.remittances].reverse().filter(r => r.teller === user.name).slice(0, 30)
    .map(r => `<tr><td>${r.id}</td><td>${fmtDate(r.date)}</td><td>${r.receipts.length}</td><td>${money(r.total)}</td><td>${r.counted == null ? '' : money(r.counted)}</td><td class="${r.status}">${r.status}</td></tr>`).join('');
  return `<div class="card"><h3>Collections to turn over to the cashier</h3>
      <div class="tw"><table><tr><th>OR</th><th>Account</th><th>Date</th><th>Amount</th></tr>
      ${rows || '<tr><td colspan="4" class="mut">Nothing to turn over.</td></tr>'}</table></div>
      <p>Total: <span class="big">PHP ${money(sumOf(mine, p => p.amountPaid))}</span></p>
      ${mine.length ? '<button class="p" onclick="submitTurnover()">Turn over to cashier</button>' : ''}</div>
    <div class="card"><h3>My turn-overs</h3><div class="tw"><table>
      <tr><th>No.</th><th>Date</th><th>Receipts</th><th>Total</th><th>Counted</th><th>Status</th></tr>
      ${history || '<tr><td colspan="6" class="mut">None yet.</td></tr>'}</table></div></div>`;
};

function submitTurnover() {
  try {
    const r = turnOverCollections(user.name);
    render();
    alert(`Turned over PHP ${money(r.total)} (${r.receipts.length} receipts) to the cashier. Turn-over no. ${r.id}.`);
  } catch (e) { alert(e.message); }
}

/* --------------------------------- Receive and deposit (the cashier) */
VIEWS.deposit = () => {
  const pending = DATA.remittances.filter(r => r.status === 'Pending');
  const received = DATA.remittances.filter(r => r.status === 'Received');
  const pendingRows = pending.map(r => `<tr><td>${r.id}</td><td>${esc(r.teller)}</td><td>${fmtDate(r.date)}</td><td>${r.receipts.length}</td><td>${money(r.total)}</td>
      <td><input id="cnt-${r.id}" type="number" step="0.01" value="${r.total}"></td>
      <td><button class="p" style="margin:0;padding:6px 10px" onclick="submitReceive('${r.id}')">Receive</button></td></tr>`).join('');
  const receivedRows = received.map(r => `<tr><td>${r.id}</td><td>${esc(r.teller)}</td><td>${money(r.total)}</td><td>${money(r.counted)}</td><td>${money(r.counted - r.total)}</td></tr>`).join('');
  const depositRows = [...DATA.deposits].reverse().slice(0, 30)
    .map(d => `<tr><td>${d.id}</td><td>${fmtDate(d.date)}</td><td>${esc(d.bank)}</td><td>${esc(d.reference)}</td><td>${d.remittanceIds.length}</td><td>${money(d.amount)}</td></tr>`).join('');
  return `<div class="card"><h3>1. Receive cash from tellers</h3><div class="tw"><table>
      <tr><th>No.</th><th>Teller</th><th>Date</th><th>Receipts</th><th>Total</th><th>Counted</th><th></th></tr>
      ${pendingRows || '<tr><td colspan="7" class="mut">No turn-overs waiting.</td></tr>'}</table></div></div>
    <div class="card"><h3>2. Deposit in the bank</h3><div class="tw"><table>
      <tr><th>No.</th><th>Teller</th><th>Total</th><th>Counted</th><th>Variance</th></tr>
      ${receivedRows || '<tr><td colspan="5" class="mut">Nothing received yet.</td></tr>'}</table></div>
      <p>To deposit: <span class="big">PHP ${money(sumOf(received, r => r.counted))}</span></p>
      ${received.length ? `<label>Bank<input id="bk" placeholder="Bank name"></label>
        <label>Deposit slip no.<input id="bs"></label>
        <button class="p" onclick="submitDeposit()">Record deposit</button>` : ''}</div>
    <div class="card"><h3>Deposit history</h3><div class="tw"><table>
      <tr><th>No.</th><th>Date</th><th>Bank</th><th>Slip no.</th><th>Turn-overs</th><th>Amount</th></tr>
      ${depositRows || '<tr><td colspan="6" class="mut">No deposits yet.</td></tr>'}</table></div></div>`;
};

function submitReceive(id) {
  try { receiveRemittance(id, Number($('#cnt-' + id).value), user.name); render(); }
  catch (e) { alert(e.message); }
}

function submitDeposit() {
  try {
    const d = recordDeposit({ bank: $('#bk').value.trim(), reference: $('#bs').value.trim(), cashier: user.name });
    render();
    alert(`Deposit no. ${d.id} recorded: PHP ${money(d.amount)}.`);
  } catch (e) { alert(e.message); }
}

/* ------------------------------------------------------------------ Records */
function recordRows(query = '') {
  const q = query.toLowerCase();
  const nameOf = account => (customerOf(account) || { name: '' }).name;
  if (recordsTab === 'bills') {
    return [...DATA.bills].reverse()
      .filter(b => (b.account + nameOf(b.account)).toLowerCase().includes(q))
      .slice(0, 300)
      .map(b => `<tr><td>${b.no}</td><td>${esc(b.account)}</td><td>${fmtDate(b.readingDate)}</td><td>${b.consumption}</td><td>${money(b.total)}</td>
        <td class="${b.status}">${b.status}</td><td>${miniButton('Reprint', `reprintBill('${b.no}')`)}</td></tr>`).join('');
  }
  return [...DATA.payments].reverse()
    .filter(p => (p.account + nameOf(p.account)).toLowerCase().includes(q))
    .slice(0, 300)
    .map(p => `<tr><td>${p.or}</td><td>${esc(p.account)}</td><td>${fmtDate(p.date)}</td><td>${money(p.amountPaid)}</td><td>${money(p.balance)}</td>
      <td>${esc(p.teller)}</td><td>${miniButton('Reprint', `reprintReceipt('${p.or}')`)}</td></tr>`).join('');
}

VIEWS.records = () => {
  const head = recordsTab === 'bills'
    ? '<tr><th>Bill</th><th>Account</th><th>Date</th><th>Cu.m</th><th>Total</th><th>Status</th><th></th></tr>'
    : '<tr><th>OR</th><th>Account</th><th>Date</th><th>Paid</th><th>Balance</th><th>Teller</th><th></th></tr>';
  return `${reprintText ? printCard(reprintText) : ''}
    <div class="card"><h3>Records</h3>
      <button class="${recordsTab === 'bills' ? 'p' : 's'}" onclick="setRecordsTab('bills')">Bills</button>
      <button class="${recordsTab === 'payments' ? 'p' : 's'}" onclick="setRecordsTab('payments')">Payments</button>
      <input style="margin-top:10px" placeholder="Search account or name" oninput="$('#recRows').innerHTML = recordRows(this.value)">
      <div class="tw"><table>${head}<tbody id="recRows">${recordRows()}</tbody></table></div></div>`;
};

function setRecordsTab(name) { recordsTab = name; render(); }
function reprintBill(no) { reprintText = billText(DATA.bills.find(b => b.no === no)); render(); window.scrollTo(0, 0); }
function reprintReceipt(or) { reprintText = receiptText(DATA.payments.find(p => p.or === or)); render(); window.scrollTo(0, 0); }

/* ----------------------------------------------------------------- Settings */
const rateInput = (id, value) => `<input id="${id}" type="number" step="0.01" min="0" value="${value == null ? '' : value}">`;

VIEWS.settings = () => {
  const k = DATA.config;
  const head = `<tr><th>Classification</th><th>Minimum</th>${BLOCKS.map(b => `<th>${b.label} cu.m</th>`).join('')}<th>Late %</th></tr>`;
  const rows = k.rates.map((r, i) => `<tr><td>${esc(r.classification)}</td><td>${rateInput('m' + i, r.minimum)}</td>
      ${r.blocks.map((v, j) => `<td>${rateInput(`b${i}_${j}`, v)}</td>`).join('')}<td>${rateInput('l' + i, r.latePercent)}</td></tr>`).join('');
  return `<div class="card"><h3>Water rates (per classification)</h3>
      <p class="mut">Rates of the Sindangan Water District. The minimum charge covers the first
      ${k.minimumCubicMeters} cu.m; each block is the price per cu.m inside that block.
      A blank cell means the rate is not set yet, and a bill cannot reach that block until it is entered.</p>
      <div class="tw"><table>${head}${rows}</table></div>
      <div class="g" style="margin-top:10px">
        <label>Minimum covers (cu.m)<input id="s2" type="number" value="${k.minimumCubicMeters}"></label>
        <label>Due after (days)<input id="s4" type="number" value="${k.dueDays}"></label>
        <label>Disconnection after (days)<input id="s5" type="number" value="${k.disconnectionDays}"></label>
      </div><button class="p" onclick="saveSettings()">Save rates</button></div>
    <div class="card"><h3>Backup (this device)</h3>
      <p class="mut">Records are stored on this device. Download a backup regularly, because clearing the browser data erases them.</p>
      <button class="s" onclick="downloadBackup()">Download backup</button>
      <label>Restore from backup file<input type="file" accept=".json" onchange="restoreBackup(this.files[0])"></label></div>`;
};

function saveSettings() {
  const k = DATA.config;
  const num = id => { const v = $('#' + id).value.trim(); return v === '' ? null : Number(v); };
  k.rates.forEach((r, i) => {
    r.minimum = num('m' + i);
    r.blocks = r.blocks.map((_, j) => num(`b${i}_${j}`));
    r.latePercent = num('l' + i) || 0;
  });
  k.minimumCubicMeters = Number($('#s2').value);
  k.dueDays = Number($('#s4').value);
  k.disconnectionDays = Number($('#s5').value);
  saveData();
  alert('Rates saved.');
}
