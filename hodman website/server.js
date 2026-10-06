const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HODMAN_HOST || '127.0.0.1';
const DB_PATH = process.env.HODMAN_DB_PATH || path.join(ROOT, 'data', 'hodman.sqlite');
const SESSION_MS = 1000 * 60 * 60 * 12;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Africa/Mogadishu', currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','cashier','storekeeper','delivery','kitchen')),
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
    image_url TEXT NOT NULL DEFAULT '', available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS restaurant_tables (
    id INTEGER PRIMARY KEY, table_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 40), section TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','occupied','reserved','cleaning','out_of_service'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, branch_id INTEGER NOT NULL REFERENCES branches(id),
    table_id INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
    customer_id INTEGER REFERENCES customers(id), customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL DEFAULT '', order_type TEXT NOT NULL CHECK(order_type IN ('dine-in','takeaway','delivery')),
    status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','preparing','ready','out_for_delivery','completed','cancelled')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','part_paid','refunded')),
    payment_method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', subtotal_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price_cents INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), method TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, unit TEXT NOT NULL,
    stock_quantity REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY, ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    quantity_delta REAL NOT NULL, reason TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '',
    staff_id INTEGER REFERENCES staff(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS recipes (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id), quantity REAL NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(product_id, ingredient_id)
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, contact_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','received','cancelled')),
    total_cents INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES staff(id),
    received_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY, purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id), quantity REAL NOT NULL CHECK(quantity>0),
    unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0)
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK(amount_cents>0), payment_method TEXT NOT NULL DEFAULT '',
    incurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by INTEGER REFERENCES staff(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
    guests INTEGER NOT NULL CHECK(guests BETWEEN 1 AND 40), reservation_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS delivery_partners (
    id INTEGER PRIMARY KEY, business_name TEXT NOT NULL, contact_name TEXT NOT NULL,
    phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS partner_sessions (
    token_hash TEXT PRIMARY KEY, partner_id INTEGER NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS delivery_assignments (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id), partner_id INTEGER REFERENCES delivery_partners(id), staff_id INTEGER REFERENCES staff(id),
    delivery_type TEXT NOT NULL CHECK(delivery_type IN ('hodman','partner')),
    status TEXT NOT NULL DEFAULT 'unassigned', assigned_at TEXT, delivered_at TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY, staff_id INTEGER REFERENCES staff(id), action TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
function ensureColumn(table,column,definition){const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);if(!columns.includes(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);}
ensureColumn('staff','username',"TEXT NOT NULL DEFAULT ''");
for(const member of db.prepare("SELECT id,email FROM staff WHERE username='' OR username IS NULL").all()){
  const root=String(member.email||'').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,35)||`staff${member.id}`;
  let username=root.length>=3?root:`staff${root}`, suffix=2;
  while(db.prepare('SELECT id FROM staff WHERE username=? COLLATE NOCASE AND id<>?').get(username,member.id))username=`${root.slice(0,35)}${suffix++}`;
  db.prepare('UPDATE staff SET username=? WHERE id=?').run(username,member.id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS staff_username_unique ON staff(username COLLATE NOCASE)');
ensureColumn('orders','table_id','INTEGER REFERENCES restaurant_tables(id)');
ensureColumn('delivery_partners','password_hash',"TEXT NOT NULL DEFAULT ''");
ensureColumn('delivery_partners','salt',"TEXT NOT NULL DEFAULT ''");
ensureColumn('delivery_assignments','staff_id','INTEGER REFERENCES staff(id)');
if (!db.prepare('SELECT id FROM branches LIMIT 1').get()) {
  db.prepare('INSERT INTO branches (name,address,phone,email) VALUES (?,?,?,?)').run('Hodman Restaurant', 'Albarako, MPC, Mogadishu, Somalia', '0613007711', 'hodmanrestuaret@gmail.com');
}
for (const [key, value] of [['stock_deduction_trigger', 'paid'], ['online_ordering', 'true'], ['currency', 'USD']]) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key, value);
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))]; }));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) reject(Object.assign(new Error('Request is too large.'), { status: 413 })); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Object.assign(new Error('Please send valid JSON.'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function scrypt(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function audit(staffId, action, entityType, entityId = '', detail = '') {
  db.prepare('INSERT INTO audit_logs(staff_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)').run(staffId, action, entityType, String(entityId), detail);
}
function transaction(callback) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(...args); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
}
function deductOrderIngredients(orderId, staffId = null) {
  if (db.prepare(`SELECT id FROM stock_movements WHERE reference=? AND reason='sale' LIMIT 1`).get(`order:${orderId}`)) return;
  const rows = db.prepare(`SELECT r.ingredient_id,r.quantity*oi.quantity AS needed,i.name,i.unit,i.stock_quantity FROM order_items oi JOIN recipes r ON r.product_id=oi.product_id JOIN ingredients i ON i.id=r.ingredient_id WHERE oi.order_id=? AND i.active=1`).all(orderId);
  const totals = new Map();
  for (const row of rows) totals.set(row.ingredient_id, { ...row, needed: (totals.get(row.ingredient_id)?.needed || 0) + row.needed });
  const short = [...totals.values()].filter(item => item.stock_quantity < item.needed);
  if (short.length) throw Object.assign(new Error(`Not enough stock: ${short.map(x => `${x.name} (${x.stock_quantity} ${x.unit} available)`).join(', ')}.`), { status: 409 });
  for (const item of totals.values()) {
    db.prepare('UPDATE ingredients SET stock_quantity=stock_quantity-? WHERE id=?').run(item.needed,item.ingredient_id);
    db.prepare('INSERT INTO stock_movements(ingredient_id,quantity_delta,reason,reference,staff_id) VALUES(?,?,?,?,?)').run(item.ingredient_id,-item.needed,'sale',`order:${orderId}`,staffId);
  }
}
function restoreOrderIngredients(orderId, staffId) {
  const movements=db.prepare("SELECT ingredient_id,quantity_delta FROM stock_movements WHERE reference=? AND reason='sale'").all(`order:${orderId}`);
  for(const movement of movements){const quantity=-movement.quantity_delta;db.prepare('UPDATE ingredients SET stock_quantity=stock_quantity+? WHERE id=?').run(quantity,movement.ingredient_id);db.prepare("INSERT INTO stock_movements(ingredient_id,quantity_delta,reason,reference,staff_id) VALUES(?,?,'order_cancelled',?,?)").run(movement.ingredient_id,quantity,`order:${orderId}`,staffId);}
}
function session(req) {
  const token = parseCookies(req.headers.cookie).hodman_session;
  if (!token) return null;
  return db.prepare(`SELECT staff.id,staff.name,staff.username,staff.email,staff.role FROM sessions JOIN staff ON staff.id=sessions.staff_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND staff.active=1`).get(crypto.createHash('sha256').update(token).digest('hex'), Date.now()) || null;
}
function partnerSession(req) {
  const token=parseCookies(req.headers.cookie).hodman_partner;
  if(!token)return null;
  return db.prepare(`SELECT p.id,p.business_name,p.contact_name,p.email,p.phone,p.status FROM partner_sessions s JOIN delivery_partners p ON p.id=s.partner_id WHERE s.token_hash=? AND s.expires_at>? AND p.status='approved'`).get(crypto.createHash('sha256').update(token).digest('hex'),Date.now())||null;
}
const roleSets = {
  admin: new Set(['admin','cashier','storekeeper','delivery','kitchen']),
  cashier: new Set(['orders.read','orders.write','payments.write','customers.read','reservations.read']),
  storekeeper: new Set(['inventory.read','inventory.write','purchasing.read','purchasing.write']),
  delivery: new Set(['delivery.read','delivery.write']),
  kitchen: new Set(['kitchen.read','kitchen.write'])
};
function requireRole(user, ...roles) { return user && (user.role === 'admin' || roles.includes(user.role)); }
function requireUser(req, res, roles = []) {
  const user = session(req);
  if (!user) { json(res, 401, { error: 'Please sign in to continue.' }); return null; }
  if (roles.length && !requireRole(user, ...roles)) { json(res, 403, { error: 'Your account does not have access to this action.' }); return null; }
  return user;
}
function staffCount() { return Number(db.prepare('SELECT count(*) AS n FROM staff').get().n); }
const statusTransitions = { new: ['confirmed','cancelled'], confirmed: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: ['out_for_delivery','completed','cancelled'], out_for_delivery: ['completed','cancelled'], completed: [], cancelled: [] };

async function api(req, res, url) {
  const method = req.method;
  const route = url.pathname;
  if (method === 'GET' && route === '/api/health') return json(res, 200, { status: 'ok' });
  if (method === 'GET' && route === '/api/public/menu') {
    const categories = db.prepare('SELECT id,name,description,position FROM categories WHERE active=1 ORDER BY position,id').all();
    const products = db.prepare(`SELECT p.id,p.category_id,p.name,p.description,p.price_cents,p.image_url FROM products p WHERE p.available=1 ORDER BY p.category_id,p.name`).all();
    return json(res, 200, { categories, products, currency: 'USD' });
  }
  if(method==='GET'&&route==='/api/public/orders/track'){const number=String(url.searchParams.get('orderNumber')||'').trim(),phone=String(url.searchParams.get('phone')||'').trim();if(!number||phone.length<6)return json(res,400,{error:'Enter your order number and phone number.'});const order=db.prepare(`SELECT o.id,o.order_number,o.customer_phone,o.status,o.payment_status,o.total_cents,group_concat(oi.quantity || ' × ' || oi.product_name, ', ') AS items,da.status AS delivery_status FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN delivery_assignments da ON da.order_id=o.id WHERE o.order_number=? AND o.customer_phone=? GROUP BY o.id`).get(number,phone);if(!order)return json(res,404,{error:'We could not find an order with those details.'});const labels={new:'Received',confirmed:'Confirmed',preparing:'Being prepared',ready:'Ready',out_for_delivery:'On the way',completed:'Completed',cancelled:'Cancelled'};return json(res,200,{orderNumber:order.order_number,statusLabel:labels[order.status]||order.status,paymentStatus:order.payment_status,totalCents:order.total_cents,items:order.items,deliveryStatus:order.delivery_status});}
  if (method === 'POST' && route === '/api/public/orders') {
    const input = await readBody(req);
    const name = String(input.name || '').trim(), phone = String(input.phone || '').trim();
    const type = String(input.orderType || 'takeaway');
    const items = Array.isArray(input.items) ? input.items : [];
    if (name.length < 2 || phone.length < 6 || !['dine-in','takeaway','delivery'].includes(type) || !items.length || items.length > 30) return json(res, 400, { error: 'Add your name, a valid phone number, an order type, and at least one menu item.' });
    if (type === 'delivery' && String(input.address || '').trim().length < 5) return json(res, 400, { error: 'Please add a delivery address.' });
    const normalized = [];
    for (const item of items) {
      const id = Number(item.productId), qty = Math.floor(Number(item.quantity));
      const product = db.prepare('SELECT id,name,price_cents FROM products WHERE id=? AND available=1').get(id);
      if (!product || !Number.isInteger(qty) || qty < 1 || qty > 20) return json(res, 400, { error: 'One of the selected items is unavailable or has an invalid quantity. Please refresh the menu.' });
      normalized.push({ ...product, qty, notes: String(item.notes || '').trim().slice(0, 200) });
    }
    const subtotal = normalized.reduce((sum, item) => sum + item.price_cents * item.qty, 0);
    const branch = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get();
    const ref = `HD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const create = transaction(() => {
      const customer = db.prepare('INSERT INTO customers(name,phone,address) VALUES(?,?,?)').run(name, phone, String(input.address || '').trim().slice(0, 300));
      const order = db.prepare(`INSERT INTO orders(order_number,branch_id,customer_id,customer_name,customer_phone,delivery_address,order_type,notes,subtotal_cents,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(ref, branch.id, customer.lastInsertRowid, name, phone, String(input.address || '').trim().slice(0, 300), type, String(input.notes || '').trim().slice(0, 500), subtotal, subtotal);
      for (const item of normalized) db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents,notes) VALUES(?,?,?,?,?,?)').run(order.lastInsertRowid, item.id, item.name, item.qty, item.price_cents, item.notes);
      if (type === 'delivery') db.prepare(`INSERT INTO delivery_assignments(order_id,delivery_type,status) VALUES(?,'hodman','unassigned')`).run(order.lastInsertRowid);
      if (db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value === 'placed') deductOrderIngredients(Number(order.lastInsertRowid));
      return order.lastInsertRowid;
    });
    const orderId = create();
    return json(res, 201, { orderNumber: ref, status: 'new', totalCents: subtotal, currency: 'USD', message: 'Your order has been received. Please call us if you need to update it.' });
  }
  if (method === 'POST' && route === '/api/public/reservations') {
    const input = await readBody(req);
    const name = String(input.name || '').trim(), phone = String(input.phone || '').trim(), date = String(input.date || '');
    const guests = Math.floor(Number(input.guests));
    if (name.length < 2 || phone.length < 6 || !Number.isInteger(guests) || guests < 1 || guests > 40 || !date || Number.isNaN(Date.parse(date)) || Date.parse(date) <= Date.now()) return json(res, 400, { error: 'Check your name, phone, party size, and choose a future date and time.' });
    const result = db.prepare('INSERT INTO reservations(customer_name,phone,guests,reservation_at,notes) VALUES(?,?,?,?,?)').run(name, phone, guests, new Date(date).toISOString(), String(input.notes || '').trim().slice(0, 500));
    return json(res, 201, { id: Number(result.lastInsertRowid), status: 'requested', message: 'Your reservation request has been received. We will contact you to confirm.' });
  }
  if(method==='POST'&&route==='/api/public/partner-applications'){const input=await readBody(req),business=String(input.businessName||'').trim(),name=String(input.contactName||'').trim(),phone=String(input.phone||'').trim(),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||'');if(business.length<2||name.length<2||phone.length<6||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8)return json(res,400,{error:'Enter your business and contact details and a password with at least 8 characters.'});const salt=crypto.randomBytes(16).toString('hex');try{db.prepare('INSERT INTO delivery_partners(business_name,contact_name,phone,email,password_hash,salt) VALUES(?,?,?,?,?,?)').run(business,name,phone,email,scrypt(password,salt),salt);return json(res,201,{message:'Application sent. Hodman will review it and contact you.'});}catch{return json(res,409,{error:'An application already uses this email.'});}}
  if (method === 'GET' && route === '/api/auth/setup-status') return json(res, 200, { needsSetup: staffCount() === 0 });
  if (method === 'POST' && route === '/api/auth/setup') {
    if (staffCount() !== 0) return json(res, 409, { error: 'Initial setup is already complete.' });
    const input = await readBody(req);
    const name = String(input.name || '').trim(), username=String(input.username||'').trim().toLowerCase(), email = String(input.email || '').trim().toLowerCase(), password = String(input.password || '');
    if (name.length < 2 || !/^[a-z0-9._-]{3,40}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) return json(res, 400, { error: 'Enter your name, a valid username and email, and a password of at least 8 characters.' });
    const salt = crypto.randomBytes(16).toString('hex');
    let result;try{result=db.prepare('INSERT INTO staff(name,username,email,password_hash,salt,role) VALUES(?,?,?,?,?,?)').run(name,username,email,scrypt(password,salt),salt,'admin');}catch{return json(res,409,{error:'That username or email is already in use.'});}
    audit(Number(result.lastInsertRowid), 'created', 'staff', result.lastInsertRowid, 'Initial administrator account');
    return createSession(res, Number(result.lastInsertRowid));
  }
  if (method === 'POST' && route === '/api/auth/login') {
    const input = await readBody(req);
    const username = String(input.username || input.email || '').trim().toLowerCase(), password = String(input.password || '');
    const user = db.prepare('SELECT * FROM staff WHERE (username=? COLLATE NOCASE OR email=? COLLATE NOCASE) AND active=1').get(username,username);
    const dummy = 'a'.repeat(128);
    const candidate = scrypt(password.slice(0, 256), user ? user.salt : 'missing-account-salt');
    if (!user || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.password_hash || dummy))) return json(res, 401, { error: 'Username or password is incorrect.' });
    return createSession(res, user.id);
  }
  if (method === 'POST' && route === '/api/auth/logout') {
    const token = parseCookies(req.headers.cookie).hodman_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
    return json(res, 200, { ok: true }, { 'set-cookie': 'hodman_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && route === '/api/auth/me') {
    const user = session(req);
    return json(res, 200, { user: user ? { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role } : null, needsSetup: staffCount() === 0 });
  }
  if(method==='POST'&&route==='/api/partner/login'){const input=await readBody(req),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||''),partner=db.prepare('SELECT * FROM delivery_partners WHERE email=?').get(email);if(!partner){scrypt(password.slice(0,256),'missing-partner-salt');return json(res,401,{error:'Email or password is incorrect.'});}const candidate=scrypt(password.slice(0,256),partner.salt||'missing-partner-salt');if(!crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(partner.password_hash||'a'.repeat(128))))return json(res,401,{error:'Email or password is incorrect.'});if(partner.status!=='approved')return json(res,403,{error:'Your partner application is still awaiting Hodman approval.'});const token=crypto.randomBytes(32).toString('base64url');db.prepare('INSERT INTO partner_sessions(token_hash,partner_id,expires_at,created_at) VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),partner.id,Date.now()+SESSION_MS,Date.now());const secure=process.env.NODE_ENV==='production'?'; Secure':'';return json(res,200,{ok:true},{'set-cookie':`hodman_partner=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`});}
  if(method==='POST'&&route==='/api/partner/logout'){const token=parseCookies(req.headers.cookie).hodman_partner;if(token)db.prepare('DELETE FROM partner_sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));return json(res,200,{ok:true},{'set-cookie':'hodman_partner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
  if(route.startsWith('/api/partner/')){const partner=partnerSession(req);if(!partner)return json(res,401,{error:'Sign in to your approved delivery partner account.'});if(method==='GET'&&route==='/api/partner/me')return json(res,200,{partner});if(method==='GET'&&route==='/api/partner/jobs'){return json(res,200,{jobs:db.prepare(`SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.delivery_address,o.total_cents,o.created_at,o.status,group_concat(oi.quantity || ' × ' || oi.product_name, ', ') AS items,da.status AS delivery_status FROM orders o JOIN delivery_assignments da ON da.order_id=o.id LEFT JOIN order_items oi ON oi.order_id=o.id WHERE da.delivery_type='partner' AND da.partner_id=? AND ((da.status='unassigned' AND o.status NOT IN ('cancelled','completed')) OR (da.status='accepted' AND o.status='out_for_delivery')) GROUP BY o.id ORDER BY CASE da.status WHEN 'unassigned' THEN 0 ELSE 1 END,o.id DESC`).all(partner.id)});}const claim=route.match(/^\/api\/partner\/jobs\/(\d+)\/claim$/);if(method==='POST'&&claim){try{transaction(()=>{const job=db.prepare("SELECT o.id FROM orders o JOIN delivery_assignments da ON da.order_id=o.id WHERE o.id=? AND o.status='ready' AND da.delivery_type='partner' AND da.status='unassigned' AND da.partner_id=?").get(Number(claim[1]),partner.id);if(!job)throw Object.assign(new Error('This order is not assigned to your business, is not ready, or has already been accepted.'),{status:409});db.prepare("UPDATE delivery_assignments SET status='accepted',assigned_at=CURRENT_TIMESTAMP WHERE order_id=? AND partner_id=? AND status='unassigned'").run(job.id,partner.id);db.prepare("UPDATE orders SET status='out_for_delivery',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,200,{ok:true});}const delivered=route.match(/^\/api\/partner\/jobs\/(\d+)\/delivered$/);if(method==='POST'&&delivered){try{transaction(()=>{const job=db.prepare("SELECT o.id FROM orders o JOIN delivery_assignments da ON da.order_id=o.id WHERE o.id=? AND o.status='out_for_delivery' AND da.partner_id=? AND da.status='accepted'").get(Number(delivered[1]),partner.id);if(!job)throw Object.assign(new Error('This delivery is not assigned to your account.'),{status:409});if(db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value==='completed')deductOrderIngredients(job.id);db.prepare("UPDATE delivery_assignments SET status='delivered',delivered_at=CURRENT_TIMESTAMP WHERE order_id=?").run(job.id);db.prepare("UPDATE orders SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,200,{ok:true});}return json(res,404,{error:'Partner endpoint not found.'});}
  if (route.startsWith('/api/admin/')) {
    const user = requireUser(req, res);
    if (!user) return;
    if (method === 'GET' && route === '/api/admin/summary') {
      if (!requireRole(user, 'admin','cashier')) return json(res, 403, { error: 'This role cannot view sales.' });
      const orders = db.prepare(`SELECT count(*) AS count, COALESCE(sum(total_cents),0) AS sales FROM orders WHERE date(created_at)=date('now','+3 hours') AND status!='cancelled'`).get();
      const receipts = db.prepare(`SELECT COALESCE(sum(p.amount_cents),0) AS total FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.status='completed' AND date(o.created_at)=date('now','+3 hours')`).get();
      const pending = db.prepare(`SELECT count(*) AS count FROM orders WHERE status IN ('new','confirmed','preparing','ready','out_for_delivery')`).get();
      const lowStock = db.prepare('SELECT count(*) AS count FROM ingredients WHERE active=1 AND stock_quantity<=reorder_level').get();
      const reservations = db.prepare(`SELECT count(*) AS count FROM reservations WHERE date(reservation_at)=date('now','+3 hours') AND status IN ('requested','confirmed')`).get();
      return json(res, 200, { todayOrders: orders.count, todaySalesCents: receipts.total, activeOrders: pending.count, lowStock: lowStock.count, todayReservations: reservations.count, latestOrders: db.prepare('SELECT id,order_number,customer_name,order_type,status,total_cents,created_at FROM orders ORDER BY id DESC LIMIT 8').all() });
    }
    if (method === 'GET' && route === '/api/admin/orders') {
      if (!requireRole(user, 'admin','cashier','kitchen','delivery')) return json(res, 403, { error: 'This role cannot view orders.' });
      const fields=user.role==='kitchen'?'o.id,o.order_number,o.customer_name,o.customer_phone,o.order_type,o.status,o.notes,o.created_at,group_concat(oi.quantity || \' × \' || oi.product_name, \', \') AS items':'o.*, (SELECT COALESCE(sum(p.amount_cents),0) FROM payments p WHERE p.order_id=o.id AND p.status=\'completed\') AS payment_total, group_concat(oi.quantity || \' × \' || oi.product_name, \', \') AS items';
      if(user.role==='delivery')return json(res,200,{orders:db.prepare(`SELECT o.id,o.order_number,o.customer_name,o.customer_phone,o.delivery_address,o.order_type,o.status,o.total_cents,o.payment_status,o.created_at,group_concat(oi.quantity || ' × ' || oi.product_name, ', ') AS items,da.status AS delivery_status FROM orders o JOIN delivery_assignments da ON da.order_id=o.id LEFT JOIN order_items oi ON oi.order_id=o.id WHERE da.delivery_type='hodman' AND da.staff_id=? AND o.status NOT IN ('cancelled','completed') GROUP BY o.id ORDER BY o.id DESC`).all(user.id)});
      return json(res, 200, { orders: db.prepare(`SELECT ${fields} FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id ORDER BY o.id DESC LIMIT 100`).all() });
    }
    const orderStatus = route.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
    if (method === 'PATCH' && orderStatus) {
      if (!requireRole(user, 'admin','cashier','kitchen','delivery')) return json(res, 403, { error: 'This role cannot update orders.' });
      const input = await readBody(req), order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(orderStatus[1]));
      const next = String(input.status || '');
      if (!order || !statusTransitions[order.status]?.includes(next)) return json(res, 409, { error: 'That status change is not allowed.' });
      if(next==='cancelled'&&order.payment_status!=='unpaid')return json(res,409,{error:'Refund the confirmed payment through its provider before cancelling this paid order.'});
      if(user.role==='kitchen'&&!((order.status==='confirmed'&&next==='preparing')||(order.status==='preparing'&&next==='ready')))return json(res,403,{error:'Kitchen staff can only start preparation and mark orders ready.'});
      if(user.role==='delivery'&&!((order.status==='ready'&&next==='out_for_delivery')||(order.status==='out_for_delivery'&&next==='completed')))return json(res,403,{error:'Delivery staff can only update delivery progress.'});
      if(user.role==='delivery'&&!db.prepare("SELECT order_id FROM delivery_assignments WHERE order_id=? AND delivery_type='hodman' AND staff_id=?").get(order.id,user.id))return json(res,403,{error:'This order is not assigned to your account.'});
      try {
        transaction(() => {
          if (next === 'completed' && db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value === 'completed') deductOrderIngredients(order.id,user.id);
          if (next === 'cancelled') restoreOrderIngredients(order.id,user.id);
          db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next,order.id);
          if (next === 'completed' && order.table_id) db.prepare("UPDATE restaurant_tables SET status='cleaning' WHERE id=? AND status='occupied'").run(order.table_id);
          if (next === 'cancelled' && order.table_id) db.prepare("UPDATE restaurant_tables SET status='available' WHERE id=? AND status='occupied'").run(order.table_id);
          if(user.role==='delivery'&&next==='completed')db.prepare("UPDATE delivery_assignments SET status='delivered',delivered_at=CURRENT_TIMESTAMP WHERE order_id=?").run(order.id);
          if(user.role==='delivery'&&next==='out_for_delivery')db.prepare("UPDATE delivery_assignments SET status='out_for_delivery' WHERE order_id=?").run(order.id);
        })();
      } catch (error) { return json(res,error.status||500,{error:error.message}); }
      audit(user.id,'status_changed','order',order.id,`${order.status} → ${next}`);
      return json(res, 200, { ok: true });
    }
    const paymentRoute=route.match(/^\/api\/admin\/orders\/(\d+)\/payments$/);
    if(method==='POST'&&paymentRoute){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot take payments.'});const input=await readBody(req),order=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(paymentRoute[1])),amount=Math.round(Number(input.amount)*100),method=String(input.method||'');if(!order||['completed','cancelled'].includes(order.status))return json(res,409,{error:'This order cannot accept payment.'});const methods=['cash','evc_plus','waafi','edahab','sahal','zaad','somqr','premier_bank','card','bank_transfer','other'];if(!methods.includes(method)||!Number.isInteger(amount)||amount<1)return json(res,400,{error:'Enter a valid payment amount and method.'});const paid=Number(db.prepare("SELECT COALESCE(sum(amount_cents),0) AS n FROM payments WHERE order_id=? AND status='completed'").get(order.id).n);if(paid+amount>order.total_cents)return json(res,409,{error:'Payment is greater than the remaining order balance.'});try{transaction(()=>{db.prepare("INSERT INTO payments(order_id,method,amount_cents,reference,status,provider) VALUES(?,?,?,?, 'completed',?)").run(order.id,method,amount,String(input.reference||'').trim().slice(0,100),method);const nextPaid=paid+amount;const state=nextPaid===order.total_cents?'paid':'part_paid';db.prepare('UPDATE orders SET payment_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,order.id);if(state==='paid'&&db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value==='paid')deductOrderIngredients(order.id,user.id);audit(user.id,'payment_recorded','order',order.id,`${method} $${(amount/100).toFixed(2)}`);})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,201,{ok:true});}
    if (method === 'GET' && route === '/api/admin/menu') {
      if (!requireRole(user, 'admin','cashier')) return json(res, 403, { error: 'This role cannot view the menu.' });
      return json(res, 200, { categories: db.prepare('SELECT * FROM categories ORDER BY position,id').all(), products: db.prepare('SELECT p.*,c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC').all() });
    }
    if (method === 'POST' && route === '/api/admin/categories') {
      if (user.role !== 'admin') return json(res, 403, { error: 'Only an admin can manage categories.' });
      const input=await readBody(req), name=String(input.name||'').trim();
      if (name.length < 2 || name.length > 60) return json(res,400,{error:'Category names must be 2 to 60 characters.'});
      try { const result=db.prepare('INSERT INTO categories(name,description,position) VALUES(?,?,?)').run(name,String(input.description||'').trim().slice(0,250),Number(input.position)||0); audit(user.id,'created','category',result.lastInsertRowid,name); return json(res,201,{id:Number(result.lastInsertRowid),name}); }
      catch { return json(res,409,{error:'That category already exists.'}); }
    }
    if(method==='GET'&&route==='/api/admin/tables'){if(!requireRole(user,'admin','cashier','delivery'))return json(res,403,{error:'This role cannot view tables.'});return json(res,200,{tables:db.prepare('SELECT * FROM restaurant_tables ORDER BY section,table_name').all()});}
    if(method==='POST'&&route==='/api/admin/tables'){if(user.role!=='admin')return json(res,403,{error:'Only an admin can add tables.'});const input=await readBody(req),name=String(input.name||'').trim(),capacity=Number(input.capacity),section=String(input.section||'').trim().slice(0,50);if(name.length<1||name.length>30||!Number.isInteger(capacity)||capacity<1||capacity>40)return json(res,400,{error:'Enter a table name and capacity between 1 and 40.'});try{const result=db.prepare('INSERT INTO restaurant_tables(table_name,capacity,section) VALUES(?,?,?)').run(name,capacity,section);audit(user.id,'created','table',result.lastInsertRowid,name);return json(res,201,{id:Number(result.lastInsertRowid),name});}catch{return json(res,409,{error:'That table already exists.'});}}
    const tableStatus=route.match(/^\/api\/admin\/tables\/(\d+)\/status$/);if(method==='PATCH'&&tableStatus){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot update tables.'});const input=await readBody(req),status=String(input.status||'');if(!['available','reserved','cleaning','out_of_service'].includes(status))return json(res,400,{error:'Choose a valid table status.'});const table=db.prepare('SELECT id,status FROM restaurant_tables WHERE id=?').get(Number(tableStatus[1]));if(!table)return json(res,404,{error:'Table not found.'});if(table.status==='occupied'&&status==='available')return json(res,409,{error:'Complete or cancel the open order before freeing this table.'});db.prepare('UPDATE restaurant_tables SET status=? WHERE id=?').run(status,table.id);audit(user.id,'status_changed','table',table.id,status);return json(res,200,{ok:true});}
    if(method==='POST'&&route==='/api/admin/pos/orders'){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot create POS orders.'});const input=await readBody(req),type=String(input.orderType||'dine-in'),items=Array.isArray(input.items)?input.items:[],name=String(input.customerName||'Guest').trim(),phone=String(input.phone||'Walk-in').trim(),tableId=input.tableId?Number(input.tableId):null;if(!['dine-in','takeaway','delivery'].includes(type)||!items.length||items.length>40)return json(res,400,{error:'Choose an order type and add at least one dish.'});if(type==='dine-in'&&!tableId)return json(res,400,{error:'Select a table for dine-in service.'});const table=tableId?db.prepare('SELECT * FROM restaurant_tables WHERE id=?').get(tableId):null;if(tableId&&(!table||table.status!=='available'))return json(res,409,{error:'Choose a table that is currently available.'});const chosen=[];for(const row of items){const product=db.prepare('SELECT id,name,price_cents FROM products WHERE id=? AND available=1').get(Number(row.productId)),quantity=Math.floor(Number(row.quantity));if(!product||!Number.isInteger(quantity)||quantity<1||quantity>50)return json(res,400,{error:'A selected dish is unavailable or has an invalid quantity.'});chosen.push({...product,quantity,notes:String(row.notes||'').slice(0,200)});}const total=chosen.reduce((sum,item)=>sum+item.price_cents*item.quantity,0),ref=`HD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,branch=db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get(),customerFound=phone==='Walk-in'?null:db.prepare('SELECT id FROM customers WHERE phone=? ORDER BY id DESC LIMIT 1').get(phone),paymentMethods=['cash','evc_plus','waafi','edahab','sahal','zaad','somqr','premier_bank','card','bank_transfer','other'];try{const id=transaction(()=>{let customerId=customerFound?.id;if(!customerId){customerId=Number(db.prepare('INSERT INTO customers(name,phone) VALUES(?,?)').run(name,phone).lastInsertRowid);}const order=db.prepare(`INSERT INTO orders(order_number,branch_id,table_id,customer_id,customer_name,customer_phone,order_type,status,notes,subtotal_cents,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ref,branch.id,tableId,customerId,name,phone,type,'confirmed',String(input.notes||'').slice(0,500),total,total);for(const item of chosen)db.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents,notes) VALUES(?,?,?,?,?,?)').run(order.lastInsertRowid,item.id,item.name,item.quantity,item.price_cents,item.notes);if(type==='delivery')db.prepare("INSERT INTO delivery_assignments(order_id,delivery_type,status) VALUES(?,'hodman','unassigned')").run(order.lastInsertRowid);if(tableId)db.prepare("UPDATE restaurant_tables SET status='occupied' WHERE id=?").run(tableId);const payments=Array.isArray(input.payments)?input.payments:[];let paid=0;for(const p of payments){const amount=Math.round(Number(p.amount)*100),method=String(p.method||'');if(!Number.isInteger(amount)||amount<1||!paymentMethods.includes(method))throw Object.assign(new Error('Check the POS payment amount and method.'),{status:400});paid+=amount;if(paid>total)throw Object.assign(new Error('Payment total exceeds the order total.'),{status:400});db.prepare("INSERT INTO payments(order_id,method,amount_cents,reference,status,provider) VALUES(?,?,?,?,'completed',?)").run(order.lastInsertRowid,method,amount,String(p.reference||'').slice(0,100),method); }if(paid)db.prepare('UPDATE orders SET payment_status=? WHERE id=?').run(paid===total?'paid':'part_paid',order.lastInsertRowid);if(db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value==='placed')deductOrderIngredients(Number(order.lastInsertRowid),user.id);if(paid===total&&db.prepare('SELECT value FROM settings WHERE key=?').get('stock_deduction_trigger')?.value==='paid')deductOrderIngredients(Number(order.lastInsertRowid),user.id);audit(user.id,'created','order',order.lastInsertRowid,`POS ${type}`);return Number(order.lastInsertRowid);})();return json(res,201,{id,orderNumber:ref,totalCents:total});}catch(error){return json(res,error.status||500,{error:error.message});}}
    if (method === 'POST' && route === '/api/admin/products') {
      if (user.role !== 'admin') return json(res,403,{error:'Only an admin can manage products.'});
      const input=await readBody(req), name=String(input.name||'').trim(), price=Number(input.price);
      if(name.length<2||name.length>100||!Number.isFinite(price)||price<0||price>100000) return json(res,400,{error:'Enter a product name and a valid USD price.'});
      const categoryId=input.categoryId?Number(input.categoryId):null;
      if(categoryId&&!db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) return json(res,400,{error:'Choose a valid category.'});
      const result=db.prepare('INSERT INTO products(category_id,name,description,price_cents,image_url,available) VALUES(?,?,?,?,?,?)').run(categoryId,name,String(input.description||'').trim().slice(0,500),Math.round(price*100),String(input.imageUrl||'').trim().slice(0,400),input.available===false?0:1);
      audit(user.id,'created','product',result.lastInsertRowid,name);
      return json(res,201,{id:Number(result.lastInsertRowid),name});
    }
    const productEdit=route.match(/^\/api\/admin\/products\/(\d+)$/);if(method==='PATCH'&&productEdit){if(user.role!=='admin')return json(res,403,{error:'Only an admin can edit dishes.'});const productId=Number(productEdit[1]),input=await readBody(req),name=String(input.name||'').trim(),price=Number(input.price),categoryId=input.categoryId?Number(input.categoryId):null,description=String(input.description||'').trim(),imageUrl=String(input.imageUrl||'').trim();if(name.length<2||name.length>100||!Number.isFinite(price)||price<0||price>100000||!Number.isInteger(Math.round(price*100))||description.length>500||imageUrl.length>400)return json(res,400,{error:'Enter a dish name, valid price, and shorter description or image URL.'});if(categoryId&&(!Number.isInteger(categoryId)||!db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)))return json(res,400,{error:'Choose a valid category.'});const product=db.prepare('SELECT id FROM products WHERE id=?').get(productId);if(!product)return json(res,404,{error:'Dish not found.'});db.prepare('UPDATE products SET category_id=?,name=?,description=?,price_cents=?,image_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(categoryId,name,description,Math.round(price*100),imageUrl,productId);audit(user.id,'updated','product',productId,name);return json(res,200,{ok:true,id:productId,name});}
    if(method==='GET'&&route==='/api/admin/inventory'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot view inventory.'});return json(res,200,{ingredients:db.prepare('SELECT * FROM ingredients WHERE active=1 ORDER BY name').all(),recipes:db.prepare('SELECT r.product_id,r.ingredient_id,r.quantity,p.name AS product_name,i.name AS ingredient_name,i.unit FROM recipes r JOIN products p ON p.id=r.product_id JOIN ingredients i ON i.id=r.ingredient_id ORDER BY p.name,i.name').all(),products:db.prepare('SELECT id,name FROM products WHERE available=1 ORDER BY name').all()});}
    if(method==='POST'&&route==='/api/admin/inventory/ingredients'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot manage inventory.'});const input=await readBody(req),name=String(input.name||'').trim(),unit=String(input.unit||'').trim().slice(0,24),quantity=Number(input.quantity),reorder=Number(input.reorderLevel||0);if(name.length<2||!unit||!Number.isFinite(quantity)||quantity<0||!Number.isFinite(reorder)||reorder<0)return json(res,400,{error:'Enter a name, unit, and valid stock levels.'});try{const result=db.prepare('INSERT INTO ingredients(name,unit,stock_quantity,reorder_level) VALUES(?,?,?,?)').run(name,unit,quantity,reorder);if(quantity>0)db.prepare("INSERT INTO stock_movements(ingredient_id,quantity_delta,reason) VALUES(?,?,'opening_stock')").run(result.lastInsertRowid,quantity);audit(user.id,'created','ingredient',result.lastInsertRowid,name);return json(res,201,{id:Number(result.lastInsertRowid),name});}catch{return json(res,409,{error:'That ingredient already exists.'});}}
    if(method==='POST'&&route==='/api/admin/inventory/adjustments'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot adjust inventory.'});const input=await readBody(req),id=Number(input.ingredientId),delta=Number(input.quantity),reason=String(input.reason||'').trim().slice(0,100),ingredient=db.prepare('SELECT * FROM ingredients WHERE id=? AND active=1').get(id);if(!ingredient||!Number.isFinite(delta)||delta===0||!reason)return json(res,400,{error:'Select an ingredient, quantity change, and reason.'});if(ingredient.stock_quantity+delta<0)return json(res,409,{error:'Stock cannot go below zero.'});transaction(()=>{db.prepare('UPDATE ingredients SET stock_quantity=stock_quantity+? WHERE id=?').run(delta,id);db.prepare('INSERT INTO stock_movements(ingredient_id,quantity_delta,reason,staff_id) VALUES(?,?,?,?)').run(id,delta,reason,user.id);audit(user.id,'adjusted','ingredient',id,`${delta} ${ingredient.unit}: ${reason}`);})();return json(res,200,{ok:true});}
    if(method==='PUT'&&route==='/api/admin/inventory/recipes'){if(user.role!=='admin')return json(res,403,{error:'Only an admin can manage recipes.'});const input=await readBody(req),productId=Number(input.productId),parts=Array.isArray(input.ingredients)?input.ingredients:[];if(!db.prepare('SELECT id FROM products WHERE id=?').get(productId)||parts.length>100)return json(res,400,{error:'Select a valid product and recipe ingredients.'});for(const part of parts){if(!db.prepare('SELECT id FROM ingredients WHERE id=? AND active=1').get(Number(part.ingredientId))||!Number.isFinite(Number(part.quantity))||Number(part.quantity)<=0)return json(res,400,{error:'Each recipe ingredient needs a valid stock item and quantity.'});}transaction(()=>{db.prepare('DELETE FROM recipes WHERE product_id=?').run(productId);for(const part of parts)db.prepare('INSERT INTO recipes(product_id,ingredient_id,quantity) VALUES(?,?,?)').run(productId,Number(part.ingredientId),Number(part.quantity));audit(user.id,'updated','recipe',productId,`${parts.length} ingredients`);})();return json(res,200,{ok:true});}
    if(method==='GET'&&route==='/api/admin/purchasing'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot view purchasing.'});return json(res,200,{suppliers:db.prepare('SELECT * FROM suppliers WHERE active=1 ORDER BY name').all(),orders:db.prepare('SELECT po.*,s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id ORDER BY po.id DESC LIMIT 100').all(),ingredients:db.prepare('SELECT id,name,unit,cost_cents FROM ingredients WHERE active=1 ORDER BY name').all()});}
    if(method==='POST'&&route==='/api/admin/purchasing/suppliers'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot add suppliers.'});const input=await readBody(req),name=String(input.name||'').trim();if(name.length<2||name.length>100)return json(res,400,{error:'Enter a supplier name.'});try{const result=db.prepare('INSERT INTO suppliers(name,contact_name,phone,email,address) VALUES(?,?,?,?,?)').run(name,String(input.contactName||'').trim().slice(0,100),String(input.phone||'').trim().slice(0,40),String(input.email||'').trim().slice(0,150),String(input.address||'').trim().slice(0,300));audit(user.id,'created','supplier',result.lastInsertRowid,name);return json(res,201,{id:Number(result.lastInsertRowid),name});}catch{return json(res,409,{error:'That supplier already exists.'});}}
    if(method==='POST'&&route==='/api/admin/purchasing/orders'){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot create purchase orders.'});const input=await readBody(req),supplierId=Number(input.supplierId),items=Array.isArray(input.items)?input.items:[];if(!db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(supplierId)||!items.length||items.length>100)return json(res,400,{error:'Choose a supplier and add at least one ingredient.'});let total=0;const lines=[];for(const row of items){const ingredient=db.prepare('SELECT id FROM ingredients WHERE id=? AND active=1').get(Number(row.ingredientId)),quantity=Number(row.quantity),cost=Math.round(Number(row.unitCost)*100);if(!ingredient||!Number.isFinite(quantity)||quantity<=0||quantity>100000||!Number.isInteger(cost)||cost<0)return json(res,400,{error:'Check each purchase quantity and unit cost.'});total+=Math.round(quantity*cost);lines.push({id:ingredient.id,quantity,cost});}const ref=`PO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;const id=transaction(()=>{const order=db.prepare('INSERT INTO purchase_orders(order_number,supplier_id,total_cents,notes,created_by) VALUES(?,?,?,?,?)').run(ref,supplierId,total,String(input.notes||'').trim().slice(0,500),user.id);for(const line of lines)db.prepare('INSERT INTO purchase_order_items(purchase_order_id,ingredient_id,quantity,unit_cost_cents) VALUES(?,?,?,?)').run(order.lastInsertRowid,line.id,line.quantity,line.cost);audit(user.id,'created','purchase_order',order.lastInsertRowid,ref);return Number(order.lastInsertRowid);})();return json(res,201,{id,orderNumber:ref,totalCents:total});}
    const receivePurchase=route.match(/^\/api\/admin\/purchasing\/orders\/(\d+)\/receive$/);if(method==='POST'&&receivePurchase){if(!requireRole(user,'admin','storekeeper'))return json(res,403,{error:'This role cannot receive purchases.'});const id=Number(receivePurchase[1]),order=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id);if(!order||order.status!=='ordered')return json(res,409,{error:'This purchase order is not awaiting receipt.'});transaction(()=>{const lines=db.prepare('SELECT ingredient_id,quantity FROM purchase_order_items WHERE purchase_order_id=?').all(id);for(const line of lines){db.prepare('UPDATE ingredients SET stock_quantity=stock_quantity+? WHERE id=?').run(line.quantity,line.ingredient_id);db.prepare("INSERT INTO stock_movements(ingredient_id,quantity_delta,reason,reference,staff_id) VALUES(?,?,'purchase',?,?)").run(line.ingredient_id,line.quantity,`purchase:${id}`,user.id);}db.prepare("UPDATE purchase_orders SET status='received',received_at=CURRENT_TIMESTAMP WHERE id=?").run(id);audit(user.id,'received','purchase_order',id,order.order_number);})();return json(res,200,{ok:true});}
    if(method==='GET'&&route==='/api/admin/customers'){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot view customers.'});return json(res,200,{customers:db.prepare(`SELECT c.id,c.name,c.phone,c.email,c.address,c.created_at,count(o.id) AS order_count,COALESCE(sum(CASE WHEN o.payment_status='paid' THEN o.total_cents ELSE 0 END),0) AS spend_cents FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.id DESC LIMIT 500`).all()});}
    if(method==='GET'&&route==='/api/admin/expenses'){if(user.role!=='admin')return json(res,403,{error:'Only administrators can view expenses.'});return json(res,200,{expenses:db.prepare('SELECT e.*,s.name AS staff_name FROM expenses e LEFT JOIN staff s ON s.id=e.created_by ORDER BY e.incurred_at DESC LIMIT 300').all()});}
    if(method==='POST'&&route==='/api/admin/expenses'){if(user.role!=='admin')return json(res,403,{error:'Only administrators can record expenses.'});const input=await readBody(req),category=String(input.category||'').trim(),description=String(input.description||'').trim(),amount=Math.round(Number(input.amount)*100);if(category.length<2||description.length<2||!Number.isInteger(amount)||amount<=0)return json(res,400,{error:'Enter an expense category, description, and positive USD amount.'});const result=db.prepare('INSERT INTO expenses(category,description,amount_cents,payment_method,created_by) VALUES(?,?,?,?,?)').run(category,description.slice(0,300),amount,String(input.paymentMethod||'').slice(0,40),user.id);audit(user.id,'created','expense',result.lastInsertRowid,`${category} $${(amount/100).toFixed(2)}`);return json(res,201,{id:Number(result.lastInsertRowid)});}
    if(method==='GET'&&route==='/api/admin/reports'){if(user.role!=='admin')return json(res,403,{error:'Only administrators can view reports.'});const sales=db.prepare(`SELECT date(created_at,'+3 hours') AS day,count(*) AS order_count,COALESCE(sum(total_cents),0) AS order_total FROM orders WHERE status!='cancelled' AND date(created_at,'+3 hours')>=date('now','+3 hours','-29 days') GROUP BY date(created_at,'+3 hours') ORDER BY day DESC`).all();const payments=db.prepare(`SELECT method,sum(amount_cents) AS amount_cents,count(*) AS count FROM payments WHERE status='completed' GROUP BY method ORDER BY amount_cents DESC`).all();const popular=db.prepare(`SELECT oi.product_name,sum(oi.quantity) AS quantity,sum(oi.quantity*oi.unit_price_cents) AS sales_cents FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' GROUP BY oi.product_name ORDER BY quantity DESC LIMIT 10`).all();const expenses=db.prepare("SELECT COALESCE(sum(amount_cents),0) AS amount FROM expenses WHERE date(incurred_at)>=date('now','-29 days')").get();return json(res,200,{sales,payments,popular,expensesCents:expenses.amount});}
    if(method==='GET'&&route==='/api/admin/audit'){if(user.role!=='admin')return json(res,403,{error:'Only administrators can view audit history.'});return json(res,200,{logs:db.prepare('SELECT a.*,s.name AS staff_name FROM audit_logs a LEFT JOIN staff s ON s.id=a.staff_id ORDER BY a.id DESC LIMIT 500').all()});}
    const productToggle=route.match(/^\/api\/admin\/products\/(\d+)\/availability$/);
    if(method==='PATCH'&&productToggle){if(user.role!=='admin')return json(res,403,{error:'Only an admin can manage products.'});const input=await readBody(req);const exists=db.prepare('SELECT id FROM products WHERE id=?').get(Number(productToggle[1]));if(!exists)return json(res,404,{error:'Product not found.'});db.prepare('UPDATE products SET available=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.available?1:0,exists.id);audit(user.id,'availability_changed','product',exists.id,input.available?'available':'unavailable');return json(res,200,{ok:true});}
    if (method === 'GET' && route === '/api/admin/reservations') {
      if (!requireRole(user, 'admin','cashier')) return json(res,403,{error:'This role cannot view reservations.'});
      return json(res,200,{reservations:db.prepare('SELECT * FROM reservations ORDER BY reservation_at DESC LIMIT 100').all()});
    }
    const reservationStatus=route.match(/^\/api\/admin\/reservations\/(\d+)\/status$/);if(method==='PATCH'&&reservationStatus){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot manage reservations.'});const input=await readBody(req),status=String(input.status||'');if(!['confirmed','declined','completed'].includes(status))return json(res,400,{error:'Choose a valid reservation status.'});const result=db.prepare('UPDATE reservations SET status=? WHERE id=?').run(status,Number(reservationStatus[1]));if(!result.changes)return json(res,404,{error:'Reservation not found.'});audit(user.id,'status_changed','reservation',reservationStatus[1],status);return json(res,200,{ok:true});}
    if (method === 'GET' && route === '/api/admin/settings') {
      if(user.role!=='admin')return json(res,403,{error:'Only an admin can view settings.'});
      return json(res,200,{branch:db.prepare('SELECT * FROM branches ORDER BY id LIMIT 1').get(),settings:Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))});
    }
    if(method==='GET'&&route==='/api/admin/staff'){if(user.role!=='admin')return json(res,403,{error:'Only an admin can view staff accounts.'});return json(res,200,{staff:db.prepare('SELECT id,name,username,email,role,active,created_at FROM staff ORDER BY name').all()});}
    const staffPasswordReset=route.match(/^\/api\/admin\/staff\/(\d+)\/password$/);if(method==='POST'&&staffPasswordReset){if(user.role!=='admin')return json(res,403,{error:'Only an admin can reset staff passwords.'});const staffId=Number(staffPasswordReset[1]),input=await readBody(req),password=String(input.password||'');if(password.length<8||password.length>128)return json(res,400,{error:'Use a password between 8 and 128 characters.'});let account;try{transaction(()=>{account=db.prepare('SELECT id,username FROM staff WHERE id=? AND active=1').get(staffId);if(!account)throw Object.assign(new Error('Active staff account not found.'),{status:404});const salt=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE staff SET password_hash=?,salt=? WHERE id=?').run(scrypt(password,salt),salt,staffId);if(staffId===user.id){const token=parseCookies(req.headers.cookie).hodman_session,hash=token?crypto.createHash('sha256').update(token).digest('hex'):'';db.prepare('DELETE FROM sessions WHERE staff_id=? AND token_hash<>?').run(staffId,hash);}else db.prepare('DELETE FROM sessions WHERE staff_id=?').run(staffId);audit(user.id,'password_reset','staff',staffId,'Administrator set a new staff password');})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,200,{ok:true,username:account.username});}
    if(method==='GET'&&route==='/api/admin/partners'){if(user.role!=='admin')return json(res,403,{error:'Only an admin can manage delivery partners.'});return json(res,200,{partners:db.prepare("SELECT id,business_name,contact_name,phone,email,status,created_at FROM delivery_partners WHERE status<>'deleted' ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC").all()});}
    if(method==='GET'&&route==='/api/admin/delivery-partners'){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot assign deliveries.'});return json(res,200,{partners:db.prepare("SELECT id,business_name,contact_name FROM delivery_partners WHERE status='approved' ORDER BY business_name").all()});}
    const partnerPasswordReset=route.match(/^\/api\/admin\/partners\/(\d+)\/password$/);if(method==='POST'&&partnerPasswordReset){if(user.role!=='admin')return json(res,403,{error:'Only an admin can reset delivery partner passwords.'});const partnerId=Number(partnerPasswordReset[1]),input=await readBody(req),password=String(input.password||'');if(password.length<8||password.length>128)return json(res,400,{error:'Use a password between 8 and 128 characters.'});let account;try{transaction(()=>{account=db.prepare("SELECT id,email FROM delivery_partners WHERE id=? AND status<>'deleted'").get(partnerId);if(!account)throw Object.assign(new Error('Delivery partner account not found.'),{status:404});const salt=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE delivery_partners SET password_hash=?,salt=? WHERE id=?').run(scrypt(password,salt),salt,partnerId);db.prepare('DELETE FROM partner_sessions WHERE partner_id=?').run(partnerId);audit(user.id,'password_reset','delivery_partner',partnerId,'Administrator set a new delivery partner password');})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,200,{ok:true,email:account.email});}
    const partnerDelete=route.match(/^\/api\/admin\/partners\/(\d+)$/);if(method==='DELETE'&&partnerDelete){if(user.role!=='admin')return json(res,403,{error:'Only an admin can remove delivery partners.'});const partnerId=Number(partnerDelete[1]);try{transaction(()=>{const partner=db.prepare("SELECT id FROM delivery_partners WHERE id=? AND status<>'deleted'").get(partnerId);if(!partner)throw Object.assign(new Error('Delivery partner not found.'),{status:404});const activeJob=db.prepare("SELECT o.order_number FROM delivery_assignments da JOIN orders o ON o.id=da.order_id WHERE da.partner_id=? AND da.status='accepted' AND o.status='out_for_delivery' LIMIT 1").get(partnerId);if(activeJob)throw Object.assign(new Error(`Complete or reassign active delivery ${activeJob.order_number} before removing this partner.`),{status:409});db.prepare("UPDATE delivery_partners SET status='deleted' WHERE id=?").run(partnerId);db.prepare('DELETE FROM partner_sessions WHERE partner_id=?').run(partnerId);audit(user.id,'deleted','delivery_partner',partnerId,'Partner removed from the admin list; order history preserved.');})();}catch(error){return json(res,error.status||500,{error:error.message});}return json(res,200,{ok:true});}
    const partnerApproval=route.match(/^\/api\/admin\/partners\/(\d+)\/status$/);if(method==='PATCH'&&partnerApproval){if(user.role!=='admin')return json(res,403,{error:'Only an admin can approve delivery partners.'});const input=await readBody(req),status=String(input.status||'');if(!['approved','rejected','suspended'].includes(status))return json(res,400,{error:'Choose an allowed partner status.'});const result=db.prepare('UPDATE delivery_partners SET status=? WHERE id=?').run(status,Number(partnerApproval[1]));if(!result.changes)return json(res,404,{error:'Partner application not found.'});audit(user.id,'status_changed','delivery_partner',partnerApproval[1],status);return json(res,200,{ok:true});}
    if(method==='GET'&&route==='/api/admin/delivery-staff'){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot assign deliveries.'});return json(res,200,{staff:db.prepare("SELECT id,name FROM staff WHERE role='delivery' AND active=1 ORDER BY name").all()});}
    const assignDriver=route.match(/^\/api\/admin\/orders\/(\d+)\/assign-driver$/);if(method==='POST'&&assignDriver){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot assign deliveries.'});const input=await readBody(req),orderId=Number(assignDriver[1]),staffId=Number(input.staffId),order=db.prepare("SELECT id,status FROM orders WHERE id=? AND order_type='delivery' AND status NOT IN ('cancelled','completed')").get(orderId),driver=db.prepare("SELECT id FROM staff WHERE id=? AND role='delivery' AND active=1").get(staffId);if(!order||!driver)return json(res,400,{error:'Choose an active delivery order and a current delivery staff member.'});db.prepare("INSERT INTO delivery_assignments(order_id,delivery_type,staff_id,status) VALUES(?,'hodman',?,'assigned') ON CONFLICT(order_id) DO UPDATE SET partner_id=NULL,staff_id=excluded.staff_id,delivery_type='hodman',status='assigned',assigned_at=CURRENT_TIMESTAMP,delivered_at=NULL").run(orderId,staffId);audit(user.id,'assigned','order',orderId,`Delivery staff ${staffId}`);return json(res,200,{ok:true});}
    const assignPartner=route.match(/^\/api\/admin\/orders\/(\d+)\/assign-partner$/);if(method==='POST'&&assignPartner){if(!requireRole(user,'admin','cashier'))return json(res,403,{error:'This role cannot assign deliveries.'});const input=await readBody(req),orderId=Number(assignPartner[1]),partnerId=Number(input.partnerId),order=db.prepare("SELECT id,status FROM orders WHERE id=? AND order_type='delivery' AND status NOT IN ('cancelled','completed')").get(orderId),partner=db.prepare("SELECT id,business_name FROM delivery_partners WHERE id=? AND status='approved'").get(partnerId);if(!order||!partner)return json(res,400,{error:'Choose an active delivery order and an approved delivery partner.'});const existing=db.prepare('SELECT status FROM delivery_assignments WHERE order_id=?').get(orderId);if(order.status==='out_for_delivery'&&['accepted','out_for_delivery'].includes(existing?.status))return json(res,409,{error:'This order is already on the way. Complete it before reassigning.'});db.prepare("INSERT INTO delivery_assignments(order_id,partner_id,delivery_type,status) VALUES(?,?,'partner','unassigned') ON CONFLICT(order_id) DO UPDATE SET partner_id=excluded.partner_id,staff_id=NULL,delivery_type='partner',status='unassigned',assigned_at=NULL,delivered_at=NULL").run(orderId,partnerId);audit(user.id,'assigned','order',orderId,`Delivery partner ${partner.id} · ${partner.business_name}`);return json(res,200,{ok:true,partnerName:partner.business_name});}
    if (method === 'PATCH' && route === '/api/admin/settings') {
      if(user.role!=='admin')return json(res,403,{error:'Only an admin can change settings.'});
      const input=await readBody(req), allowed={stock_deduction_trigger:['placed','paid','completed']};
      for(const [key,choices] of Object.entries(allowed)){if(input[key]!==undefined){if(!choices.includes(input[key]))return json(res,400,{error:`Choose a supported ${key.replaceAll('_',' ')}.`});db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,input[key]);}}
      return json(res,200,{ok:true});
    }
    if (method === 'POST' && route === '/api/admin/staff') {
      if(user.role!=='admin')return json(res,403,{error:'Only an admin can create staff accounts.'});
      const input=await readBody(req),name=String(input.name||'').trim(),username=String(input.username||'').trim().toLowerCase(),email=String(input.email||'').trim().toLowerCase(),password=String(input.password||''),role=String(input.role||'');
      if(name.length<2||!/^[a-z0-9._-]{3,40}$/.test(username)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||!['admin','cashier','storekeeper','delivery','kitchen'].includes(role))return json(res,400,{error:'Check the staff name, username, email, role, and use a password of at least 8 characters.'});
      const salt=crypto.randomBytes(16).toString('hex');try{const result=db.prepare('INSERT INTO staff(name,username,email,password_hash,salt,role) VALUES(?,?,?,?,?,?)').run(name,username,email,scrypt(password,salt),salt,role);audit(user.id,'created','staff',result.lastInsertRowid,role);return json(res,201,{id:Number(result.lastInsertRowid),name,username,email,role});}catch{return json(res,409,{error:'A staff account already uses that username or email.'});}
    }
    return json(res,404,{error:'Admin endpoint not found.'});
  }
  return json(res,404,{error:'API endpoint not found.'});
}
function createSession(res, staffId) {
  const token=crypto.randomBytes(32).toString('base64url'), expires=Date.now()+SESSION_MS;
  db.prepare('INSERT INTO sessions(token_hash,staff_id,expires_at,created_at) VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),staffId,expires,Date.now());
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  return json(res,200,{ok:true},{'set-cookie':`hodman_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`});
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'content-type'});return res.end();}
  if(url.pathname.startsWith('/api/')){try{return await api(req,res,url);}catch(error){console.error(error);if(!res.headersSent)return json(res,error.status||500,{error:error.status?error.message:'Something went wrong. Please try again.'});return res.end();}}
  const requested=url.pathname==='/'?'/index.html':url.pathname;
  const file=path.resolve(ROOT,'public',`.${decodeURIComponent(requested)}`);
  if(!file.startsWith(path.resolve(ROOT,'public')+path.sep)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,contents)=>{if(err){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});return res.end('Page not found');}res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'});res.end(contents);});
});
server.listen(PORT,HOST,()=>console.log(`Hodman Restaurant is ready at http://localhost:${PORT}`));
