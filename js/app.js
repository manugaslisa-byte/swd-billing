/* ======================================================================
   app.js - start-up: login, menu, drawing the current screen, install as app
   ====================================================================== */

/* ---------- screen state (shared with views.js) ---------- */
let user = null;               // { name, role } after login
let tab = 'dash';              // which screen is open
let selected = null;           // account number picked in Meter Reading / Payments
let lastBill = null;           // bill just generated (shown with print buttons)
let lastReceipt = null;        // receipt just generated
let reprintText = '';          // bill/receipt chosen for reprint in Records
let recordsTab = 'bills';      // Records: 'bills' or 'payments'
let chosenRole = 'reader';     // role button picked on the login screen
let installEvent = null;       // browser's "install app" offer

// What each role may open
const MENU = {
  admin:   ['dash', 'customers', 'read', 'pay', 'turnover', 'deposit', 'records', 'settings'],
  reader:  ['dash', 'customers', 'read', 'records'],
  teller:  ['dash', 'customers', 'pay', 'turnover', 'records'],
  cashier: ['dash', 'deposit', 'records']
};
const TAB_NAMES = {
  dash: 'Dashboard', customers: 'Customers', read: 'Meter Reading', pay: 'Payments',
  turnover: 'Turn Over', deposit: 'Deposits', records: 'Records', settings: 'Settings'
};

/* ---------- login ---------- */
function chooseRole(role) {
  const typed = $('#u') ? $('#u').value : '';
  chosenRole = role;
  render();
  $('#u').value = typed;
}

function login() {
  const username = $('#u').value.trim().toLowerCase();
  const account = USERS[username];
  if (!account || account.password !== $('#w').value) return alert('Wrong username or password.');
  if (account.role !== chosenRole) {
    return alert('This account is not a ' + ROLE_NAMES[chosenRole] + ' account. Choose the correct role above.');
  }
  user = { name: account.name, role: account.role };
  tab = 'dash';
  render();
}

function logout() { user = null; selected = lastBill = lastReceipt = null; reprintText = ''; render(); }

function go(name) {
  tab = name;
  selected = lastBill = lastReceipt = null;
  reprintText = '';
  render();
}

/* ---------- "Install app" button ---------- */
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
  render();
});
const installButton = () => installEvent
  ? '<button class="s" style="margin:0 8px 0 0" onclick="installEvent.prompt();installEvent=null;render()">Install app</button>' : '';

/* ---------- draw the page ---------- */
function render() {
  const app = $('#app');

  if (!user) {                                          // login screen
    const roleButtons = Object.keys(ROLE_NAMES)
      .map(r => `<button class="${r === chosenRole ? 'on' : ''}" onclick="chooseRole('${r}')">${ROLE_NAMES[r]}</button>`).join('');
    app.innerHTML = `<div id="login" class="card"><h3>SWD Portable Billing</h3>
      <p class="mut">Sindangan Water District. Sign in as:</p>
      <div class="seg">${roleButtons}</div>
      <label>Username<input id="u" autocomplete="off"></label>
      <label>Password<input id="w" type="password"></label>
      <button class="p" onclick="login()">Log in</button> ${installButton()}
      <p class="mut" style="font-size:12px">Demo for ${ROLE_NAMES[chosenRole]}: ${chosenRole} / ${USERS[chosenRole].password}</p></div>`;
    return;
  }

  const menu = MENU[user.role].map(t => `<button class="${t === tab ? 'on' : ''}" onclick="go('${t}')">${TAB_NAMES[t]}</button>`).join('');
  app.innerHTML = `<header><div><b>Sindangan Water District</b><small>${esc(user.name)} | This device only</small></div>
      <span>${installButton()}<button onclick="logout()">Log out</button></span></header>
    <nav>${menu}</nav>
    <main>${VIEWS[tab]()}</main>`;
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode just won't be available */ });
}
render();
