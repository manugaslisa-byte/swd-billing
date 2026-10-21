/* ======================================================================
   billing.js - the business rules (no screens here)
   Bills:    computeAmount, amountDueOn, generateBill
   Payments: recordPayment                       (Teller, at the office)
   Cash:     turnOverCollections, receiveRemittance, recordDeposit
             (Teller -> Cashier -> Bank, as in the district's process)
   ====================================================================== */

const isOpen = bill => bill.status === 'Unpaid' || bill.status === 'Partial';
const customerOf = account => DATA.customers.find(c => c.account === account);
const openBillOf = account => DATA.bills.find(b => b.account === account && isOpen(b));
const rateOf = classification => DATA.config.rates.find(r => r.classification === classification);
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
function generateBill({ account, present, readingDate, allowLower, readBy, remarks = '' }) {
  const cfg = DATA.config;
  const customer = customerOf(account);
  if (!customer) throw new Error('Customer not found.');
  if (!Number.isInteger(present) || present < 0 || !readingDate) {
    throw new Error('Enter a whole-number present reading and a reading date.');
  }
  if (present < customer.lastReading && !allowLower) {
    throw new Error('Present reading is lower than the previous reading.');
  }

  const consumption = Math.max(0, present - customer.lastReading);
  const amount = computeAmount(consumption, customer.classification);   // may throw (rate not set)
  const rate = rateOf(customer.classification);

  // Any unpaid balance of the previous bill is carried over as arrears
  const previousOpen = openBillOf(account);
  let arrears = 0;
  if (previousOpen) {
    arrears = amountDueOn(previousOpen, readingDate);
    previousOpen.status = 'Rolled';
  }

  const total = round2(amount + arrears);
  const lastBill = [...DATA.bills].reverse().find(b => b.account === account);
  const number = nextNumber(cfg.nextBill, DATA.bills, 'no');

  const bill = {
    no: String(number).padStart(7, '0'),
    account,
    classification: customer.classification,
    periodFrom: lastBill ? lastBill.readingDate : addDays(readingDate, -30),
    readingDate,
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
    readBy
  };

  cfg.nextBill = number + 1;
  DATA.bills.push(bill);
  customer.lastReading = present;
  saveData();
  return bill;
}

/* The teller records a payment made at the office. A smaller payment makes
   the bill "Partial"; a full payment makes it "Paid". */
function recordPayment({ account, tendered, teller }) {
  const cfg = DATA.config;
  const bill = openBillOf(account);
  if (!bill) throw new Error('This account has no outstanding bill.');
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
  saveData();
  return payment;
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
  saveData();
  return remittance;
}

/* Step 2 (cashier): count the cash from the teller and receive it. Status: Received */
function receiveRemittance(id, counted, cashier) {
  const remittance = DATA.remittances.find(r => r.id === id);
  if (!remittance || remittance.status !== 'Pending') throw new Error('This turn-over is not waiting to be received.');
  counted = round2(counted);
  if (!(counted >= 0)) throw new Error('Enter the amount counted.');
  Object.assign(remittance, { status: 'Received', counted, receivedBy: cashier, receivedDate: new Date().toISOString() });
  saveData();
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
  saveData();
  return deposit;
}
