/* ======================================================================
   views.js - the screens
   Each screen is a function that returns HTML text. app.js puts that HTML
   on the page. Buttons call the functions in this file (onclick="...").
   Screen state (user, selected, lastBill ...) lives in app.js.
   Screens: Dashboard, Customers, Meter Reading, Payments (teller),
            Turn Over (teller), Deposits (cashier), Archive, Records, Settings.
   ====================================================================== */

const VIEWS = {};
let consumerRecordAccount = null;

/* A list of customers the user can pick from while typing */
const customerDatalist = (list = DATA.customers) =>
  `<datalist id="cl">${list.map(c => `<option value="${esc(c.account)}">${esc(c.name)}</option>`).join('')}</datalist>`;

const classOptions = chosen =>
  DATA.config.rates.map(r => `<option ${r.classification === chosen ? 'selected' : ''}>${esc(r.classification)}</option>`).join('');

const miniButton = (label, onclick) =>
  `<button class="s" style="margin:0;padding:4px 8px" onclick="${onclick}">${label}</button>`;

let usageMonth = today().slice(0, 7);

/* ---------------------------------------------------------------- Dashboard */
VIEWS.dash = () => {
  const open = DATA.bills.filter(isOpen);
  const outstanding = sumOf(open, b => amountDueOn(b));
  const collected = sumOf(DATA.payments, p => p.amountPaid);
  const toTurnOver = sumOf(DATA.payments.filter(p => !p.remittanceId), p => p.amountPaid);
  const forDeposit = sumOf(DATA.remittances.filter(r => r.status !== 'Deposited'), r => r.status === 'Received' ? r.counted : r.total);
  const box = (value, label) => `<div class="st"><b>${value}</b><span>${label}</span></div>`;
  const usageBills = DATA.bills.filter(b => b.readingDate && b.readingDate.slice(0, 7) === usageMonth);
  const totalUsage = sumOf(usageBills, b => Number(b.consumption) || 0);
  const accountUsage = new Map();
  usageBills.forEach(b => {
    const current = accountUsage.get(b.account) || { account: b.account, name: (customerOf(b.account) || {}).name || '', consumption: 0 };
    current.consumption += Number(b.consumption) || 0;
    accountUsage.set(b.account, current);
  });
  const topConsumers = [...accountUsage.values()]
    .sort((a, b) => b.consumption - a.consumption || a.name.localeCompare(b.name))
    .slice(0, 10);
  const zoneUsage = new Map();
  usageBills.forEach(b => {
    const zone = b.zone || (customerOf(b.account) || {}).zone || 'No zone';
    zoneUsage.set(zone, (zoneUsage.get(zone) || 0) + (Number(b.consumption) || 0));
  });
  const topZones = [...zoneUsage.entries()].sort((a, b) => b[1] - a[1]);
  const usageLabel = new Date(usageMonth + '-01T00:00:00').toLocaleDateString('en', { month: 'long', year: 'numeric' });
  const usageSummary = `<div class="card" style="margin-top:14px"><h3>Water usage summary</h3>
      <label>Reading month<input type="month" value="${esc(usageMonth)}" onchange="selectUsageMonth(this.value)"></label>
      <p class="mut">Usage is grouped by the bill reading date, not the exact calendar days water was consumed.</p>
      <div class="g">
        ${box(totalUsage.toLocaleString() + ' cu.m', 'Total usage in ' + usageLabel)}
        ${box(usageBills.length, 'Bills generated')}
        ${box(usageBills.length ? (totalUsage / usageBills.length).toFixed(1) + ' cu.m' : '0.0 cu.m', 'Average per bill')}
        ${box(topConsumers.length ? topConsumers[0].consumption.toLocaleString() + ' cu.m' : '0 cu.m', 'Highest consumer usage')}
      </div>
      <div class="g" style="margin-top:14px;align-items:start">
        <div><h3>Highest usage consumers</h3><div class="tw"><table>
          <tr><th>Account</th><th>Name</th><th>Usage</th></tr>
          ${topConsumers.map(c => `<tr><td>${esc(c.account)}</td><td>${esc(c.name)}</td><td>${c.consumption.toLocaleString()} cu.m</td></tr>`).join('') || '<tr><td colspan="3" class="mut">No readings for this month.</td></tr>'}
        </table></div></div>
        <div><h3>Usage by zone</h3><div class="tw"><table>
          <tr><th>Zone</th><th>Total usage</th></tr>
          ${topZones.map(([zone, consumption]) => `<tr><td>${esc(zone === 'No zone' ? zone : zoneLabel(zone))}</td><td>${consumption.toLocaleString()} cu.m</td></tr>`).join('') || '<tr><td colspan="2" class="mut">No readings for this month.</td></tr>'}
        </table></div></div>
      </div></div>`;
  return `<div class="g">
      ${box(DATA.customers.length, 'Consumers')}
      ${box(DATA.bills.length, 'Bills generated')}
      ${box(open.length, 'Outstanding bills')}
      ${box(archivedAccounts().length, 'In archive (unpaid)')}
      ${box(money(outstanding), 'Outstanding (PHP)')}
      ${box(money(collected), 'Collected (PHP)')}
      ${box(money(toTurnOver), 'With teller, not turned over')}
      ${box(money(forDeposit), 'With cashier, not deposited')}
    </div>
    ${usageSummary}
    <div class="card" style="margin-top:14px"><h3>Workflow</h3>
      <p><b>1.</b> The meter reader reads the meter, generates the bill, and prints it on site.<br>
      <b>2.</b> The consumer pays the <b>teller</b> at the district office.<br>
      <b>3.</b> The teller turns the collections over to the <b>cashier</b>.<br>
      <b>4.</b> The cashier counts the cash and deposits it in the bank.<br>
      <b>5.</b> A consumer who has not paid after the disconnection date goes to the <b>Archive</b> automatically, and leaves it when the bill is paid in full.<br>
      Meter readers and cashiers never take a consumer's payment.</p></div>`;
};

function selectUsageMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) return;
  usageMonth = month;
  render();
}

/* ---------------------------------------------------------------- Consumers */
function customerRows(query = '') {
  const q = query.toLowerCase();
  return DATA.customers
    .filter(c => (c.account + c.name).toLowerCase().includes(q))
    .slice(0, 300)                                     // keep the screen fast
    .map(c => `<tr><td>${esc(c.account)}</td><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${esc(c.meter)}</td><td>${esc(c.classification)}</td><td>${c.connectionStartDate ? fmtDate(c.connectionStartDate) : 'Not set'}</td><td>${hasPreviousReading(c) ? c.lastReading : 'Not set'}</td><td>${miniButton('View records', `viewConsumerRecords('${esc(c.account)}')`)}</td></tr>`)
    .join('');
}

function addCustomerCard() {
  const onInput = 'oninput="clearConsumerValidation()"';
  const onNameInput = 'oninput="filterConsumerName(this);clearConsumerValidation()"';
  const accountInput = 'oninput="filterConsumerNumber(this,true);clearConsumerValidation()"';
  const meterInput = 'oninput="filterConsumerNumber(this,false);clearConsumerValidation()"';
  const required = '<span class="required-mark" aria-hidden="true">*</span>';
  return `<div class="card"><h3>Add consumer</h3><div class="g">
      <label>Account no. ${required}<input id="a1" placeholder="081-102-003" inputmode="numeric" ${accountInput}><span id="a1Hint" class="field-hint" aria-live="polite"></span></label>
      <div id="consumerIndividualName" class="consumer-name-fields">
        <label>First name ${required}<input id="a9" placeholder="Juan" autocomplete="given-name" ${onNameInput}><span id="a9Hint" class="field-hint" aria-live="polite"></span></label>
        <label>Last name ${required}<input id="a2" placeholder="Dela-cruz" autocomplete="family-name" ${onNameInput}><span id="a2Hint" class="field-hint" aria-live="polite"></span></label>
        <label>Middle name (optional)<input id="a11" autocomplete="additional-name" ${onNameInput}><span id="a11Hint" class="field-hint" aria-live="polite"></span></label>
      </div>
      <div id="consumerBusinessName" class="consumer-name-fields" hidden>
        <label>Commercial/business name ${required}<input id="a10" autocomplete="organization" ${onInput}></label>
      </div>
      <label>Service address<input id="a3" ${onInput}></label>
      <label>Meter no. ${required}<input id="a4" inputmode="numeric" ${meterInput}><span id="a4Hint" class="field-hint" aria-live="polite"></span></label>
      <label>Meter size<input id="a5" value="1/2" ${onInput}></label>
      <label>Connection start date ${required}${datePicker('a12', '', 'clearConsumerValidation()')}</label>
      <label>Classification ${required}<select id="a7" onchange="toggleConsumerNameFields();clearConsumerValidation()">${classOptions(DEFAULT_CLASS)}</select></label>
      <label>Zone ${required}<select id="a8" onchange="clearConsumerValidation()"><option value="">Select zone</option>${ZONES.map(z => `<option value="${z}">Zone ${z}</option>`).join('')}</select></label>
      <label>Starting meter reading at connection ${required}<input id="a6" type="text" inputmode="numeric" value="0" ${onInput}></label>
      <p class="mut">This reading is the baseline for the consumer's first bill.</p>
    </div><p id="consumerError" class="form-error" role="alert" aria-live="polite"></p>
    <button class="p" onclick="addCustomer()">Save consumer</button></div>`;
}

function uploadCard() {
  const p = importPreview;
  const preview = p ? `
      <p>Ready: <b>${p.newCount}</b> new, <b>${p.existingCount}</b> already exist, <b>${p.invalid.length}</b> with problems.</p>
      ${p.invalid.slice(0, 5).map(b => `<p class="mut">Row ${b.rowNo}: ${esc(b.reason)}</p>`).join('')}
      <button class="p" onclick="applyImport()">Import now</button>
      <button class="s" onclick="importPreview=null;render()">Cancel</button>` : '';
  return `<div class="card"><h3>Upload many consumers (CSV)</h3>
      <p class="mut">Columns: account no., name, address, meter no., meter size, last reading, classification
      (blank = Domestic/Government), zone (1 to 9). If last reading is blank, the consumer can be saved but cannot be billed until a previous reading is added. In Excel use Save As, then CSV. Format the columns as Text first so Excel does not turn 1/2 into a date.</p>
      <button class="s" onclick="downloadTemplate()">Download template</button>
      <label>CSV file<input type="file" accept=".csv,text/csv" onchange="readCustomerFile(this.files[0])"></label>
      <label><input type="checkbox" ${importUpdateExisting ? 'checked' : ''} onchange="importUpdateExisting=this.checked">Update consumers that already exist</label>
      ${preview}</div>`;
}

VIEWS.customers = () => {
  if (consumerRecordAccount && customerOf(consumerRecordAccount)) return consumerRecordsCard();
  return `
    ${user.role === 'admin' ? addCustomerCard() + uploadCard() : ''}
    <div class="card"><h3>Consumers (${DATA.customers.length})</h3>
      <input placeholder="Search name or account" oninput="$('#custRows').innerHTML = customerRows(this.value)">
      <div class="tw"><table><tr><th>Account</th><th>Name</th><th>Address</th><th>Meter</th><th>Class</th><th>Connection start date</th><th>Last reading</th><th></th></tr>
      <tbody id="custRows">${customerRows()}</tbody></table></div></div>`;
};

function consumerRecordsCard() {
  const c = consumerRecordAccount && customerOf(consumerRecordAccount);
  if (!c) return '';
  const bills = DATA.bills.filter(b => b.account === c.account)
    .sort((a, b) => a.readingDate.localeCompare(b.readingDate) || a.no.localeCompare(b.no));
  const payments = DATA.payments.filter(p => p.account === c.account)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const canPay = MENU[user.role].includes('pay');
  const openBills = bills.filter(isOpen);
  const payAllAction = canPay && openBills.length
    ? `<button class="p" onclick="payConsumerAll('${esc(c.account)}')">Pay all (${money(sumOf(openBills, b => amountDueOn(b)))})</button>`
    : '';
  const billRows = bills.map(bill => {
    const balance = isOpen(bill) ? amountDueOn(bill)
      : bill.status === 'Rolled' ? 0
        : Math.max(0, bill.total - bill.paid);
    const action = isOpen(bill) && canPay
      ? miniButton('Pay this month', `payConsumerBill('${esc(c.account)}','${esc(bill.no)}')`)
      : '';
    return `<tr><td>${esc(billingMonthLabel(bill))}</td><td>${fmtDate(bill.readingDate)}</td><td>${bill.consumption} cu.m</td><td>${money(bill.total)}</td><td>${money(bill.paid || 0)}</td><td>${money(balance)}</td><td class="${esc(bill.status)}">${esc(bill.status)}</td><td>${action}</td></tr>`;
  }).join('');
  const paymentRows = payments.map(payment => {
    const bill = DATA.bills.find(b => b.no === payment.billNo);
    return `<tr><td>${esc(payment.or)}</td><td>${esc(bill ? billingMonthLabel(bill) : 'Unknown month')}</td><td>${fmtDate(payment.date)}</td><td>${money(payment.amountPaid)}</td><td>${money(payment.balance)}</td><td>${esc(payment.teller)}</td></tr>`;
  }).join('');
  return `<div class="card"><h3>Consumer history: ${esc(c.name)}</h3>
      <p class="mut">Account ${esc(c.account)} | ${esc(c.address)} | ${esc(c.classification)}</p>
      <button class="s" onclick="closeConsumerRecords()">Back</button>
      ${payAllAction}
      <h3>Monthly bills</h3><div class="tw"><table>
        <tr><th>Billing month</th><th>Reading date</th><th>Usage</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr>
        ${billRows || '<tr><td colspan="8" class="mut">No bills for this consumer yet.</td></tr>'}
      </table></div>
      <h3 style="margin-top:14px">Payments</h3><div class="tw"><table>
        <tr><th>OR no.</th><th>Billing month</th><th>Payment date</th><th>Amount paid</th><th>Balance after payment</th><th>Teller</th></tr>
        ${paymentRows || '<tr><td colspan="6" class="mut">No payments for this consumer yet.</td></tr>'}
      </table></div></div>`;
}

function viewConsumerRecords(account) {
  if (!customerOf(account)) return alert('Consumer not found.');
  consumerRecordAccount = account;
  render();
}

function closeConsumerRecords() {
  consumerRecordAccount = null;
  render();
}

function payConsumerBill(account, billNo) {
  const bill = DATA.bills.find(b => b.no === billNo && b.account === account && isOpen(b));
  if (!bill) return alert('That monthly bill is no longer unpaid.');
  if (!MENU[user.role].includes('pay')) return alert('You do not have permission to record payments.');
  const c = customerOf(account);
  rememberCurrentPage();
  selected = account;
  selectedBillNo = billNo;
  payAllOutstanding = false;
  lastBulkReceipts = [];
  consumerRecordAccount = null;
  lastBill = lastReceipt = null;
  reprintText = '';
  DATA.config.payZone = zoneOf(c);
  tab = 'pay';
  saveData();
  saveSession();
  render();
}

function payConsumerAll(account) {
  const c = customerOf(account);
  if (!c) return alert('Consumer not found.');
  if (!MENU[user.role].includes('pay')) return alert('You do not have permission to record payments.');
  if (!openBillsOf(account).length) return alert('This consumer has no unpaid monthly bills.');
  rememberCurrentPage();
  selected = account;
  selectedBillNo = null;
  payAllOutstanding = true;
  lastReceipt = null;
  lastBulkReceipts = [];
  reprintText = '';
  DATA.config.payZone = zoneOf(c);
  tab = 'pay';
  saveData();
  saveSession();
  render();
}

function addCustomer() {
  const account = $('#a1').value.trim();
  const lastName = $('#a2').value.trim();
  const firstName = $('#a9').value.trim();
  const middleName = $('#a11').value.trim();
  const businessName = $('#a10').value.trim();
  const address = $('#a3').value.trim();
  const meter = $('#a4').value.trim();
  const size = $('#a5').value.trim();
  const connectionStartDate = $('#a12').value;
  const reading = $('#a6').value.trim();
  const classification = $('#a7').value;
  const zone = $('#a8').value;
  const invalid = [];
  let message = '';
  const isCommercial = classification.startsWith('Commercial');
  const name = isCommercial ? businessName : [firstName, middleName, lastName].filter(Boolean).join(' ');
  if (!account || !meter || (isCommercial ? !businessName : !lastName || !firstName)) {
    message = isCommercial
      ? 'Invalid consumer: account number, commercial/business name, and meter number are required.'
      : 'Invalid consumer: account number, first name, last name, and meter number are required.';
    if (!account) invalid.push('a1');
    if (!meter) invalid.push('a4');
    if (isCommercial && !businessName) invalid.push('a10');
    if (!isCommercial && !lastName) invalid.push('a2');
    if (!isCommercial && !firstName) invalid.push('a9');
  } else if (!/^\d+(?:-\d+)*$/.test(account)) {
    message = 'Invalid consumer: account number may contain numbers and hyphens only.';
    invalid.push('a1');
  } else if (!/^\d+$/.test(meter)) {
    message = 'Invalid consumer: meter number must contain numbers only.';
    invalid.push('a4');
  } else if (!isCommercial && (!isLetterName(lastName) || !isLetterName(firstName) || (middleName && !isLetterName(middleName)))) {
    message = 'Invalid consumer: first, middle, and last names may contain letters only.';
    if (!isLetterName(firstName)) invalid.push('a9');
    if (!isLetterName(lastName)) invalid.push('a2');
    if (middleName && !isLetterName(middleName)) invalid.push('a11');
  } else if (customerOf(account)) {
    message = 'Invalid consumer: that account number already exists.';
    invalid.push('a1');
  } else if (!connectionStartDate || Number.isNaN(new Date(connectionStartDate + 'T00:00:00').getTime())) {
    message = 'Invalid consumer: enter a valid connection start date.';
    invalid.push('a12');
  } else if (!/^\d+$/.test(reading)) {
    message = 'Invalid consumer: initial reading must be a non-negative whole number.';
    invalid.push('a6');
  } else if (!ZONES.includes(zone)) {
    message = 'Invalid consumer: choose a valid zone.';
    invalid.push('a8');
  } else if (!DATA.config.rates.some(rate => rate.classification === classification)) {
    message = 'Invalid consumer: choose a valid classification.';
    invalid.push('a7');
  }
  if (message) return showConsumerValidation(message, invalid);
  clearConsumerValidation();
  DATA.customers.push({
    account,
    name: name.toUpperCase(),
    ...(isCommercial ? { businessName: name.toUpperCase() } : {
      firstName: firstName.toUpperCase(),
      middleName: middleName.toUpperCase(),
      lastName: lastName.toUpperCase()
    }),
    address: address.toUpperCase(), meter, size: size || '1/2', connectionStartDate,
    classification, lastReading: Number(reading), zone
  });
  audit('CONSUMER ADDED', account, name.toUpperCase());
  render();
}

function toggleConsumerNameFields() {
  const isCommercial = $('#a7').value.startsWith('Commercial');
  $('#consumerIndividualName').hidden = isCommercial;
  $('#consumerBusinessName').hidden = !isCommercial;
}

function filterConsumerName(field) {
  const original = field.value;
  field.value = original.replace(/[^\p{L}\p{M} .'-]/gu, '');
  const hint = $('#' + field.id + 'Hint');
  if (hint) hint.textContent = original === field.value ? '' : 'Invalid';
}

function filterConsumerNumber(field, allowHyphen) {
  const original = field.value;
  const filtered = original.replace(allowHyphen ? /[^0-9-]/g : /[^0-9]/g, '');
  field.value = filtered;
  const hint = $('#' + field.id + 'Hint');
  if (hint) hint.textContent = original === filtered ? '' : 'Invalid';
}

function isLetterName(name) {
  return /[\p{L}\p{M}]/u.test(name) && /^[\p{L}\p{M} .'-]+$/u.test(name);
}

function showConsumerValidation(message, ids) {
  clearConsumerValidation();
  $('#consumerError').textContent = message;
  ids.forEach(id => {
    const field = $('#' + id);
    field.classList.add('invalid');
    field.setAttribute('aria-invalid', 'true');
  });
  if (ids.length) $('#' + ids[0]).focus();
}

function clearConsumerValidation() {
  const error = $('#consumerError');
  if (error) error.textContent = '';
  ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12'].forEach(id => {
    const field = $('#' + id);
    if (field) {
      field.classList.remove('invalid');
      field.removeAttribute('aria-invalid');
    }
  });
}

/* ------------------------------------------------------------ Meter reading */
VIEWS.read = () => {
  const c = selected && customerOf(selected);
  const form = c ? `
      <p><b>${esc(c.name)}</b> <span class="tag">${esc(c.classification)}</span><br>${esc(c.address)}<br>
      Meter ${esc(c.meter)} | Starting/previous reading: <b>${hasPreviousReading(c) ? c.lastReading : 'Not set'}</b></p>
      ${!DATA.bills.some(b => b.account === c.account) ? '<p class="mut">This is the first bill for this consumer; a previous bill is not required. The saved starting meter reading is used to calculate usage.</p>' : ''}
      ${hasPreviousReading(c) ? `
        <label>Present reading<input id="pr" type="number" min="0" inputmode="numeric" oninput="previewAmount()"><span id="prHint" class="field-hint" aria-live="polite"></span></label>
        <label>Reading date${datePicker('rd', today(), 'validateReadingDate()')}<span id="rdHint" class="field-hint" aria-live="polite"></span></label>
        <label>Remarks (optional)<input id="rm"></label>
        <p id="pv" class="mut"></p>
        <button class="p" onclick="submitReading()">Generate bill</button>` :
        '<p class="form-error" role="alert">Cannot generate a bill until a valid starting meter reading is entered for this consumer.</p>'}` : '';
  const zone = currentZone();
  return `<div class="card"><h3>Meter reading</h3>
      ${c ? '<button type="button" class="s" onclick="backToReadingConsumers()">Back</button>' : ''}
      <label>Zone being read
        <select onchange="chooseZone(this.value)">
          <option value="" ${zone ? '' : 'selected'}>Select zone</option>
          ${zoneChoices().map(z => `<option value="${z}" ${z === zone ? 'selected' : ''}>${zoneLabel(z)} (${customersInZone(z).length})</option>`).join('')}
        </select></label>
      ${zone ? `<input list="cl" placeholder="Account no. or consumer name in ${zoneLabel(zone)}" onchange="selectCustomer(this.value)" value="${c ? esc(c.account) : ''}">
      ${customerDatalist(customersInZone(zone))}` : '<p class="mut">Choose the zone first. Only the consumers of that zone will be listed.</p>'}${form}</div>
      ${zone && !c ? zoneListCard(zone) : ''}
      ${lastBill ? printCard(billText(lastBill)) : ''}
      ${c ? readingCard(c) : ''}`;
};

/* The digital version of the paper Meter Reading Card (Form BC-15) */
function readingCard(c) {
  const rows = DATA.bills.filter(b => b.account === c.account).slice(-12).reverse()
    .map(b => `<tr><td>${fmtDate(b.readingDate)}</td><td>${esc(b.zone || '')}</td><td>${b.present}</td><td>${b.consumption}</td><td>${money(b.amount)}</td><td>${esc(b.remarks || '')}</td><td>${esc(b.readBy)}</td></tr>`).join('');
  return `<div class="card"><h3>Meter reading card</h3>
      <div class="tw"><table><tr><th>Date</th><th>Zone</th><th>Reading</th><th>Cu.m</th><th>Amount</th><th>Remarks</th><th>Read by</th></tr>
      ${rows || '<tr><td colspan="7" class="mut">No readings yet.</td></tr>'}</table></div></div>`;
}

/* The meter reader picks the zone he is reading from the list of 9 zones.
   It is kept on this device and stamped on every bill generated after that. */
// Meter Reading and Payments each remember their own zone on this device
const zoneKey = () => tab === 'pay' ? 'payZone' : 'zone';
const currentZone = () => zoneChoices().includes(DATA.config[zoneKey()]) ? DATA.config[zoneKey()] : '';

function chooseZone(value) {
  DATA.config[zoneKey()] = value;
  selected = lastBill = selectedBillNo = null;
  saveData();
  render();
}

const customersInZone = z => DATA.customers.filter(c => zoneOf(c) === z);
// zones 1-9, plus "No zone" only when some customers have none yet
const zoneChoices = () => customersInZone(NO_ZONE).length ? [...ZONES, NO_ZONE] : ZONES;

/* The consumers inside the chosen zone, each with a Read button */
function zoneListCard(z) {
  const paying = tab === 'pay';
  const rows = customersInZone(z).map(c => {
    const bills = openBillsOf(c.account);
    const last = paying ? (bills.length ? bills.length + ' unpaid month(s)' : '<span class="mut">No unpaid bills</span>') : c.lastReading;
    return `<tr><td>${esc(c.account)}</td><td>${esc(c.name)}</td><td>${esc(c.address)}</td><td>${last}</td>
      <td>${miniButton(paying ? 'Select' : 'Read', `selectCustomer('${esc(c.account)}')`)}</td></tr>`;
  }).join('');
  return `<div class="card"><h3>Consumers in ${zoneLabel(z)} (${customersInZone(z).length})</h3><div class="tw"><table>
    <tr><th>Account</th><th>Name</th><th>Address</th><th>${paying ? 'Unpaid months' : 'Previous reading'}</th><th></th></tr>
    ${rows || '<tr><td colspan="5" class="mut">No consumers in this zone yet.</td></tr>'}</table></div></div>`;
}

function selectCustomer(text) {
  const t = text.trim().toLowerCase();
  const c = DATA.customers.find(x => x.account.toLowerCase() === t || x.name.toLowerCase() === t);
  if (!c) alert('Consumer not found.');
  else if ((tab === 'read' || tab === 'pay') && zoneOf(c) !== currentZone()) {
    alert(c.name + ' is not in ' + zoneLabel(currentZone()) + '. Change the zone first.');
    return;
  }
  selected = c ? c.account : null;
  selectedBillNo = null;
  lastBill = null;
  lastReceipt = null;
  render();
}

function backToReadingConsumers() {
  selected = null;
  selectedBillNo = null;
  lastBill = null;
  render();
}

function backToPaymentConsumers() {
  selected = null;
  selectedBillNo = null;
  payAllOutstanding = false;
  lastReceipt = null;
  lastBulkReceipts = [];
  reprintText = '';
  render();
}

// Shows consumption and amount while the reader is still typing
function previewAmount() {
  const c = customerOf(selected);
  if (!hasPreviousReading(c)) return;
  const field = $('#pr');
  const hint = $('#prHint');
  const value = field.value;
  if (value === '') {
    field.classList.remove('invalid');
    field.removeAttribute('aria-invalid');
    hint.textContent = '';
    $('#pv').textContent = '';
    return;
  }
  const present = Number(value);
  if (!Number.isInteger(present) || present < 0 || present < c.lastReading) {
    field.classList.add('invalid');
    field.setAttribute('aria-invalid', 'true');
    hint.textContent = 'Invalid';
    $('#pv').textContent = '';
    return;
  }
  field.classList.remove('invalid');
  field.removeAttribute('aria-invalid');
  hint.textContent = '';
  const consumption = present - c.lastReading;
  try {
    $('#pv').innerHTML = `Consumption <b>${consumption} cu.m</b> | Amount <b>PHP ${money(computeAmount(consumption, c.classification))}</b> (this month's bill only)`;
  } catch (e) {
    $('#pv').innerHTML = `<span class="Unpaid">${esc(e.message)}</span>`;
  }
}

function validateReadingDate() {
  const field = $('#rd');
  const display = $('#rd-display');
  const hint = $('#rdHint');
  if (!field || !hint) return true;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(field.value)
    && toIso(new Date(`${field.value}T00:00:00`)) === field.value;
  const existingBill = DATA.bills.find(b =>
    validDate && b.account === selected && b.readingDate.slice(0, 7) === field.value.slice(0, 7));
  const duplicate = !!existingBill;
  const month = duplicate
    ? new Date(`${existingBill.readingDate.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';
  const message = !validDate
    ? 'Enter a valid date as MM/DD/YYYY.'
    : duplicate
      ? `A bill for ${month} already exists. Choose a different month.`
      : '';
  const invalid = !validDate || duplicate;
  [field, display].filter(Boolean).forEach(input => {
    input.classList.toggle('invalid', invalid);
    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  });
  hint.textContent = message;
  return !invalid;
}

function submitReading() {
  const c = customerOf(selected);
  if (!hasPreviousReading(c)) {
    alert('Cannot generate a bill: enter a valid starting meter reading first.');
    return;
  }
  const raw = $('#pr').value;
  const present = raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(present) || present < 0 || present < c.lastReading) {
    $('#pr').classList.add('invalid');
    $('#pr').setAttribute('aria-invalid', 'true');
    $('#prHint').textContent = `Enter a whole number equal to or greater than the previous reading (${c.lastReading}).`;
    $('#pr').focus();
    return;
  }
  if (!validateReadingDate()) {
    $('#rd-display').focus();
    return;
  }
  try {
    lastBill = generateBill({ account: selected, present, readingDate: $('#rd').value, readBy: user.name, remarks: $('#rm').value.trim() });
    render();
  } catch (e) {
    if (/already exists for that month/i.test(e.message)) {
      validateReadingDate();
      $('#rd-display').focus();
      return;
    }
    alert(e.message);
  }
}

/* ------------------------------------------------- Payments (the teller) */
VIEWS.pay = () => {
  const c = selected && customerOf(selected);
  const bills = c
    ? DATA.bills.filter(b => b.account === c.account).sort((a, b) => a.readingDate.localeCompare(b.readingDate) || a.no.localeCompare(b.no))
    : [];
  const bill = bills.find(b => b.no === selectedBillNo && isOpen(b));
  const openBills = c ? openBillsOf(c.account) : [];
  let body = '';
  if (c && !bills.some(isOpen)) body = `<p>${esc(c.name)} has no outstanding bills.</p>`;
  if (c && payAllOutstanding && openBills.length) {
    const totalDue = sumOf(openBills, monthBill => amountDueOn(monthBill));
    const rows = openBills.map(monthBill => `<tr><td>${esc(billingMonthLabel(monthBill))}</td><td>${monthBill.no}</td><td>${money(amountDueOn(monthBill))}</td></tr>`).join('');
    body = `<div class="card"><h3>Pay all</h3>
      <p><b>${esc(c.name)}</b> | Account ${esc(c.account)}</p>
      <div class="tw"><table><tr><th>Month</th><th>Bill</th><th>Amount due today</th></tr>${rows}</table></div>
      <p>Total due today: <span class="big">PHP ${money(totalDue)}</span></p>
      <p class="mut">Payment is applied oldest month first. If the tendered amount is less than the total, remaining months stay unpaid. Any extra is returned as change.</p>
      <label>Amount tendered<input id="tn" type="number" step="0.01" inputmode="decimal"></label>
      <button type="button" class="p" onclick="submitAllPayments()">Pay all</button></div>`;
  }
  if (c && bill) {
    const late = today() > bill.dueDate ? ` + ${bill.latePercent}% late charge` : '';
    body = `<div class="card"><h3>Pay ${esc(billingMonthLabel(bill))}</h3>
      <p><b>${esc(c.name)}</b> ${isArchived(c.account) ? '<span class="tag Unpaid">In archive</span>' : ''}<br>Bill ${bill.no} | Due ${fmtDate(bill.dueDate)}</p>
      <div class="mut">Amount due today</div><div class="big">PHP ${money(amountDueOn(bill))}</div>
      <p class="mut">Current ${money(bill.amount)} + arrears ${money(bill.arrears)}${late}</p>
      <label>Amount tendered<input id="tn" type="number" step="0.01" inputmode="decimal"></label>
      <button type="button" class="p" onclick="submitPayment()">Record payment and show receipt</button></div>`;
  }
  const billRows = bills.map(monthBill => {
    const due = isOpen(monthBill) ? money(amountDueOn(monthBill))
      : monthBill.status === 'Rolled' ? 'Included in later bill'
        : money(Math.max(0, monthBill.total - monthBill.paid));
    const actions = `${isOpen(monthBill) ? miniButton(monthBill.no === selectedBillNo ? 'Selected' : 'Pay this month', `selectBillForPayment('${monthBill.no}')`) : ''} ${miniButton('Print bill', `reprintBill('${monthBill.no}')`)}`;
    return `<tr><td>${esc(billingMonthLabel(monthBill))}</td><td>${fmtDate(monthBill.readingDate)}</td><td>${monthBill.consumption} cu.m</td><td>${due}</td><td class="${monthBill.status}">${esc(monthBill.status)}</td><td>${actions}</td></tr>`;
  }).join('');
  const payAllButton = c && openBills.length && MENU[user.role].includes('pay')
    ? `<button class="p" onclick="payConsumerAll('${esc(c.account)}')">Pay all (${money(sumOf(openBills, monthBill => amountDueOn(monthBill)))})</button>`
    : '';
  const monthlyRecords = c ? `<div class="card"><h3>Monthly bills — ${esc(c.name)}</h3>
      <p class="mut">Pay one month by selecting its row, or pay all unpaid months together.</p>
      ${payAllButton}
      <div class="tw"><table><tr><th>Billing month</th><th>Reading date</th><th>Usage</th><th>Balance</th><th>Status</th><th>Actions</th></tr>
      ${billRows || '<tr><td colspan="6" class="mut">No monthly bills yet.</td></tr>'}</table></div></div>` : '';
  const zone = currentZone();
  return `<div class="card"><h3>Record payment (teller)</h3>
      ${c ? '<button type="button" class="s" onclick="backToPaymentConsumers()">Back</button>' : ''}
      <label>Consumer zone
        <select onchange="chooseZone(this.value)">
          <option value="" ${zone ? '' : 'selected'}>Select zone</option>
          ${zoneChoices().map(z => `<option value="${z}" ${z === zone ? 'selected' : ''}>${zoneLabel(z)} (${customersInZone(z).length})</option>`).join('')}
        </select></label>
      ${zone ? `<input list="cl" placeholder="Account no. or consumer name in ${zoneLabel(zone)}" onchange="selectCustomer(this.value)" value="${c ? esc(c.account) : ''}">
      ${customerDatalist(customersInZone(zone))}` : '<p class="mut">Choose the zone first. Only the consumers of that zone will be listed.</p>'}${body}</div>
      ${monthlyRecords}
      ${lastBulkReceipts.length || lastReceipt
        ? `<div id="paymentReceipt"><p class="form-success" role="status">Payment recorded. Receipt is ready below; choose a print option.</p>
            ${lastBulkReceipts.map(payment => printCard(receiptText(payment))).join('')}
            ${lastReceipt ? printCard(receiptText(lastReceipt)) : ''}</div>`
        : reprintText ? printCard(reprintText) : ''}
      ${zone && !c ? zoneListCard(zone) : ''}`;
};

function billingMonthLabel(bill) {
  const month = (bill.billingMonth || bill.readingDate || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return 'Unknown month';
  return new Date(month + '-01T00:00:00').toLocaleDateString('en', { month: 'long', year: 'numeric' });
}

function selectBillForPayment(billNo) {
  const bill = DATA.bills.find(b => b.no === billNo && b.account === selected && isOpen(b));
  if (!bill) return alert('That monthly bill is no longer unpaid.');
  selectedBillNo = billNo;
  payAllOutstanding = false;
  lastBulkReceipts = [];
  lastReceipt = null;
  reprintText = '';
  render();
}

function submitPayment() {
  try {
    lastReceipt = recordPayment({ account: selected, billNo: selectedBillNo, tendered: Number($('#tn').value), teller: user.name });
    lastBulkReceipts = [];
    render();
    const receipt = document.getElementById('paymentReceipt');
    if (receipt) receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { alert(e.message); }
}

function submitAllPayments() {
  try {
    lastBulkReceipts = recordPayments({
      account: selected,
      billNos: openBillsOf(selected).map(bill => bill.no),
      tendered: Number($('#tn').value),
      teller: user.name
    });
    lastReceipt = null;
    render();
    const receipt = document.getElementById('paymentReceipt');
    if (receipt) receipt.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

/* ------------------------------------------------------------------ Archive
   Consumers with an unpaid bill past the disconnection date. The list is
   computed from the bills, so a consumer leaves it automatically when paid. */
function archiveRows(query = '') {
  const q = query.toLowerCase();
  return archivedAccounts()
    .map((a, i) => ({ ...a, rank: i + 1 }))
    .filter(a => (a.customer.account + a.customer.name).toLowerCase().includes(q))
    .slice(0, 300)
    .map(a => `<tr><td>${a.rank}</td><td>${esc(a.customer.account)}</td><td>${esc(a.customer.name)}</td><td>${esc(a.customer.address)}</td>
      <td>${fmtDate(a.since)}</td><td><b class="Unpaid">${a.days}</b></td><td>${money(a.due)}</td></tr>`).join('');
}

VIEWS.archive = () => {
  const list = archivedAccounts();
  const longest = list[0];
  const summary = longest
    ? `<div class="g"><div class="st"><b>${list.length}</b><span>Consumers in archive</span></div>
        <div class="st"><b>${money(sumOf(list, a => a.due))}</b><span>Total unpaid (PHP)</span></div>
        <div class="st"><b>${longest.days} days</b><span>Longest unpaid: ${esc(longest.customer.name)}</span></div></div>` : '';
  return `<div class="card"><h3>Archive: consumers who have not paid</h3>
      <p class="mut">A consumer is moved here automatically when their bill is still unpaid after the disconnection date,
      and is removed automatically once the bill is paid in full. The longest unpaid is listed first.</p>
      ${summary}
      <input style="margin-top:10px" placeholder="Search account or name" oninput="$('#arcRows').innerHTML = archiveRows(this.value)">
      <div class="tw"><table><tr><th>#</th><th>Account</th><th>Name</th><th>Address</th><th>Unpaid since</th><th>Days</th><th>Amount due</th></tr>
      <tbody id="arcRows">${archiveRows() || '<tr><td colspan="7" class="mut">No consumers in the archive.</td></tr>'}</tbody></table></div></div>`;
};

/* ------------------------------------------------------------------ Records */
let recordsSearch = '';
let recordsStatus = '';
let recordsFrom = '';
let recordsTo = '';

function recordRows(query = recordsSearch) {
  const q = query.trim().toLowerCase();
  const nameOf = account => (customerOf(account) || { name: '' }).name;
  const hasFilters = q || (recordsTab === 'bills' && recordsStatus) || recordsFrom || recordsTo;
  if (recordsTab === 'bills') {
    const bills = [...DATA.bills].reverse()
      .filter(b => (!recordsStatus || b.status === recordsStatus)
        && (!recordsFrom || b.readingDate >= recordsFrom)
        && (!recordsTo || b.readingDate <= recordsTo)
        && [
        b.no, billingMonthLabel(b), b.account, nameOf(b.account), b.readingDate,
        fmtDate(b.readingDate), b.consumption, b.total, b.status
      ].join(' ').toLowerCase().includes(q))
      .slice(0, 300)
      .map(b => `<tr><td>${b.no}</td><td>${esc(billingMonthLabel(b))}</td><td>${esc(b.account)}</td><td>${fmtDate(b.readingDate)}</td><td>${b.consumption}</td><td>${money(b.total)}</td>
        <td class="${b.status}">${b.status}</td><td>${miniButton('Reprint', `reprintBill('${b.no}')`)}</td></tr>`).join('');
    return bills || `<tr><td colspan="8" class="mut">${hasFilters ? 'No bills match your filters.' : 'No bills yet.'}</td></tr>`;
  }
  const payments = [...DATA.payments].reverse()
    .filter(p => {
      const bill = DATA.bills.find(b => b.no === p.billNo);
      return (!recordsFrom || String(p.date).slice(0, 10) >= recordsFrom)
        && (!recordsTo || String(p.date).slice(0, 10) <= recordsTo)
        && [
        p.or, p.billNo, bill ? billingMonthLabel(bill) : '', p.account, nameOf(p.account),
        p.date, fmtDate(p.date), p.amountPaid, p.balance, p.teller
      ].join(' ').toLowerCase().includes(q);
    })
    .slice(0, 300)
    .map(p => {
      const bill = DATA.bills.find(b => b.no === p.billNo);
      return `<tr><td>${p.or}</td><td>${esc(bill ? billingMonthLabel(bill) : 'Unknown month')}</td><td>${esc(p.account)}</td><td>${fmtDate(p.date)}</td><td>${money(p.amountPaid)}</td><td>${money(p.balance)}</td>
      <td>${esc(p.teller)}</td><td>${miniButton('Reprint', `reprintReceipt('${p.or}')`)}</td></tr>`;
    }).join('');
  return payments || `<tr><td colspan="8" class="mut">${hasFilters ? 'No payments match your filters.' : 'No payments yet.'}</td></tr>`;
}

function updateRecordsSearch(value) {
  recordsSearch = value;
  $('#recRows').innerHTML = recordRows();
}

function updateRecordsStatus(value) {
  recordsStatus = value;
  $('#recRows').innerHTML = recordRows();
}

function updateRecordsDates() {
  recordsFrom = $('#recFrom').value;
  recordsTo = $('#recTo').value;
  $('#recRows').innerHTML = recordRows();
}

VIEWS.records = () => {
  const head = recordsTab === 'bills'
    ? '<tr><th>Bill</th><th>Billing month</th><th>Account</th><th>Reading date</th><th>Cu.m</th><th>Total</th><th>Status</th><th></th></tr>'
    : '<tr><th>OR</th><th>Billing month</th><th>Account</th><th>Payment date</th><th>Paid</th><th>Balance</th><th>Teller</th><th></th></tr>';
  return `${reprintText ? printCard(reprintText) : ''}
    <div class="card records-page"><h3>Bills and receipts</h3>
      <button class="${recordsTab === 'bills' ? 'p' : 's'}" onclick="setRecordsTab('bills')">Bills</button>
      <button class="${recordsTab === 'payments' ? 'p' : 's'}" onclick="setRecordsTab('payments')">Payments</button>
      <div class="filters records-filters">
        <input type="search" value="${esc(recordsSearch)}" placeholder="Search account or name" aria-label="Search records" oninput="updateRecordsSearch(this.value)">
        ${recordsTab === 'bills' ? `<select aria-label="Filter by bill status" onchange="updateRecordsStatus(this.value)">
          <option value="" ${recordsStatus ? '' : 'selected'}>All statuses</option>
          ${['Unpaid', 'Partial', 'Paid', 'Rolled'].map(status => `<option value="${status}" ${recordsStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>` : ''}
        <label class="records-date">From ${datePicker('recFrom', recordsFrom, 'updateRecordsDates()', 'en-GB')}</label>
        <label class="records-date">To ${datePicker('recTo', recordsTo, 'updateRecordsDates()', 'en-GB')}</label>
      </div>
      <div class="tw"><table>${head}<tbody id="recRows">${recordRows()}</tbody></table></div></div>`;
};

function setRecordsTab(name) { recordsTab = name; render(); }
function reprintBill(no) {
  const bill = DATA.bills.find(b => b.no === no);
  if (!bill) return alert('Bill not found.');
  audit('BILL REPRINTED', no);
  try { reprintText = billText(bill); }
  catch (e) { return alert(e.message); }
  lastReceipt = null;
  render();
  window.scrollTo(0, 0);
}
function reprintReceipt(or) { audit('RECEIPT REPRINTED', or); reprintText = receiptText(DATA.payments.find(p => p.or === or)); lastReceipt = null; render(); window.scrollTo(0, 0); }

/* ----------------------------------------------------------------- Settings */
const rateInput = (id, value) => `<input id="${id}" type="number" step="0.01" min="0" value="${value == null ? '' : value}">`;

function settingsCards() {
  const k = DATA.config;
  const head = `<tr><th>Classification</th><th>Minimum</th>${BLOCKS.map(b => `<th>${b.label} cu.m</th>`).join('')}<th>Late %</th></tr>`;
  const rows = k.rates.map((r, i) => `<tr><td>${esc(r.classification)}</td><td>${rateInput('m' + i, r.minimum)}</td>
      ${r.blocks.map((v, j) => `<td>${rateInput(`b${i}_${j}`, v)}</td>`).join('')}<td>${rateInput('l' + i, r.latePercent)}</td></tr>`).join('');
  const userRows = Object.values(DEFAULT_USERS).map(defaultUser => {
    const account = Object.values(USERS).find(u => u.role === defaultUser.role);
    return `<tr><td>${esc(defaultUser.name)}</td>
      <td><input id="username-${defaultUser.role}" autocomplete="off" minlength="5" maxlength="15" value="${esc(account.username)}"></td>
      <td><div class="password-field settings-password"><input id="password-${defaultUser.role}" type="password" autocomplete="new-password" minlength="8" maxlength="10" placeholder="8–10; blank keeps current"><button type="button" class="password-toggle" aria-label="Show password" title="Show password" onclick="togglePasswordVisibility('password-${defaultUser.role}',this)"><span aria-hidden="true">👁</span></button></div></td></tr>`;
  }).join('');
  const ratesHtml = `<div class="card"><h3>Water rates (per classification)</h3>
      <p class="mut">Rates of the Sindangan Water District. The minimum charge covers the first
      ${k.minimumCubicMeters} cu.m; each block is the price per cu.m inside that block.
      A blank cell means the rate is not set yet, and a bill cannot reach that block until it is entered.</p>
      <div class="tw"><table>${head}${rows}</table></div>
      <div class="g" style="margin-top:10px">
        <label>Minimum covers (cu.m)<input id="s2" type="number" value="${k.minimumCubicMeters}"></label>
        <label>Due after (days)<input id="s4" type="number" value="${k.dueDays}"></label>
        <label>Disconnection after (days)<input id="s5" type="number" value="${k.disconnectionDays}"></label>
      </div><button class="p" onclick="saveSettings()">Save rates</button></div>`;
  const accountsHtml = `<div class="card"><h3>User accounts</h3>
      <p class="mut">Admin ra ang maka-usab sa usernames ug passwords. Username: 5–15 ka karakter. Password: 8–10 ka karakter.
      Biyaan nga blangko ang password kung dili usbon.
      Kini nga app nagtipig sa accounts niining device/browser lamang; dili kini angay isipon nga secure server authentication.</p>
      <div class="tw"><table><tr><th>Role</th><th>Username</th><th>New password</th></tr>${userRows}</table></div>
      <p id="userSettingsError" class="form-error" role="alert" aria-live="polite"></p>
      <button class="p" onclick="saveUserAccounts()">Save user accounts</button></div>`;
  const backupHtml = `<div class="card"><h3>Backup (this device)</h3>
      <p class="mut">Records are stored on this device. Download a backup regularly, because clearing the browser data erases them.</p>
      <button class="s" onclick="downloadBackup()">Download backup</button>
      <label>Restore from backup file<input type="file" accept=".json" onchange="restoreBackup(this.files[0])"></label></div>`;
  return { ratesHtml, accountsHtml, backupHtml };
}

function saveUserAccounts() {
  if (!user || user.role !== 'admin') return alert('Only the administrator can change user accounts.');
  const accounts = {};
  const usernames = new Set();
  for (const defaultUser of Object.values(DEFAULT_USERS)) {
    const username = $('#username-' + defaultUser.role).value.trim().toLowerCase();
    const newPassword = $('#password-' + defaultUser.role).value;
    if (!username) {
      $('#userSettingsError').textContent = `Enter a username for ${defaultUser.name}.`;
      $('#username-' + defaultUser.role).focus();
      return;
    }
    if (username.length < 5 || username.length > 15) {
      $('#userSettingsError').textContent = 'Each username must be 5–15 characters.';
      $('#username-' + defaultUser.role).focus();
      return;
    }
    if (usernames.has(username)) {
      $('#userSettingsError').textContent = 'Each user must have a different username.';
      $('#username-' + defaultUser.role).focus();
      return;
    }
    usernames.add(username);
    const current = Object.values(USERS).find(account => account.role === defaultUser.role);
    if (newPassword && (newPassword.length < 8 || newPassword.length > 10)) {
      $('#userSettingsError').textContent = `The new password for ${defaultUser.name} must be 8–10 characters.`;
      $('#password-' + defaultUser.role).focus();
      return;
    }
    if (!newPassword && (current.password.length < 8 || current.password.length > 10)) {
      $('#userSettingsError').textContent = `Set a new password of 8–10 characters for ${defaultUser.name}.`;
      $('#password-' + defaultUser.role).focus();
      return;
    }
    accounts[defaultUser.role] = {
      username,
      password: newPassword || current.password
    };
  }
  if (!saveUsers(accounts)) {
    $('#userSettingsError').textContent = 'Could not save user accounts on this device.';
    return;
  }
  audit('ACCOUNTS CHANGED', 'usernames / passwords', 'passwords are never written to the log');
  Object.values(DEFAULT_USERS).forEach(d => { if ($('#password-' + d.role) && $('#password-' + d.role).value) staffInfo(d.role).passwordChangedAt = new Date().toISOString(); });
  saveData();
  render();
  alert('User accounts saved.');
}

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
  audit('RATES CHANGED', 'rates and rules');
  alert('Rates saved.');
}
