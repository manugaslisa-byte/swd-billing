/* ======================================================================
   billing.js - the business rules (no screens here)
   Bills:    computeAmount, amountDueOn, generateBill
   Payments: recordPayment                       (Teller, at the office)
   Cash:     turnOverCollections, receiveRemittance, recordDeposit
             (Teller -> Cashier -> Bank, as in the district's process)
   ====================================================================== */

const isOpen = bill => bill.status === 'Unpaid' || bill.status === 'Partial';
const customerOf = account => DATA.customers.find(c => c.account === account);
const hasMeterReading = value => value !== null && value !== undefined && String(value).trim() !== ''
  && Number.isInteger(Number(value)) && Number(value) >= 0;
const hasPreviousReading = customer => !!customer && hasMeterReading(customer.lastReading);
const openBillsOf = account => DATA.bills
  .filter(b => b.account === account && isOpen(b))
  .sort((a, b) => a.readingDate.localeCompare(b.readingDate) || a.no.localeCompare(b.no));
const openBillOf = account => openBillsOf(account)[0];
const rateOf = classification => DATA.config.rates.find(r => r.classification === classification);
/* ---------- Archive: customers who did not pay ----------
   Nothing is stored for the archive. A customer is "in the archive" while he
   has an open (Unpaid / Partial) bill and today is past the disconnection date.
   When a bill is paid in full that bill is removed from the list automatically. */
const archiveSince = bill => bill.overdueSince || bill.disconnectionDate;
const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000);
const isArchived = account => openBillsOf(account).some(b => today() > archiveSince(b));

/* Archived customers, the longest-unpaid first */
function archivedAccounts(date = today()) {
  return DATA.bills
    .filter(b => isOpen(b) && date > archiveSince(b) && customerOf(b.account))
    .map(b => ({ customer: customerOf(b.account), bill: b, since: archiveSince(b),
                 days: daysBetween(archiveSince(b), date), due: amountDueOn(b, date) }))
    .sort((a, b) => b.days - a.days || b.due - a.due);
}

const nextNumber = (start, list, field) => Math.max(start, ...list.map(x => Number(x[field]) + 1));

/* Amount = minimum charge of the customer's classification
          + (cu.m in each block x that block's rate).
   Example, Domestic/Government, 25 cu.m:
          154.00 + 10 x 16.50 (11-20) + 5 x 17.90 (21-25) = 408.50 */
function computeAmount(consumption, classification) {
  const cfg = DATA.config;
  const rate = rateOf(classification);
  if (!rate || rate.minimum == null) {
    throw new Error(`The minimum charge for ${classification} is not set. Ask the administrator to enter it in Settings.`);
  }
  let amount = rate.minimum;
  let remaining = Math.max(0, consumption - cfg.minimumCubicMeters);
  for (let i = 0; i < BLOCKS.length && remaining > 0; i++) {
    if (rate.blocks[i] == null) {
      throw new Error(`The rate for ${BLOCKS[i].label} cu.m is not set for ${classification}. Ask the administrator to enter it in Settings.`);
    }
    const used = Math.min(remaining, BLOCKS[i].size);
    amount += used * rate.blocks[i];
    remaining -= used;
  }
  return round2(amount);
}

/* After the due date the amount with the late charge applies. */
function amountDueOn(bill, date = today()) {
  const payable = date > bill.dueDate ? bill.totalAfterDue : bill.total;
  return Math.max(0, round2(payable - bill.paid));
}

/* Creates a bill from a meter reading. Throws an Error with a message that
   the screen shows to the user when something is wrong. */
function generateBill({ account, present, readingDate, readBy, remarks = '' }) {
  const cfg = DATA.config;
  const customer = customerOf(account);
  if (!customer) throw new Error('Customer not found.');
  if (!hasPreviousReading(customer)) {
    throw new Error('Cannot generate a bill: this consumer has no valid starting meter reading. Enter the meter reading at connection first.');
  }
  if (!Number.isInteger(present) || present < 0 || !readingDate) {
    throw new Error('Enter a whole-number present reading and a reading date.');
  }
  if (present < customer.lastReading) {
    throw new Error('Present reading is lower than the previous reading.');
  }
  if (DATA.bills.some(b => b.account === account && b.readingDate.slice(0, 7) === readingDate.slice(0, 7))) {
    throw new Error('A bill for this consumer already exists for that month.');
  }

  const consumption = Math.max(0, present - customer.lastReading);
  const amount = computeAmount(consumption, customer.classification);   // may throw (rate not set)
  const rate = rateOf(customer.classification);

  const arrears = 0;
  const total = amount;
  const lastBill = [...DATA.bills].reverse().find(b => b.account === account);
  const number = nextNumber(cfg.nextBill, DATA.bills, 'no');

  const bill = {
    no: String(number).padStart(7, '0'),
    account,
    classification: customer.classification,
    periodFrom: lastBill ? lastBill.readingDate : customer.connectionStartDate || addDays(readingDate, -30),
    readingDate,
    billingMonth: readingDate.slice(0, 7),
    previous: customer.lastReading,
    present,
    consumption,
    minimumCharge: rate.minimum,
    amount,
    arrears,
    total,                                                    // pay on or before the due date
    latePercent: rate.latePercent,
    totalAfterDue: round2(total * (1 + rate.latePercent / 100)),
    dueDate: addDays(readingDate, cfg.dueDays),
    disconnectionDate: addDays(readingDate, cfg.disconnectionDays),
    paid: 0,
    status: 'Unpaid',                                         // Unpaid, Partial, Paid, Rolled
    remarks,
    readBy,
    zone: customer.zone || '',                                // zone (barangay) of the customer
    overdueSince: null
  };

  cfg.nextBill = number + 1;
  DATA.bills.push(bill);
  customer.lastReading = present;
  audit('BILL CREATED', bill.no, `acct ${account}, ${consumption} cu.m, PHP ${money(total)}`);
  return bill;
}

/* The teller records a payment made at the office. A smaller payment makes
   the bill "Partial"; a full payment makes it "Paid". */
function recordPayment({ account, billNo, tendered, teller }) {
  const cfg = DATA.config;
  const bill = DATA.bills.find(b => b.no === billNo && b.account === account && isOpen(b));
  if (!bill) throw new Error('Select an unpaid monthly bill for this consumer.');
  tendered = round2(tendered);
  if (!(tendered > 0)) throw new Error('Enter the amount tendered.');

  const due = amountDueOn(bill);
  const applied = Math.min(tendered, due);
  bill.paid = round2(bill.paid + applied);
  const balance = amountDueOn(bill);
  bill.status = balance <= 0 ? 'Paid' : 'Partial';

  const number = nextNumber(cfg.nextReceipt, DATA.payments, 'or');
  const payment = {
    or: String(number).padStart(6, '0'),
    account,
    billNo: bill.no,
    amountDue: due,
    amountPaid: applied,
    tendered,
    change: round2(tendered - applied),
    balance,
    date: new Date().toISOString(),
    teller,
    remittanceId: null            // filled when the teller turns the cash over
  };
  cfg.nextReceipt = number + 1;
  DATA.payments.push(payment);
  audit('PAYMENT RECORDED', payment.or, `acct ${account}, bill ${bill.no}, PHP ${money(applied)}`);
  return payment;
}

/* Applies one tendered amount to the selected open months, oldest first.
   The amount may be short (leaving later months unpaid) or exceed the total
   due (the excess is returned as change on the final receipt). */
function recordPayments({ account, billNos, tendered, teller }) {
  const bills = [...new Set(billNos)]
    .map(no => DATA.bills.find(b => b.no === no && b.account === account && isOpen(b)))
    .filter(Boolean)
    .sort((a, b) => a.readingDate.localeCompare(b.readingDate) || a.no.localeCompare(b.no));
  if (!bills.length || bills.length !== new Set(billNos).size) {
    throw new Error('One or more selected monthly bills are no longer unpaid.');
  }
  tendered = round2(tendered);
  if (!(tendered > 0)) throw new Error('Enter the amount tendered.');

  const payments = [];
  let remaining = tendered;
  for (let i = 0; i < bills.length && remaining > 0; i++) {
    const due = amountDueOn(bills[i]);
    const appliedTender = Math.min(remaining, due);
    const receiptTender = i === bills.length - 1 ? appliedTender + Math.max(0, remaining - appliedTender) : appliedTender;
    payments.push(recordPayment({
      account,
      billNo: bills[i].no,
      tendered: receiptTender,
      teller
    }));
    remaining = round2(remaining - appliedTender);
  }
  return payments;
}

/* ---------- Teller -> Cashier -> Bank ---------- */

// payments of this teller that were not yet turned over to the cashier
const uncollectedBy = teller => DATA.payments.filter(p => p.teller === teller && !p.remittanceId);

/* Step 1 (teller): turn all collections over to the cashier. Status: Pending */
function turnOverCollections(teller) {
  const cfg = DATA.config;
  const list = uncollectedBy(teller);
  if (!list.length) throw new Error('There are no collections to turn over.');
  const number = nextNumber(cfg.nextRemittance, DATA.remittances, 'id');
  const remittance = {
    id: String(number).padStart(5, '0'),
    teller,
    date: new Date().toISOString(),
    receipts: list.map(p => p.or),
    total: sumOf(list, p => p.amountPaid),
    status: 'Pending',            // Pending -> Received -> Deposited
    counted: null, receivedBy: null, receivedDate: null, depositId: null
  };
  list.forEach(p => { p.remittanceId = remittance.id; });
  cfg.nextRemittance = number + 1;
  DATA.remittances.push(remittance);
  audit('CASH TURNED OVER', remittance.id, `PHP ${money(remittance.total)}, ${list.length} receipts`);
  return remittance;
}

/* Step 2 (cashier): count the cash from the teller and receive it. Status: Received */
function receiveRemittance(id, counted, cashier) {
  const remittance = DATA.remittances.find(r => r.id === id);
  if (!remittance || remittance.status !== 'Pending') throw new Error('This turn-over is not waiting to be received.');
  counted = round2(counted);
  if (!(counted >= 0)) throw new Error('Enter the amount counted.');
  Object.assign(remittance, { status: 'Received', counted, receivedBy: cashier, receivedDate: new Date().toISOString() });
  audit('CASH RECEIVED', remittance.id, `counted PHP ${money(counted)}, expected PHP ${money(remittance.total)}`);
  return remittance;
}

/* Step 3 (cashier): deposit all received collections in the bank. Status: Deposited */
function recordDeposit({ bank, reference, cashier }) {
  const cfg = DATA.config;
  const list = DATA.remittances.filter(r => r.status === 'Received');
  if (!list.length) throw new Error('There are no received collections to deposit.');
  if (!bank || !reference) throw new Error('Enter the bank and the deposit slip number.');
  const number = nextNumber(cfg.nextDeposit, DATA.deposits, 'id');
  const deposit = {
    id: String(number).padStart(5, '0'),
    date: new Date().toISOString(),
    bank, reference,
    remittanceIds: list.map(r => r.id),
    amount: sumOf(list, r => r.counted),
    by: cashier
  };
  list.forEach(r => { r.status = 'Deposited'; r.depositId = deposit.id; });
  cfg.nextDeposit = number + 1;
  DATA.deposits.push(deposit);
  audit('DEPOSIT RECORDED', deposit.id, `${bank}, slip ${reference}, PHP ${money(deposit.amount)}`);
  return deposit;
}
