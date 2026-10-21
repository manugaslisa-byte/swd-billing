/* ======================================================================
   csv.js - bulk upload of customers from a CSV file
   Columns: account no., name, address, meter no., meter size, last reading,
   classification (with or without a header row). In Excel: Save As > CSV.
   ====================================================================== */

let importPreview = null;          // what the file contains, shown before saving
let importUpdateExisting = false;  // tick box: update customers that already exist

/* Reads CSV text into rows of cells. Handles quotes ("DELA CRUZ, JUAN"),
   commas / semicolons / tabs, and Excel's hidden BOM character. */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delimiter = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(x => x.trim() !== '')) rows.push(row);
  return rows;
}

/* Turns what was typed ("domestic", "Commercial B", "bulk") into the exact
   classification name, or null when it is not recognised. Blank = default. */
function normalizeClassification(text) {
  const t = text.trim().toLowerCase();
  if (!t) return DEFAULT_CLASS;
  const exact = DATA.config.rates.find(r => r.classification.toLowerCase() === t);
  if (exact) return exact.classification;
  const letter = t.match(/commercial\s*([abcd])\b/);
  if (letter) return 'Commercial ' + letter[1].toUpperCase();
  if (/^(commercial|industrial)/.test(t)) return 'Commercial/Industrial';
  if (/bulk/.test(t)) return 'Bulk Sales';
  if (/^(domestic|government|residential)/.test(t)) return 'Domestic/Government';
  return null;
}

/* Checks every row and sorts them into valid and invalid. Nothing is saved yet. */
function buildPreview(rows) {
  let col = { account: 0, name: 1, address: 2, meter: 3, size: 4, reading: 5, classification: 6 };
  let start = 0;
  const head = rows[0].map(x => x.trim().toLowerCase());
  if (head.some(x => /acc|name|meter|class/.test(x))) {      // first row is a header
    start = 1;
    col = {};
    head.forEach((x, i) => {
      if (/read|last/.test(x)) col.reading = i;
      else if (/size/.test(x)) col.size = i;
      else if (/meter/.test(x)) col.meter = i;
      else if (/addr/.test(x)) col.address = i;
      else if (/class/.test(x)) col.classification = i;
      else if (/acc/.test(x)) col.account = i;
      else if (/name/.test(x)) col.name = i;
    });
    if (col.account == null || col.name == null || col.meter == null) {
      throw new Error('The header row needs account no., name and meter no. columns.');
    }
  }
  const valid = [], invalid = [];
  let newCount = 0, existingCount = 0;
  rows.slice(start).forEach((cells, i) => {
    const get = key => col[key] == null ? '' : (cells[col[key]] || '').trim();
    const rowNo = i + 1 + start;
    const account = get('account'), name = get('name').toUpperCase(), meter = get('meter'), reading = get('reading');
    const classification = normalizeClassification(get('classification'));
    if (!account || !name || !meter) return invalid.push({ rowNo, reason: 'account no., name and meter no. are required' });
    if (reading !== '' && !/^\d+$/.test(reading)) return invalid.push({ rowNo, reason: 'last reading must be a whole number' });
    if (!classification) return invalid.push({ rowNo, reason: 'unknown classification "' + get('classification') + '"' });
    valid.push({
      customer: { account, name, address: get('address').toUpperCase(), meter, size: get('size') || '1/2', classification, lastReading: Number(reading) || 0 },
      hasReading: reading !== ''
    });
    customerOf(account) ? existingCount++ : newCount++;
  });
  return { valid, invalid, newCount, existingCount };
}

function readCustomerFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(reader.result); }
    catch (e) { text = new TextDecoder('windows-1252').decode(reader.result); }   // older Excel files
    const rows = parseCSV(text);
    if (!rows.length) return alert('The file is empty.');
    try { importPreview = buildPreview(rows); } catch (e) { return alert(e.message); }
    render();
  };
  reader.readAsArrayBuffer(file);
}

function applyImport() {
  if (!importPreview) return;
  let added = 0, updated = 0, skipped = 0;
  importPreview.valid.forEach(({ customer, hasReading }) => {
    const existing = customerOf(customer.account);
    if (!existing) { DATA.customers.push(customer); added++; }
    else if (importUpdateExisting) {
      Object.assign(existing, { name: customer.name, address: customer.address, meter: customer.meter, size: customer.size, classification: customer.classification });
      if (hasReading) existing.lastReading = customer.lastReading;
      updated++;
    } else skipped++;
  });
  const problems = importPreview.invalid.length;
  saveData();
  importPreview = null;
  render();
  alert(`Import finished: ${added} added, ${updated} updated, ${skipped} skipped (already exist), ${problems} with problems.`);
}

function downloadTemplate() {
  const text = 'account_no,name,address,meter_no,meter_size,last_reading,classification\n' +
               '081-102-003,"DELA CRUZ, JUAN",DATU TANGKILAN SINDANGAN,14120293,1/2,2760,Domestic/Government\n' +
               '061-102-500,LIM TRADING,PUROK 3 SINDANGAN,14070011,3/4,120,Commercial/Industrial\n';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  link.download = 'customers_template.csv';
  link.click();
}
