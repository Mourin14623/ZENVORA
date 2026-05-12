const page = document.body.dataset.page;
const config = window.ZENVORA_CONFIG || {};
const hasConfig = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !config.SUPABASE_URL.includes('YOUR_'));
const db = hasConfig ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
const cartKey = 'zenvora.cart.v3';

let session = null;
let profile = null;
let products = [];
let orders = [];
let reviews = [];
let authMode = 'login';
let filters = { search: '', category: 'all', price: 500, rating: 0, stock: false, sort: 'featured' };

const $ = (selector) => document.querySelector(selector);
const on = (selector, event, handler) => { const node = $(selector); if (node) node.addEventListener(event, handler); };
const money = (value) => `$${Number(value || 0).toFixed(2)}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cart = () => JSON.parse(localStorage.getItem(cartKey) || '[]');
const saveCart = (items) => localStorage.setItem(cartKey, JSON.stringify(items));
const isAdmin = () => profile?.role === 'admin';

function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  setTimeout(() => node.classList.remove('show'), 2600);
}

function showSetupNotice() {
  const node = $('#setupNotice');
  if (!node || hasConfig) return;
  node.innerHTML = '<strong>Supabase setup needed.</strong> Add your project URL and anon key to <code>config.js</code>, then run <code>supabase/schema.sql</code> in Supabase SQL Editor.';
}

async function init() {
  showSetupNotice();
  if (!db) {
    products = fallbackProducts();
    renderAll();
    return;
  }
  const auth = await db.auth.getSession();
  session = auth.data.session;
  await loadProfile();
  await loadData();
  bindRealtime();
  renderAll();
}

async function loadProfile() {
  if (!session?.user) {
    profile = null;
    return;
  }
  const { data, error } = await db.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) {
    console.warn(error);
    profile = { id: session.user.id, email: session.user.email, name: session.user.email, role: 'customer' };
  } else {
    profile = data;
  }
}

async function loadData() {
  await Promise.all([loadProducts(), loadReviews(), loadOrders()]);
}

async function loadProducts() {
  if (!db) return;
  let query = db.from('products').select('*').order('created_at', { ascending: false });
  if (page === 'store') query = query.eq('active', true).gt('stock', 0);
  const { data, error } = await query;
  if (error) return toast(error.message);
  products = data || [];
}

async function loadReviews() {
  if (!db) return;
  const { data } = await db.from('reviews').select('*, profiles(name)').order('created_at', { ascending: false });
  reviews = data || [];
}

async function loadOrders() {
  if (!db || !session?.user) {
    orders = [];
    return;
  }
  const select = '*, order_items(*), profiles(name,email)';
  const query = isAdmin()
    ? db.from('orders').select(select).order('created_at', { ascending: false })
    : db.from('orders').select(select).eq('user_id', session.user.id).order('created_at', { ascending: false });
  const { data, error } = await query;
  if (error) return console.warn(error);
  orders = data || [];
}

function bindRealtime() {
  if (!db) return;
  db.channel('zenvora-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => { await loadProducts(); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => { await loadOrders(); renderAll(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, async () => { await loadOrders(); renderAll(); })
    .subscribe();
}

function fallbackProducts() {
  return [
    { id: 'demo-watch', name: 'Aurora Smart Watch', category: 'Tech', price: 189, rating: 4.8, stock: 14, label: 'WATCH', color: 'linear-gradient(135deg,#dff2ee,#f8e3d9)', description: 'Connect Supabase to load shared products.' },
    { id: 'demo-care', name: 'Botanical Skin Duo', category: 'Beauty', price: 78, rating: 4.9, stock: 7, label: 'CARE', color: 'linear-gradient(135deg,#edf7ef,#ffe5df)', description: 'Demo product shown until Supabase is configured.' }
  ];
}

function renderAll() {
  renderAuthButton();
  renderCategories();
  renderProducts();
  renderCart();
  renderAccount();
  renderInventory();
  renderStorage();
  renderOrders();
  renderAdmin();
}

function renderAuthButton() {
  const button = $('#authButton');
  if (button) button.textContent = session?.user ? 'Logout' : 'Login';
}

function renderCategories() {
  const select = $('#categoryFilter');
  if (!select) return;
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
  select.innerHTML = '<option value="all">All categories</option>' + categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
}

function filteredProducts() {
  const query = filters.search.trim().toLowerCase();
  const list = products.filter((product) => {
    const text = `${product.name} ${product.category} ${product.description}`.toLowerCase();
    return (!query || text.includes(query)) &&
      (filters.category === 'all' || product.category === filters.category) &&
      Number(product.price) <= filters.price &&
      Number(product.rating || 0) >= filters.rating &&
      (!filters.stock || Number(product.stock) > 0);
  });
  return list.sort((a, b) => {
    if (filters.sort === 'price-low') return Number(a.price) - Number(b.price);
    if (filters.sort === 'price-high') return Number(b.price) - Number(a.price);
    if (filters.sort === 'rating') return Number(b.rating || 0) - Number(a.rating || 0);
    return 0;
  });
}

function renderProducts() {
  const grid = $('#productGrid');
  if (!grid) return;
  const list = filteredProducts();
  $('#resultCount').textContent = `${list.length} product${list.length === 1 ? '' : 's'}`;
  grid.innerHTML = list.length ? list.map(productCard).join('') : '<div class="empty-state">No products match these filters.</div>';
}

function productCard(product) {
  return `<article class="product-card">
    <button class="product-art" style="--art:${product.color || 'linear-gradient(135deg,#dff2ee,#f8e3d9)'}" type="button" data-view="${product.id}"><span>${escapeHtml(product.label || 'ITEM')}</span></button>
    <div class="product-body">
      <div class="product-meta"><span>${escapeHtml(product.category)}</span><span class="badge ${product.stock <= 7 ? 'low' : ''}">${product.stock ? `${product.stock} left` : 'Sold out'}</span></div>
      <h3>${escapeHtml(product.name)}</h3>
      <div class="rating-row"><span>${'STAR '.repeat(Math.round(product.rating || 0))}</span><span>${product.rating || 0}</span></div>
      <p>${escapeHtml(product.description)}</p>
      <div class="product-actions"><span class="price">${money(product.price)}</span><button class="primary" type="button" data-add="${product.id}" ${product.stock < 1 ? 'disabled' : ''}>Add</button></div>
    </div>
  </article>`;
}

function renderCart() {
  if (!$('#cartCount')) return;
  const items = cart();
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = subtotal > 0 && subtotal < 150 ? 12 : 0;
  $('#cartCount').textContent = items.reduce((sum, item) => sum + item.quantity, 0);
  $('#cartSubtotal').textContent = money(subtotal);
  $('#cartShipping').textContent = shipping ? money(shipping) : 'Free';
  $('#cartTotal').textContent = money(subtotal + shipping);
  $('#checkoutTotal').textContent = money(subtotal + shipping);
  $('#cartItems').innerHTML = items.length ? items.map((item) => `<div class="cart-item"><strong>${escapeHtml(item.name)}</strong><span>${money(item.price)} each</span><div class="qty-row"><button class="secondary" type="button" data-decrease="${item.id}">-</button><strong>${item.quantity}</strong><button class="secondary" type="button" data-increase="${item.id}">+</button><button class="text-button" type="button" data-remove="${item.id}">Remove</button></div></div>`).join('') : '<div class="empty-state">Your cart is empty.</div>';
}

function renderAccount() {
  const panel = $('#accountPanel');
  if (!panel) return;
  if (!session?.user) {
    panel.innerHTML = '<p>Create an account to save orders and checkout faster.</p><button class="primary full" id="accountLoginButton" type="button">Login or Register</button>';
    return;
  }
  panel.innerHTML = `<div class="account-line"><span>Name</span><strong>${escapeHtml(profile?.name || session.user.email)}</strong></div><div class="account-line"><span>Email</span><strong>${escapeHtml(session.user.email)}</strong></div><div class="account-line"><span>Role</span><strong>${isAdmin() ? 'Owner' : 'Customer'}</strong></div><div class="account-line"><span>Orders</span><strong>${orders.length}</strong></div><button class="secondary full" id="logoutButton" type="button">Logout</button>`;
}

function renderInventory() {
  const panel = $('#inventoryPanel');
  if (!panel) return;
  panel.innerHTML = products.map((product) => `<div class="inventory-item"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} - ${money(product.price)}</span><div class="qty-row"><strong>${product.stock} in stock</strong></div></div>`).join('');
}

function renderStorage() {
  const panel = $('#storagePanel');
  if (!panel) return;
  const rows = [['Products', products.length], ['Orders', orders.length], ['Reviews', reviews.length], ['Backend', db ? 'Supabase' : 'Setup needed']];
  panel.innerHTML = rows.map(([label, value]) => `<div class="storage-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderOrders() {
  const panel = $('#ordersPanel');
  if (!panel) return;
  if (!session?.user) {
    panel.innerHTML = '<div class="empty-state">Login to see your orders.</div>';
    return;
  }
  panel.innerHTML = orders.length ? orders.map(orderCard).join('') : '<div class="empty-state">No orders yet.</div>';
}

function orderCard(order) {
  const items = order.order_items || [];
  return `<article class="order-card"><header><div><strong>${escapeHtml(order.order_number)}</strong><p>${new Date(order.created_at).toLocaleString()}</p></div><span class="badge">${escapeHtml(order.status)}</span></header><p>${items.map((item) => `${item.quantity} x ${escapeHtml(item.product_name)}`).join(', ')}</p><p><strong>${money(order.total)}</strong> paid with ${escapeHtml(order.payment_method)}</p>${isAdmin() ? `<p>Customer: ${escapeHtml(order.profiles?.name || 'Customer')} - ${escapeHtml(order.profiles?.email || '')}</p>` : ''}</article>`;
}

function renderAdmin() {
  const panel = $('#adminPanel');
  if (!panel) return;
  if (!db) {
    panel.innerHTML = '<article class="panel admin-intro"><h3>Connect Supabase</h3><p>Add your Supabase URL and anon key to <code>config.js</code>, then run the SQL schema before using admin.</p></article>';
    return;
  }
  if (!session?.user) {
    panel.innerHTML = '<article class="panel admin-intro"><h3>Owner Login Required</h3><p>Login with an account whose profile role is <code>admin</code>.</p><button class="primary" type="button" id="adminLoginButton">Login</button></article>';
    return;
  }
  if (!isAdmin()) {
    panel.innerHTML = `<article class="panel admin-intro"><h3>Admin Access Needed</h3><p>You are logged in as ${escapeHtml(session.user.email)}. Promote this user to admin in Supabase using the SQL command in <code>supabase/schema.sql</code>.</p></article>`;
    return;
  }
  panel.innerHTML = `<article class="panel add-product-panel"><h3>Add Product</h3><form id="productForm" class="product-form"><label>Name<input id="newProductName" required></label><label>Category<input id="newProductCategory" required></label><label>Price<input id="newProductPrice" type="number" min="1" step="0.01" required></label><label>Stock<input id="newProductStock" type="number" min="0" step="1" required></label><label>Label<input id="newProductLabel" maxlength="8" placeholder="ITEM"></label><label class="wide">Description<textarea id="newProductDescription" rows="3" required></textarea></label><button class="primary full" type="submit">Add to Product Database</button></form></article><article class="panel database-panel"><div class="panel-head"><h3>Product Database</h3><span>${products.filter((product) => product.stock > 0 && product.active).length} available / ${products.length} total</span></div><div class="database-list">${products.map(productRow).join('')}</div></article><article class="panel received-orders-panel"><div class="panel-head"><h3>Orders Received</h3><span>${orders.length} orders</span></div><div class="received-orders">${orders.length ? orders.map(receivedOrder).join('') : '<div class="empty-state">No customer orders yet.</div>'}</div></article>`;
}

function productRow(product) {
  return `<form class="database-row" data-product-editor="${product.id}"><div class="database-main"><strong>${escapeHtml(product.name)}</strong><span class="badge ${product.stock < 1 || !product.active ? 'low' : ''}">${product.stock > 0 && product.active ? 'Available' : 'Sold out'}</span></div><div class="database-fields"><label>Name<input name="name" value="${escapeHtml(product.name)}" required></label><label>Category<input name="category" value="${escapeHtml(product.category)}" required></label><label>Price<input name="price" type="number" min="1" step="0.01" value="${product.price}" required></label><label>Stock<input name="stock" type="number" min="0" step="1" value="${product.stock}" required></label><label class="wide">Description<textarea name="description" rows="2" required>${escapeHtml(product.description)}</textarea></label></div><div class="database-actions"><button class="primary" type="submit">Save Changes</button><button class="secondary" type="button" data-soldout="${product.id}">Mark Sold Out</button><button class="secondary" type="button" data-restock="${product.id}">Restock +10</button></div></form>`;
}

function receivedOrder(order) {
  return `<div class="received-order"><div class="database-main"><strong>${escapeHtml(order.order_number)}</strong><span class="badge">${escapeHtml(order.status)}</span></div><p>${(order.order_items || []).map((item) => `${item.quantity} x ${escapeHtml(item.product_name)}`).join(', ')}</p><p><strong>${money(order.total)}</strong> via ${escapeHtml(order.payment_method)}</p><p>Customer: ${escapeHtml(order.profiles?.name || 'Customer')} - ${escapeHtml(order.profiles?.email || '')}</p><p>Ship to: ${escapeHtml(order.shipping_address)}, ${escapeHtml(order.shipping_city)} ${escapeHtml(order.shipping_zip)}</p></div>`;
}

function openAuth(mode = 'login') {
  authMode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'Login' : 'Register';
  $('#authSubmit').textContent = mode === 'login' ? 'Login' : 'Create Account';
  $('#toggleAuth').textContent = mode === 'login' ? 'Create an account' : 'Already have an account';
  $('#authName').parentElement.style.display = mode === 'login' ? 'none' : 'grid';
  if (!$('#authDialog').open) $('#authDialog').showModal();
}

async function handleAuth(event) {
  event.preventDefault();
  if (!db) return toast('Add Supabase config first.');
  const email = $('#authEmail').value.trim().toLowerCase();
  const password = $('#authPassword').value;
  const name = $('#authName').value.trim() || email.split('@')[0];
  const result = authMode === 'register'
    ? await db.auth.signUp({ email, password, options: { data: { name } } })
    : await db.auth.signInWithPassword({ email, password });
  if (result.error) return toast(result.error.message);
  session = result.data.session;
  $('#authDialog').close();
  $('#authForm').reset();
  await loadProfile();
  await loadData();
  renderAll();
  toast(authMode === 'register' ? 'Account created. Check email if confirmation is enabled.' : 'Logged in.');
}

async function logout() {
  if (db) await db.auth.signOut();
  session = null;
  profile = null;
  orders = [];
  renderAll();
  toast('Logged out.');
}

function addToCart(productId) {
  const product = products.find((entry) => entry.id === productId);
  if (!product || product.stock < 1) return toast('This product is unavailable.');
  const items = cart();
  const existing = items.find((item) => item.id === productId);
  if (existing) existing.quantity += 1;
  else items.push({ id: product.id, name: product.name, price: Number(product.price), quantity: 1 });
  saveCart(items);
  renderCart();
  toast(`${product.name} added to cart.`);
}

function updateCart(productId, change) {
  const items = cart();
  const item = items.find((entry) => entry.id === productId);
  if (!item) return;
  item.quantity += change;
  saveCart(items.filter((entry) => entry.quantity > 0));
  renderCart();
}

async function checkout(event) {
  if (event) event.preventDefault();
  if (!db) return toast('Add Supabase config first.');
  if (!session?.user) return openAuth('login');
  if (!cart().length) return toast('Add products before checkout.');
  $('#shipName').value = profile?.name || session.user.email;
  if (!$('#checkoutDialog').open) $('#checkoutDialog').showModal();
}

async function placeOrder(event) {
  event.preventDefault();
  const items = cart();
  if (!items.length) return;
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shipping = subtotal > 0 && subtotal < 150 ? 12 : 0;
  const orderNumber = `ZV-${Date.now().toString().slice(-6)}`;
  const { data: order, error } = await db.from('orders').insert({
    order_number: orderNumber,
    user_id: session.user.id,
    status: 'Confirmed',
    payment_method: new FormData($('#checkoutForm')).get('payment'),
    shipping_name: $('#shipName').value,
    shipping_phone: $('#shipPhone').value,
    shipping_address: $('#shipAddress').value,
    shipping_city: $('#shipCity').value,
    shipping_zip: $('#shipZip').value,
    subtotal,
    shipping,
    total: subtotal + shipping
  }).select().single();
  if (error) return toast(error.message);
  const orderItems = items.map((item) => ({ order_id: order.id, product_id: item.id, product_name: item.name, price: item.price, quantity: item.quantity }));
  const itemResult = await db.from('order_items').insert(orderItems);
  if (itemResult.error) return toast(itemResult.error.message);
  await Promise.all(items.map((item) => db.rpc('decrement_product_stock', { product_id_input: item.id, amount_input: item.quantity })));
  saveCart([]);
  $('#checkoutDialog').close();
  $('#cartDrawer').classList.remove('open');
  $('#checkoutForm').reset();
  await loadData();
  renderAll();
  location.hash = 'orders';
  toast(`Order ${orderNumber} placed.`);
}

async function addProduct(event) {
  event.preventDefault();
  const stock = Number($('#newProductStock').value);
  const { error } = await db.from('products').insert({
    name: $('#newProductName').value.trim(),
    category: $('#newProductCategory').value.trim(),
    price: Number($('#newProductPrice').value),
    stock,
    active: stock > 0,
    label: $('#newProductLabel').value.trim() || 'ITEM',
    description: $('#newProductDescription').value.trim(),
    color: productColor($('#newProductCategory').value.trim())
  });
  if (error) return toast(error.message);
  $('#productForm').reset();
  await loadProducts();
  renderAll();
  toast('Product added.');
}

async function saveProduct(form) {
  const data = new FormData(form);
  const stock = Number(data.get('stock'));
  const { error } = await db.from('products').update({ name: data.get('name').trim(), category: data.get('category').trim(), price: Number(data.get('price')), stock, active: stock > 0, description: data.get('description').trim() }).eq('id', form.dataset.productEditor);
  if (error) return toast(error.message);
  await loadProducts();
  renderAll();
  toast('Product updated.');
}

async function markSoldOut(productId) {
  const { error } = await db.from('products').update({ stock: 0, active: false }).eq('id', productId);
  if (error) return toast(error.message);
  await loadProducts();
  renderAll();
}

async function restock(productId) {
  const product = products.find((entry) => entry.id === productId);
  const { error } = await db.from('products').update({ stock: Number(product.stock) + 10, active: true }).eq('id', productId);
  if (error) return toast(error.message);
  await loadProducts();
  renderAll();
}

async function postReview(form) {
  if (!session?.user) return openAuth('login');
  const data = new FormData(form);
  const { error } = await db.from('reviews').insert({ product_id: form.dataset.review, user_id: session.user.id, rating: Number(data.get('rating')), text: data.get('text').trim() });
  if (error) return toast(error.message);
  await loadReviews();
  form.reset();
  toast('Review posted.');
}

function productColor(seed) {
  const palettes = ['linear-gradient(135deg,#dff2ee,#f8e3d9)', 'linear-gradient(135deg,#e9edf4,#d8f0eb)', 'linear-gradient(135deg,#fff8ea,#d8f0eb)', 'linear-gradient(135deg,#ffe4de,#f8f6ec)'];
  return palettes[Math.abs(seed.length) % palettes.length];
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button,a');
    if (!target) return;
    if (target.dataset.add) addToCart(target.dataset.add);
    if (target.dataset.increase) updateCart(target.dataset.increase, 1);
    if (target.dataset.decrease) updateCart(target.dataset.decrease, -1);
    if (target.dataset.remove) { saveCart(cart().filter((item) => item.id !== target.dataset.remove)); renderCart(); }
    if (target.dataset.soldout) await markSoldOut(target.dataset.soldout);
    if (target.dataset.restock) await restock(target.dataset.restock);
    if (target.id === 'accountLoginButton' || target.id === 'adminLoginButton') openAuth('login');
    if (target.id === 'logoutButton') await logout();
  });
  document.addEventListener('submit', async (event) => {
    if (event.target.id === 'productForm') return addProduct(event);
    const editor = event.target.closest('[data-product-editor]');
    if (editor) { event.preventDefault(); return saveProduct(editor); }
    const reviewForm = event.target.closest('[data-review]');
    if (reviewForm) { event.preventDefault(); return postReview(reviewForm); }
  });
  on('#searchForm', 'submit', (event) => { event.preventDefault(); filters.search = $('#searchInput').value; location.hash = 'products'; renderProducts(); });
  on('#searchInput', 'input', (event) => { filters.search = event.target.value; renderProducts(); });
  on('#categoryFilter', 'change', (event) => { filters.category = event.target.value; renderProducts(); });
  on('#priceFilter', 'input', (event) => { filters.price = Number(event.target.value); $('#priceValue').textContent = `$${filters.price}`; renderProducts(); });
  on('#ratingFilter', 'change', (event) => { filters.rating = Number(event.target.value); renderProducts(); });
  on('#stockFilter', 'change', (event) => { filters.stock = event.target.checked; renderProducts(); });
  on('#sortFilter', 'change', (event) => { filters.sort = event.target.value; renderProducts(); });
  on('#clearFilters', 'click', () => { filters = { search: '', category: 'all', price: 500, rating: 0, stock: false, sort: 'featured' }; $('#searchInput').value = ''; $('#categoryFilter').value = 'all'; $('#priceFilter').value = 500; $('#priceValue').textContent = '$500'; $('#ratingFilter').value = 0; $('#stockFilter').checked = false; $('#sortFilter').value = 'featured'; renderProducts(); });
  on('#openCart', 'click', () => $('#cartDrawer').classList.add('open'));
  on('#closeCart', 'click', () => $('#cartDrawer').classList.remove('open'));
  on('#checkoutButton', 'click', checkout);
  on('#checkoutForm', 'submit', placeOrder);
  on('#closeCheckout', 'click', () => $('#checkoutDialog').close());
  on('#authButton', 'click', () => session?.user ? logout() : openAuth('login'));
  on('#authForm', 'submit', handleAuth);
  on('#closeAuth', 'click', () => $('#authDialog').close());
  on('#toggleAuth', 'click', () => openAuth(authMode === 'login' ? 'register' : 'login'));
}

bindEvents();
init();
