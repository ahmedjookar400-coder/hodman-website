# Hodman Restaurant

The first implementation foundation for the Hodman Restaurant public website and staff workspace.

## Run locally

Requires Node.js 22.5 or newer. No package installation is required; the server uses Node's built-in HTTP and SQLite modules.

On Windows, double-click **Open Hodman Website.bat** in this folder. It starts the local server if needed and opens the website in your browser. Keep the server window open while using the site. To stop it, press Ctrl+C in that window.

Do not open `public/index.html` directly from File Explorer: online ordering, the menu, and the staff workspace need the local server.

```powershell
node server.js
```

Open `http://localhost:3000`. On the first visit to `/admin.html`, create the administrator account with a username, email address, and a unique password with at least 8 characters. Staff sign in with their username and password; existing email sign-in remains supported. The local SQLite database is created at `data/hodman.sqlite`.

If the administrator forgets their login, double-click **Reset Hodman Admin Password.bat** in this folder. It lists active administrator accounts and lets the owner choose a new username and password locally. Password characters are hidden while typing, existing sessions for that administrator are revoked, and the reset is recorded in the audit log. The old password cannot be recovered.

Set `PORT` to change the local port, `HODMAN_HOST` to change the bind address, or `HODMAN_DB_PATH` to choose a different database file. The app binds to localhost by default. For a hosted deployment, place it behind HTTPS and a reverse proxy, set `NODE_ENV=production`, and do not expose the development server directly to the public internet.

## Implemented in this first pass

- Hodman-branded, responsive customer website with menu search and category filters.
- Public dine-in, takeaway, and delivery order submission with server-side menu pricing; order tracking by order number and phone.
- Reservation requests with staff confirmation/decline.
- First-admin setup, staff sign-in, password hashing, expiring sessions, and role checks.
- Staff dashboard, POS, table status board, order queue, kitchen ticket screen, browser printing, order status transitions, and manual payment recording including partial/split payments.
- Menu categories and dishes, availability toggles, ingredients, stock adjustments, recipes, supplier purchasing, and configurable stock deduction at order placement, full payment, or completion. Short stock blocks the order and cancelled unpaid orders restore already deducted ingredients.
- External delivery partner registration, admin approval, offer-to-partner flow, claiming ready deliveries, and delivery completion.
- Customer list, expenses, summary reports, role-separated staff views, and an audit history viewer.
- Supplier directory, purchase orders, receiving to ingredient stock, and inventory movement history.
- Branch profile seeded for Hodman in Albarako, MPC, Mogadishu; USD and `Africa/Mogadishu` defaults.

## Integration and next development work

Online card or EVC-Plus collection is not connected to a payment provider yet. Staff can record a payment after confirming it through their provider, including its reference. A real EVC-Plus/Somali mobile money checkout needs Hodman's merchant account and the selected provider's current API credentials and callback details. Do not put those credentials in browser code.

The first pass does not yet include table transfers/merging or open-bill splitting, supplier invoice/payment reconciliation, customer logins and full lifetime profiles, payment refunds, automated customer notifications, direct printer discovery/printing, SMS/WhatsApp, advanced reports, automated backups, or a hosted production deployment. Kitchen tickets can be printed from the browser to the configured printer; no printer-specific integration is included.

This local SQLite foundation is intended for one running application instance. Before production use, add HTTPS hosting, automated database backups and restore checks, request rate limits, account recovery and staff deactivation flows, and test concurrent order/payment/stock operations. SQLite data should be backed up using SQLite's backup API or with the application stopped so the database and its write-ahead log stay consistent.
