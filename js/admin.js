/* ======================================================================
   admin.js - the Settings hub and the screens added on top of the original
   Settings (admin) tabs: Rates & Rules | Staff Accounts | Audit Log | Reports | Backup | My Profile
   Reports   : also a menu item for the Teller and the Cashier
   My Profile: for every role (own details and activity); admin-only password changes
   Also here : login protection (lock-out, idle time-out) and CSV download.
   ====================================================================== */

const IDLE_MINUTES = 15;       // logged out after this much inactivity
const MAX_ATTEMPTS = 5;        // wrong passwords before the login is locked
const LOCK_MINUTES = 5;
let settingsTab = 'rates';
let reportDate = today();
let reportMonth = today().slice(0, 7);

/* ---------- small helpers ---------- */
const adminFilt = id => { const e = document.getElementById(id); return e ? e.value : ''; };
const payDay = p => toIso(new Date(p.date));
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const staffInfo = role => (DATA.staff[role] = DATA.staff[role] || { lastLogin: null, previousLogin: null, passwordChangedAt: null });

// CSV: cells that start with = + - @ are neutralised so Excel cannot run them as formulas
function csvCell(v) {
  let t = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
function downloadText(filename, text) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
}

/* ---------- login protection ---------- */
function loginLockMinutes(username) {
  const f = DATA.loginFails[username];
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
function recordLoginFailure(username, known) {
  const f = DATA.loginFails[username] || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX_ATTEMPTS) { f.n = 0; f.until = Date.now() + LOCK_MINUTES * 60000; }
  if (DATA.loginFails[username] || Object.keys(DATA.loginFails).length < 100) DATA.loginFails[username] = f;
  audit('LOGIN FAILED', username, known ? 'wrong password' : 'unknown username', false, username);
  return f.until > Date.now();
}
function recordLoginSuccess(account) {
  delete DATA.loginFails[account.username];
  const info = staffInfo(account.role);
  info.previousLogin = info.lastLogin;
  info.lastLogin = new Date().toISOString();
  audit('LOGIN', account.username, '', true, account.username, account.role);
}
function unlockAccount(role) {
  if (!user || user.role !== 'admin') return;
  const account = Object.values(USERS).find(u => u.role === role);
  if (account) { delete DATA.loginFails[account.username]; audit('LOGIN UNLOCKED', account.username); }
  render();
}

// idle time-out: after IDLE_MINUTES without a click or key, the user is logged out
let lastActivity = Date.now();
function touchActivity() {
  lastActivity = Date.now();
  try { if (user) sessionStorage.setItem('swd-active', String(lastActivity)); } catch (e) { /* storage blocked */ }
}
function sessionExpiredOnRefresh() {
  const last = Number(sessionStorage.getItem('swd-active') || 0);
  return Date.now() - last > IDLE_MINUTES * 60000;
}
['click', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, touchActivity, { passive: true }));
setInterval(() => {
  if (user && Date.now() - lastActivity > IDLE_MINUTES * 60000) {
    audit('SESSION TIMEOUT', user.username);
    logout();
    loginError = `You were logged out after ${IDLE_MINUTES} minutes without activity.`;
    render();
  }
}, 15000);

/* ======================================================================
   Settings hub (administrator)
   ====================================================================== */
const SETTINGS_TABS = [['rates', 'Rates & Rules'], ['accounts', 'Staff Accounts'], ['audit', 'Audit Log'], ['reports', 'Reports'], ['backup', 'Backup'], ['profile', 'My Profile']];

VIEWS.settings = () => {
  if (!user || user.role !== 'admin') return '<div class="card"><p class="form-error">Only the administrator can open Settings.</p></div>';
  const cards = settingsCards();
  const body = settingsTab === 'accounts' ? staffAccountsCards()
    : settingsTab === 'audit' ? auditCard()
    : settingsTab === 'reports' ? reportsBody()
    : settingsTab === 'backup' ? cards.backupHtml
    : settingsTab === 'profile' ? VIEWS.profile()
    : cards.ratesHtml;
  return `<div class="card"><h3>Settings</h3>
      ${SETTINGS_TABS.map(([id, label]) => `<button class="${settingsTab === id ? 'p' : 's'}" onclick="setSettingsTab('${id}')">${label}</button>`).join('')}</div>
    ${body}`;
};
function setSettingsTab(id) { if (user && user.role === 'admin') { settingsTab = id; render(); } }

/* ---------------------------------------------------------- Staff accounts */
function staffAccountsCards() {
  if (!user || user.role !== 'admin') {
    return '<div class="card"><p class="form-error">Only the administrator can manage user accounts.</p></div>';
  }
  const rows = Object.values(DEFAULT_USERS).map(defaultUser => {
    const account = Object.values(USERS).find(u => u.role === defaultUser.role);
    const info = staffInfo(defaultUser.role);
    const lock = loginLockMinutes(account.username);
    return `<tr><td>${esc(defaultUser.name)}</td>
      <td><input id="username-${defaultUser.role}" autocomplete="off" minlength="5" maxlength="15" value="${esc(account.username)}"></td>
      <td><div class="password-field settings-password"><input id="password-${defaultUser.role}" type="password" autocomplete="new-password" minlength="8" maxlength="10" placeholder="8–10; blank keeps current"><button type="button" class="password-toggle" aria-label="Show password" title="Show password" onclick="togglePasswordVisibility('password-${defaultUser.role}',this)">${passwordVisibilityIcon(false)}</button></div></td>
      <td>${info.lastLogin ? esc(fmtDateTime(info.lastLogin)) : '<span class="mut">never</span>'}</td>
      <td>${info.passwordChangedAt ? esc(fmtDateTime(info.passwordChangedAt)) : '<span class="mut">not changed</span>'}</td>
      <td>${lock ? `<span class="tag Unpaid">Locked ${lock} min</span> ${miniButton('Unlock', `unlockAccount('${defaultUser.role}')`)}` : '<span class="tag Paid">Active</span>'}</td></tr>`;
  }).join('');
  return `<div class="card"><h3>Staff accounts</h3>
      <p class="mut">Each role has one account. Username: 5–15 characters. Password: 8–10 characters. Leave the password blank to keep it.
      Only the administrator can change staff usernames and passwords here. After ${MAX_ATTEMPTS} wrong passwords a login is locked for ${LOCK_MINUTES} minutes (you can unlock it here).
      Accounts are kept on this device only; this is not a server login. Passwords are never written to the audit log.</p>
      <div class="tw"><table><tr><th>Role</th><th>Username</th><th>New password</th><th>Last login</th><th>Password changed</th><th>Status</th></tr>${rows}</table></div>
      <p id="userSettingsError" class="form-error" role="alert" aria-live="polite"></p>
      <button class="p" onclick="saveUserAccounts()">Save staff accounts</button></div>`;
}

/* ---------------------------------------------------------- Audit log */
function auditRows() {
  const q = adminFilt('lq').toLowerCase(), u = adminFilt('lu'), r = adminFilt('lr'), from = adminFilt('lf'), to = adminFilt('lt');
  return [...DATA.audit].reverse()
    .filter(e => (!u || e.user === u) && (!r || (r === 'fail' ? !e.ok : e.ok))
      && (!from || toIso(new Date(e.ts)) >= from) && (!to || toIso(new Date(e.ts)) <= to)
      && (e.action + ' ' + e.target + ' ' + e.detail + ' ' + e.user).toLowerCase().includes(q))
    .slice(0, 300)
    .map(e => `<tr><td>${esc(fmtDateTime(e.ts))}</td><td>${esc(e.user)}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td class="wrap">${esc(e.detail)}</td><td class="${e.ok ? 'Paid' : 'Unpaid'}">${e.ok ? 'OK' : 'Failed'}</td></tr>`).join('')
    || '<tr><td colspan="6" class="mut">No entries match.</td></tr>';
}
function auditCard() {
  const names = [...new Set(DATA.audit.map(e => e.user))].sort();
  const refresh = `oninput="$('#audRows').innerHTML = auditRows()" onchange="$('#audRows').innerHTML = auditRows()"`;
  return `<div class="card"><h3>Audit log (${DATA.audit.length} entries)</h3>
      <p class="mut">Every login, bill, payment, cash hand-over, deposit, change of rates or accounts, reprint and export is recorded here with who and when.
      Nobody can edit or delete entries. The latest 5,000 are kept; export the log as CSV regularly.</p>
      <div class="filters">
        <input id="lq" ${refresh} placeholder="Search action, account, detail">
        <select id="lu" ${refresh}><option value="">All users</option>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select>
        <select id="lr" ${refresh}><option value="">All results</option><option value="ok">OK</option><option value="fail">Failed / blocked</option></select>
        <label class="inl">From <input id="lf" type="date" ${refresh}></label><label class="inl">To <input id="lt" type="date" ${refresh}></label>
      </div>
      <button class="s" onclick="exportAudit()">Export CSV</button>
      <div class="tw"><table><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th><th>Result</th></tr><tbody id="audRows">${auditRows()}</tbody></table></div></div>`;
}
function exportAudit() {
  if (!user || user.role !== 'admin') return;
  audit('AUDIT LOG EXPORTED', 'CSV');
  downloadText('audit-log-' + today() + '.csv', toCsv([['time', 'user', 'role', 'action', 'target', 'detail', 'ok'],
    ...DATA.audit.map(e => [e.ts, e.user, e.role, e.action, e.target, e.detail, e.ok])]));
}

/* ======================================================================
   Reports (Settings > Reports for the admin; menu item for teller and cashier)
   ====================================================================== */
const reportPayments = () => DATA.payments.filter(p => payDay(p) === reportDate && (user.role !== 'teller' || p.teller === user.name));

function zoneSummaryRows() {
  return ZONES.map(z => {
    const bills = DATA.bills.filter(b => (b.zone || (customerOf(b.account) || {}).zone) === z && (b.readingDate || '').slice(0, 7) === reportMonth);
    const unpaid = sumOf(bills.filter(isOpen), b => amountDueOn(b));
    return [zoneLabel(z), customersInZone(z).length, bills.length, sumOf(bills, b => Number(b.consumption) || 0), money(sumOf(bills, b => b.total)), money(sumOf(bills, b => b.paid || 0)), money(unpaid)];
  });
}

function reportsBody() {
  const pays = reportPayments();
  const nameOf = account => (customerOf(account) || { name: '' }).name;
  const rows = pays.map(p => `<tr><td>${esc(p.or)}</td><td>${esc(p.account)}</td><td>${esc(nameOf(p.account))}</td><td>${esc(billingMonthLabel(DATA.bills.find(b => b.no === p.billNo) || {}))}</td><td>${money(p.amountPaid)}</td><td>${esc(p.teller)}</td></tr>`).join('');
  const cash = DATA.remittances.filter(r => toIso(new Date(r.date)) === reportDate && (user.role !== 'teller' || r.teller === user.name));
  const deps = user.role === 'teller' ? [] : DATA.deposits.filter(d => toIso(new Date(d.date)) === reportDate);
  const month = new Date(reportMonth + '-01T00:00:00').toLocaleDateString('en', { month: 'long', year: 'numeric' });
  return `<div class="card"><h3>Daily collection report</h3>
      <label>Date${datePicker('rpd', reportDate, 'setReportDate()')}<span id="rpdHint" class="field-hint" aria-live="polite"></span></label>
      <div class="g"><div class="st"><b>${pays.length}</b><span>Receipts</span></div><div class="st"><b>${money(sumOf(pays, p => p.amountPaid))}</b><span>Total collected (PHP)</span></div></div>
      <div class="tw"><table><tr><th>OR no.</th><th>Account</th><th>Name</th><th>Billing month</th><th>Amount</th><th>Teller</th></tr>
        ${rows || '<tr><td colspan="6" class="mut">No payments on this date.</td></tr>'}</table></div>
      <button class="p" onclick="printCollectionReport()">Print / Save as PDF</button>
      <button class="s" onclick="exportCollectionCsv()">Export CSV</button></div>
    <div class="card"><h3>Cash hand-over and deposits on ${esc(fmtDate(reportDate))}</h3>
      <div class="tw"><table><tr><th>Hand-over no.</th><th>Teller</th><th>Receipts</th><th>Total</th><th>Counted</th><th>Status</th></tr>
        ${cash.map(r => `<tr><td>${r.id}</td><td>${esc(r.teller)}</td><td>${r.receipts.length}</td><td>${money(r.total)}</td><td>${r.counted == null ? '' : money(r.counted)}</td><td class="${r.status}">${r.status}</td></tr>`).join('') || '<tr><td colspan="6" class="mut">No hand-overs on this date.</td></tr>'}</table></div>
      ${user.role === 'teller' ? '' : `<div class="tw"><table><tr><th>Deposit no.</th><th>Bank</th><th>Slip no.</th><th>Amount</th></tr>
        ${deps.map(d => `<tr><td>${d.id}</td><td>${esc(d.bank)}</td><td>${esc(d.reference)}</td><td>${money(d.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">No deposits on this date.</td></tr>'}</table></div>`}</div>
    <div class="card"><h3>Billing summary by zone</h3>
      <label>Reading month<input type="month" value="${esc(reportMonth)}" max="${today().slice(0, 7)}" onchange="setReportMonth(this.value)"></label>
      <div class="tw"><table><tr><th>Zone</th><th>Consumers</th><th>Bills</th><th>Usage (cu.m)</th><th>Billed (PHP)</th><th>Paid (PHP)</th><th>Unpaid (PHP)</th></tr>
        ${zoneSummaryRows().map(r => '<tr>' + r.map(x => `<td>${esc(x)}</td>`).join('') + '</tr>').join('')}</table></div>
      <button class="p" onclick="printZoneSummary()">Print / Save as PDF for ${esc(month)}</button></div>`;
}
VIEWS.reports = () => (user.role === 'teller' || user.role === 'cashier') ? reportsBody() : '<div class="card"><p class="mut">Reports for the administrator are in Settings.</p></div>';

function setReportDate() {
  const v = $('#rpd').value, hint = $('#rpdHint');
  if (!v) return;                                   // still typing
  if (v > today()) { if (hint) hint.textContent = 'The report date cannot be in the future.'; return; }
  reportDate = v;
  render();
}
function setReportMonth(v) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || v > today().slice(0, 7)) return;
  reportMonth = v;
  render();
}
function printCollectionReport() {
  const pays = reportPayments();
  audit('REPORT PRINTED', 'collections ' + reportDate);
  printDoc('Daily collection report - ' + fmtDate(reportDate), printTable(['OR no.', 'Account', 'Name', 'Amount (PHP)', 'Teller'],
    pays.map(p => [p.or, p.account, (customerOf(p.account) || {}).name || '', money(p.amountPaid), p.teller]), ['Total', '', '', money(sumOf(pays, p => p.amountPaid)), '']));
}
function exportCollectionCsv() {
  const pays = reportPayments();
  audit('REPORT EXPORTED', 'collections ' + reportDate);
  downloadText(`collections-${reportDate}.csv`, toCsv([['OR no', 'account', 'name', 'billing month', 'amount', 'teller'],
    ...pays.map(p => [p.or, p.account, (customerOf(p.account) || {}).name || '', billingMonthLabel(DATA.bills.find(b => b.no === p.billNo) || {}), p.amountPaid, p.teller])]));
}
function printZoneSummary() {
  audit('REPORT PRINTED', 'zone summary ' + reportMonth);
  printDoc('Billing summary by zone - ' + reportMonth, printTable(['Zone', 'Consumers', 'Bills', 'Usage (cu.m)', 'Billed (PHP)', 'Paid (PHP)', 'Unpaid (PHP)'], zoneSummaryRows()));
}

/* ======================================================================
   My Profile (admin via Settings; other roles via menu)
   ====================================================================== */
VIEWS.profile = () => {
  const account = USERS[user.username];
  const info = staffInfo(user.role);
  const isAdmin = user.role === 'admin';
  let accepted = null;
  try { accepted = JSON.parse(localStorage.getItem(TERMS_ACCEPTANCE_KEY) || '[]').filter(a => a.username === user.username).pop(); } catch (e) { /* ignore */ }
  const mine = DATA.audit.filter(e => e.user === user.username).slice(-15).reverse()
    .map(e => `<tr><td>${esc(fmtDateTime(e.ts))}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td class="${e.ok ? 'Paid' : 'Unpaid'}">${e.ok ? 'OK' : 'Failed'}</td></tr>`).join('');
  const pw = (id, label, auto) => `<label for="${id}">${label}</label><div class="password-field"><input id="${id}" type="password" autocomplete="${auto}" minlength="8" maxlength="10" oninput="$('#profileMsg').textContent=''"><button type="button" class="password-toggle" aria-label="Show password" title="Show password" onclick="togglePasswordVisibility('${id}',this)">${passwordVisibilityIcon(false)}</button></div>`;
  return `<div class="card"><h3>My profile</h3><div class="tw"><table>
      <tr><th>Name</th><td>${esc(user.name)}</td></tr>
      <tr><th>Role</th><td>${esc(roleName(user.role))}</td></tr>
      <tr><th>Username</th><td>${esc(account ? account.username : user.username)}</td></tr>
      <tr><th>Previous login</th><td>${info.previousLogin ? esc(fmtDateTime(info.previousLogin)) : '<span class="mut">first login on this device</span>'}</td></tr>
      <tr><th>Password last changed</th><td>${info.passwordChangedAt ? esc(fmtDateTime(info.passwordChangedAt)) : '<span class="mut">not changed</span>'}</td></tr>
      <tr><th>Terms &amp; Privacy Notice</th><td>${accepted ? `accepted ${esc(fmtDateTime(accepted.acceptedAt))} (version ${esc(accepted.version)})` : '<span class="mut">no record</span>'}</td></tr>
    </table></div></div>
    ${isAdmin ? `<div class="card"><h3>Change my password</h3>
      ${pw('pf0', 'Current password', 'current-password')}${pw('pf1', 'New password (8–10 characters)', 'new-password')}${pw('pf2', 'Repeat new password', 'new-password')}
      <p id="profileMsg" class="form-error" role="alert" aria-live="polite"></p>
      <button class="p" onclick="changeOwnPassword()">Save new password</button></div>` : ''}
    <div class="card"><h3>My recent activity</h3><div class="tw"><table><tr><th>When</th><th>Action</th><th>Target</th><th>Result</th></tr>
      ${mine || '<tr><td colspan="4" class="mut">Nothing yet.</td></tr>'}</table></div></div>`;
};

function changeOwnPassword() {
  if (!user || user.role !== 'admin') {
    appAlert('Only the administrator can change user passwords.');
    return;
  }
  const msg = $('#profileMsg');
  const fail = text => { msg.className = 'form-error'; msg.textContent = text; };
  const current = $('#pf0').value, next = $('#pf1').value, again = $('#pf2').value;
  const account = USERS[user.username];
  if (!account) return fail('Your account was not found. Log in again.');
  if (!current || !next || !again) return fail('Fill in all three password fields.');
  if (current !== account.password) { audit('PASSWORD CHANGE FAILED', user.username, 'wrong current password', false); return fail('Your current password is not correct.'); }
  if (next.length < 8 || next.length > 10) return fail('The new password must be 8–10 characters.');
  if (next === current) return fail('The new password must be different from the current one.');
  if (next !== again) return fail('The two new passwords do not match.');
  const accounts = {};
  Object.values(USERS).forEach(u => { accounts[u.role] = { username: u.username, password: u.role === user.role ? next : u.password }; });
  if (!saveUsers(accounts)) return fail('Could not save the new password on this device.');
  staffInfo(user.role).passwordChangedAt = new Date().toISOString();
  audit('PASSWORD CHANGED', user.username);
  ['pf0', 'pf1', 'pf2'].forEach(id => { $('#' + id).value = ''; });
  msg.className = 'form-success';
  msg.textContent = 'Password changed.';
}
