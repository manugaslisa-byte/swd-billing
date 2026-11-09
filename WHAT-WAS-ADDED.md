# What was added to the original SWD Billing

Nothing of the original was removed (login with Terms, consumers, per-month bills, pay-all, date picker, printing, CSV import).

New file: js/admin.js. Small hooks in storage.js, billing.js, csv.js, views.js, app.js.

- Settings is now a hub (admin): Rates & Rules | Staff Accounts | Audit Log | Reports | Backup | My Profile
- Staff Accounts: last login, password-changed date, lock status, Unlock button (+ the original username/password form)
- Audit Log: logins, bills, payments, hand-overs, deposits, rates, accounts, reprints, imports, backups; filters + CSV export
- Reports: daily collections (print/PDF/CSV), cash hand-over and deposits per day, billing summary by zone. Teller and Cashier get a Reports menu too.
- My Profile (all roles): details and own recent activity; only the administrator can change staff passwords in Settings.
- Role-specific dashboards and access: Administrator has full operational and management access; Teller uses Consumers, Payments, and Turn Over; Cashier uses Deposits; Meter Reader uses Consumers (view only) and Meter Reading to read meters and print bills. Each staff role also has access to their own profile.
- Login protection: 5 wrong passwords lock the login for 5 minutes; 15-minute idle log-out
