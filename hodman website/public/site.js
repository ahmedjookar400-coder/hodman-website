const state = { menu: { categories: [], products: [] }, category: 'all', query: '', cart: [] };
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const el = (selector, root = document) => root.querySelector(selector);
const toast = message => { const node = el('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 3500); };
if (el('#year')) el('#year').textContent = new Date().getFullYear();
if (el('.menu-toggle') && el('.main-nav')) {
  el('.menu-toggle').addEventListener('click', event => { const open = el('.main-nav').classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  el('.main-nav').addEventListener('click', event => { if (event.target.closest('a')) { el('.main-nav').classList.remove('open'); el('.menu-toggle').setAttribute('aria-expanded', 'false'); } });
}
const renderMenu = () => {
  const { categories, products } = state.menu;
  const filtered = products.filter(product => (state.category === 'all' || String(product.category_id) === state.category) && `${product.name} ${product.description}`.toLowerCase().includes(state.query.toLowerCase()));
  el('#category-list').innerHTML = categories.length ? ['<button class="category-chip active" data-category="all">Everything</button>', ...categories.map(category => `<button class="category-chip ${state.category === String(category.id) ? 'active' : ''}" data-category="${category.id}">${escapeHtml(category.name)}</button>`)].join('') : '';
  el('#category-list').querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { state.category = button.dataset.category; renderMenu(); }));
  el('#menu-grid').innerHTML = filtered.length ? filtered.map(product => `<article class="product-card"><div class="product-image">${product.image_url ? `<img src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}" loading="lazy">` : `<span class="plate-art">♡<small>HODMAN</small></span>`}<span class="product-tag">MADE WITH CARE</span></div><div class="product-info"><div><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description || '')}</p></div><div class="product-buy"><strong>${money(product.price_cents)}</strong><button data-add="${product.id}" aria-label="Add ${escapeAttr(product.name)} to order">+</button></div></div></article>`).join('') : `<p class="loading-note">${products.length ? 'No dishes match your search. Try another name.' : 'Our menu is being prepared. Call us at <a href="tel:0613007711">061 300 7711</a> to order.'}</p>`;
  el('#menu-grid').querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => { const product = products.find(item => item.id === Number(button.dataset.add)); const existing = state.cart.find(item => item.productId === product.id); existing ? existing.quantity++ : state.cart.push({ productId: product.id, name: product.name, price: product.price_cents, quantity: 1 }); renderCart(); toast(`${product.name} added to your order.`); }));
};
const renderCart = () => {
  const quantity = state.cart.reduce((sum, item) => sum + item.quantity, 0), total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  el('#cart-fab').hidden = !quantity; el('#cart-count').textContent = quantity; el('#cart-total').textContent = money(total);
  el('#cart-body').innerHTML = state.cart.map(item => `<div class="cart-item"><div><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} each</small></div><div class="quantity-stepper"><button type="button" data-qty="${item.productId}" data-delta="-1" aria-label="Remove one">−</button><span>${item.quantity}</span><button type="button" data-qty="${item.productId}" data-delta="1" aria-label="Add one">+</button></div><strong>${money(item.price * item.quantity)}</strong></div>`).join('') + `<div class="cart-total"><span>Subtotal</span><strong>${money(total)}</strong></div>`;
  el('#cart-body').querySelectorAll('[data-qty]').forEach(button => button.addEventListener('click', () => { const item = state.cart.find(row => row.productId === Number(button.dataset.qty)); item.quantity += Number(button.dataset.delta); if (item.quantity <= 0) state.cart = state.cart.filter(row => row !== item); renderCart(); }));
};
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]); }
function escapeAttr(value = '') { return escapeHtml(value); }
el('#menu-search').addEventListener('input', event => { state.query = event.target.value; renderMenu(); });
el('#open-cart').addEventListener('click', () => { renderCart(); el('#cart-modal').showModal(); });
el('#checkout-form [name="orderType"]').addEventListener('change', event => { const show = event.target.value === 'delivery'; el('.delivery-address').hidden = !show; el('.delivery-address textarea').required = show; });
el('#checkout-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.cart.length) return toast('Your order is empty.');
  const form = new FormData(event.currentTarget), payload = Object.fromEntries(form.entries()); payload.items = state.cart.map(({ productId, quantity }) => ({ productId, quantity }));
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true; button.textContent = 'Sending your order…';
  try { const response = await fetch('/api/public/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'We could not send your order.'); state.cart = []; renderCart(); el('#checkout-form').reset(); el('#cart-modal').close(); el('#confirmation-number').textContent=result.orderNumber;el('#confirmation-message').textContent=`Your total is ${money(result.totalCents)}. Our team will confirm your order shortly.`;el('#order-confirmation').showModal(); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Place order <span aria-hidden="true">↗</span>'; }
});
if (el('#track-this-order')) el('#track-this-order').addEventListener('click',()=>{el('#order-confirmation').close();setTimeout(()=>el('#track').scrollIntoView({behavior:'smooth'}),100);el('#tracking-form [name="orderNumber"]').value=el('#confirmation-number').textContent;});
if (el('#open-reservation')) el('#open-reservation').addEventListener('click', () => el('#reservation-modal').showModal());
if (el('#reservation-form')) el('#reservation-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget), payload = Object.fromEntries(form.entries()); payload.guests = Number(payload.guests); payload.date = new Date(`${payload.date}:00+03:00`).toISOString();
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try { const response = await fetch('/api/public/reservations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'We could not send your request.'); el('#reservation-modal').close(); event.currentTarget.reset(); toast(result.message); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
if (el('#tracking-form')) el('#tracking-form').addEventListener('submit',async event=>{event.preventDefault();const values=new URLSearchParams(new FormData(event.currentTarget));const result=el('#tracking-result');result.textContent='Looking up your order…';try{const response=await fetch(`/api/public/orders/track?${values}`);const data=await response.json();if(!response.ok)throw new Error(data.error||'We could not find that order.');result.innerHTML=`<strong>${escapeHtml(data.orderNumber)} · ${escapeHtml(data.statusLabel)}</strong><br>${escapeHtml(data.items)}<br>Total ${money(data.totalCents)} · payment ${escapeHtml(data.paymentStatus.replace('_',' '))}${data.deliveryStatus?`<br>Delivery ${escapeHtml(data.deliveryStatus.replace('_',' '))}`:''}`;}catch(error){result.textContent=error.message;}});
fetch('/api/public/menu').then(response => { if (!response.ok) throw new Error('Menu is temporarily unavailable. Please call Hodman to order.'); return response.json(); }).then(menu => { state.menu = menu; renderMenu(); if (new URLSearchParams(location.search).has('start')) setTimeout(() => { el('#menu-grid').scrollIntoView({ behavior: 'smooth', block: 'start' }); el('#menu-search').focus({ preventScroll: true }); }, 100); }).catch(() => { el('#menu-grid').innerHTML = '<p class="loading-note">We could not load the menu right now. Please call <a href="tel:0613007711">061 300 7711</a> and our team will help with your order.</p>'; });
