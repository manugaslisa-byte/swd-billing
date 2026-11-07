# What was added to the original SWD Billing

Nothing of the original was removed (login with Terms, consumers, per-month bills, pay-all, date picker, printing, CSV import).

New file: js/admin.js. Small hooks in storage.js, billing.js, csv.js, views.js, app.js.

- Settings is now a hub (admin): Rates & Rules | Staff Accounts | Audit Log | Reports | Backup | My Profile
- Staff Accounts: last login, password-changed date, lock status, Unlock button (+ the original username/password form)
- Audit Log: logins, bills, payments, hand-overs, deposits, rates, accounts, reprints, imports, backups; filters + CSV export
- Reports: daily collections (print/PDF/CSV), cash hand-over and deposits per day, billing summary by zone. Teller and Cashier get a Reports menu too.
- My Profile (all roles): details, change own password, own recent activity; admins open it in Settings, other roles use the My Profile menu
- Login protection: 5 wrong passwords lock the login for 5 minutes; 15-minute idle log-out
