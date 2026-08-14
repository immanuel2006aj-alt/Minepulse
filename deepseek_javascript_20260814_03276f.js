// ============================================================
// MINEPULSE – APP.JS (FULLY BRANDED, RENDER BACKEND)
// Fixed: Chimera SET_USER now sent with a delay to ensure worker is active.
// ============================================================

// ---------- CONFIG ----------
const CONFIG = {
  SUPABASE_URL: 'https://rwdkpjtrqmcildnhccwg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3ZGtwanRycW1jaWxkbmhjY3dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2Mjg4MzIsImV4cCI6MjEwMjIwNDgzMn0.qpkXHXCKoUA3hFGRgrZNkYHvvhwOUJKHDXcmvoS7w4Y',
  API_BASE: 'https://minepulse-backend.onrender.com',
};

// ---------- STATE ----------
let state = {
  isMining: false,
  hashrate: 0,
  earned: 0,
  status: 'inactive',
  weeklyPending: 0,
  history: [],
  dailyReset: new Date(),
  ws: null,
  user: null,
  isLoggedIn: false,
  currentPage: 'dashboard',
};

// ---------- DOM REFS ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================================
// CUSTOM MODAL SYSTEM (replaces alert/confirm)
// ============================================================
function showMessage(title, message, callback = null) {
  const modal = document.getElementById('custom-alert-modal');
  const titleEl = document.getElementById('alert-title');
  const msgEl = document.getElementById('alert-message');
  const okBtn = document.getElementById('alert-ok-btn');

  if (!modal) {
    alert(message);
    if (callback) callback(true);
    return;
  }

  titleEl.textContent = title || 'MinePulse';
  msgEl.textContent = message;

  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);

  modal.style.display = 'flex';

  newBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    if (callback) callback(true);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
      if (callback) callback(true);
    }
  });
}

// ---------- UTILITY ----------
function formatINR(amount) {
  return '₹' + amount.toFixed(2);
}
function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- SUPABASE HELPERS ----------
async function supabaseRequest(path, method, body) {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': CONFIG.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error);
  }
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch (e) {
    return [];
  }
}

// ---------- PAGE ROUTING ----------
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  if (pageId === 'page-dashboard') {
    showSubpage(state.currentPage || 'dashboard');
    document.querySelector('.page-title').textContent = 
      state.currentPage.charAt(0).toUpperCase() + state.currentPage.slice(1);
  }
}

function showSubpage(subpage) {
  state.currentPage = subpage;
  document.querySelectorAll('.subpage').forEach(el => el.style.display = 'none');
  const target = document.getElementById(`subpage-${subpage}`);
  if (target) {
    target.style.display = 'block';
    target.classList.add('active');
  }
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === subpage);
  });
  const titleMap = {
    dashboard: 'Dashboard',
    mining: 'Mining',
    payouts: 'Payouts',
    resources: 'Resources',
    settings: 'Settings',
    help: 'Help'
  };
  document.querySelector('.page-title').textContent = titleMap[subpage] || 'Dashboard';
}

// ---------- AUTH (SUPABASE) ----------
async function handleRegister(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  const method = $('payout-method-select').value;
  const wallet = $('wallet-address-input').value.trim();
  const referral = $('referral').value.trim();

  if (!username || password.length < 6) {
    showMessage('MinePulse', 'Username required, password min 6 chars.');
    return;
  }
  if (!wallet) {
    showMessage('MinePulse', 'Please enter your wallet/UPI address.');
    return;
  }

  const refCode = username.slice(0, 4).toUpperCase() + Math.floor(Math.random() * 1000);
  try {
    await supabaseRequest('/users', 'POST', {
      username, password, payout_method: method, wallet_address: wallet,
      referral_code: refCode, referred_by: null,
    });

    const users = await supabaseRequest(`/users?username=eq.${encodeURIComponent(username)}`, 'GET');
    if (!users || users.length === 0) throw new Error('User not found after creation');
    const user = users[0];

    state.user = { id: user.id, username: user.username, payout_method: user.payout_method, wallet_address: user.wallet_address };
    state.isLoggedIn = true;
    localStorage.setItem('minepulse_session', JSON.stringify({ userId: user.id, username: user.username }));
    showPage('page-dashboard');
    showSubpage('dashboard');
    updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
    registerPush();
    initChimera();
    fetchResources();
    addNotification('Welcome to MinePulse!', 'Start mining now and earn ₹70 daily.', 'success');
  } catch (err) {
    showMessage('Registration Failed', err.message);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  try {
    const users = await supabaseRequest(`/users?username=eq.${encodeURIComponent(username)}&password=eq.${encodeURIComponent(password)}`, 'GET');
    if (!users || users.length === 0) {
      showMessage('Login Failed', 'Invalid credentials.');
      return;
    }
    const user = users[0];
    state.user = { id: user.id, username: user.username, payout_method: user.payout_method, wallet_address: user.wallet_address };
    state.isLoggedIn = true;
    localStorage.setItem('minepulse_session', JSON.stringify({ userId: user.id, username: user.username }));
    showPage('page-dashboard');
    showSubpage('dashboard');
    updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
    registerPush();
    initChimera();
    fetchResources();
  } catch (err) {
    showMessage('Login Failed', err.message);
  }
}

function logout() {
  state.isLoggedIn = false; state.user = null;
  if (state.ws) { state.ws.close(); state.ws = null; }
  localStorage.removeItem('minepulse_session');
  showPage('page-landing');
}

// ---------- CHIMERA WORKER (FIXED) ----------
async function initChimera() {
  if (!state.user || !state.user.id) {
    console.warn('[App] No user to set in Chimera.');
    return;
  }
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('chimera-worker.js');
      
      // Wait for the worker to be ready
      let worker = reg.active || reg.waiting || reg.installing;
      
      // If not active, wait for activation
      if (!worker) {
        await new Promise(resolve => {
          reg.addEventListener('activate', () => {
            worker = reg.active;
            resolve();
          });
        });
      }
      
      // If worker is still not ready, wait a moment
      if (!worker) {
        await new Promise(resolve => setTimeout(resolve, 500));
        worker = reg.active;
      }
      
      if (worker) {
        // Send SET_USER message with a small delay to ensure worker is listening
        setTimeout(() => {
          worker.postMessage({ type: 'SET_USER', userId: state.user.id });
          console.log('[App] SET_USER sent to Chimera:', state.user.id);
        }, 300);
      } else {
        console.warn('[App] No active worker found.');
      }
    } catch (e) {
      console.warn('[App] Chimera reg error:', e);
    }
  } else {
    console.warn('[App] Service workers not supported.');
  }
}

// ---------- DASHBOARD UPDATES ----------
function updateDashboard(data) {
  if (data.hashrate !== undefined) {
    state.hashrate = data.hashrate;
    $('hashrate').textContent = data.hashrate.toFixed(1) + ' H/s';
    updateGraph(data.hashrate);
    $('graph-hash').textContent = data.hashrate.toFixed(1) + ' H/s';
    if (!state.peak || data.hashrate > state.peak) state.peak = data.hashrate;
    if (!state.avg) state.avg = data.hashrate;
    else state.avg = (state.avg + data.hashrate) / 2;
    $('graph-peak').textContent = (state.peak || 0).toFixed(1) + ' H/s';
    $('graph-avg').textContent = (state.avg || 0).toFixed(1) + ' H/s';
  }
  if (data.earned !== undefined) {
    state.earned = data.earned;
    const displayEarned = Math.min(data.earned, 70);
    $('today-earned').textContent = '₹' + displayEarned.toFixed(2);
    const pct = Math.min((data.earned / 70) * 100, 100);
    $('daily-progress').style.width = pct + '%';
    $('daily-progress-label').textContent = (data.earned >= 70) ? '100% ✅' : pct.toFixed(0) + '%';
    const badge = $('target-badge');
    badge.style.display = (data.earned >= 70) ? 'inline-flex' : 'none';
  }
  if (data.status !== undefined) {
    state.status = data.status;
    const statusEl = $('mining-status');
    const dotEl = $('mining-status-dot');
    if (data.status === 'active') {
      statusEl.textContent = 'ACTIVE';
      statusEl.style.color = 'var(--success)';
      dotEl.className = 'status-dot active';
      $('mining-btn').textContent = 'MINING ACTIVE';
      $('mining-btn').classList.add('active');
      state.isMining = true;
    } else {
      statusEl.textContent = 'INACTIVE';
      statusEl.style.color = 'var(--text-muted)';
      dotEl.className = 'status-dot';
      $('mining-btn').textContent = 'START MINING';
      $('mining-btn').classList.remove('active');
      state.isMining = false;
    }
  }
  if (data.earned !== undefined) {
    const weekly = Math.min(data.earned, 70) * 1;
    state.weeklyPending = weekly;
    $('weekly-pending').textContent = '₹' + weekly.toFixed(2);
  }
  if (state.user) {
    $('user-username').textContent = state.user.username;
    $('user-avatar').textContent = state.user.username.charAt(0).toUpperCase();
  }
}

function updateMiniDashboard(data) {
  if (data.hashrate !== undefined) {
    $('hashrate-mini').textContent = data.hashrate.toFixed(1) + ' H/s';
    $('hashrate-live').textContent = data.hashrate.toFixed(1) + ' H/s';
  }
  if (data.earned !== undefined) {
    const displayEarned = Math.min(data.earned, 70);
    $('today-earned-mini').textContent = '₹' + displayEarned.toFixed(2);
    $('today-earned-live').textContent = '₹' + displayEarned.toFixed(2);
    const pct = Math.min((data.earned / 70) * 100, 100);
    $('daily-progress-mini').style.width = pct + '%';
    $('daily-progress-label-mini').textContent = (data.earned >= 70) ? '100% ✅' : pct.toFixed(0) + '%';
    const badge = $('target-badge-mini');
    badge.style.display = (data.earned >= 70) ? 'inline-flex' : 'none';
  }
  if (data.status !== undefined) {
    const statusEl = $('mining-status-mini');
    const dotEl = $('mining-status-dot-mini');
    if (data.status === 'active') {
      statusEl.textContent = 'ACTIVE';
      statusEl.style.color = 'var(--success)';
      dotEl.className = 'status-dot active';
      $('mining-btn-mini').textContent = 'STOP MINING';
      $('mining-btn-mini').classList.add('active');
      state.isMining = true;
    } else {
      statusEl.textContent = 'INACTIVE';
      statusEl.style.color = 'var(--text-muted)';
      dotEl.className = 'status-dot';
      $('mining-btn-mini').textContent = 'START MINING';
      $('mining-btn-mini').classList.remove('active');
      state.isMining = false;
    }
  }
}

// ---------- GRAPH ----------
let graphPoints = [];
function updateGraph(value) {
  graphPoints.push(value);
  if (graphPoints.length > 50) graphPoints.shift();
  const line = document.getElementById('graph-line');
  if (!line) return;
  const width = 300, height = 60;
  const max = Math.max(...graphPoints, 1);
  const points = graphPoints.map((v, i) => {
    const x = (i / (graphPoints.length - 1 || 1)) * width;
    const y = height - (v / max) * height * 0.8 - 5;
    return `${x},${y}`;
  }).join(' ');
  line.setAttribute('points', points);
}

// ---------- MINING CONTROL ----------
function toggleMining() {
  if (!state.isLoggedIn) { 
    showMessage('MinePulse', 'Please login first.');
    return; 
  }
  if (state.isMining) {
    // Stop
    state.isMining = false;
    $('mining-btn').textContent = 'START MINING';
    $('mining-btn').classList.remove('active');
    $('mining-btn-mini').textContent = 'START MINING';
    $('mining-btn-mini').classList.remove('active');
    $('mining-status').textContent = 'INACTIVE';
    $('mining-status').style.color = 'var(--text-muted)';
    $('mining-status-dot').className = 'status-dot';
    $('mining-status-mini').textContent = 'INACTIVE';
    $('mining-status-mini').style.color = 'var(--text-muted)';
    $('mining-status-dot-mini').className = 'status-dot';
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        if (reg.active) {
          reg.active.postMessage({ type: 'STOP_MINING' });
        }
      });
    }
  } else {
    // Start
    state.isMining = true;
    $('mining-btn').textContent = 'MINING ACTIVE';
    $('mining-btn').classList.add('active');
    $('mining-btn-mini').textContent = 'STOP MINING';
    $('mining-btn-mini').classList.add('active');
    $('mining-status').textContent = 'ACTIVE';
    $('mining-status').style.color = 'var(--success)';
    $('mining-status-dot').className = 'status-dot active';
    $('mining-status-mini').textContent = 'ACTIVE';
    $('mining-status-mini').style.color = 'var(--success)';
    $('mining-status-dot-mini').className = 'status-dot active';
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        if (reg.active) {
          reg.active.postMessage({ type: 'START_MINING' });
        }
      });
    }
  }
}

// ---------- PUSH NOTIFICATIONS ----------
async function registerPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const token = 'dummy-fcm-token-' + Date.now();
    await supabaseRequest('/fcm_tokens', 'POST', { user_id: state.user.id, token });
    console.log('Push token saved.');
  } catch (e) { console.warn('Push reg error', e); }
}

// ---------- NOTIFICATIONS ----------
function addNotification(title, body, type = 'info') {
  const notif = {
    id: Date.now(),
    title,
    body,
    type,
    read: false,
    timestamp: new Date().toISOString(),
  };
  let stored = localStorage.getItem('minepulse_notifications');
  let list = stored ? JSON.parse(stored) : [];
  list.unshift(notif);
  if (list.length > 50) list.pop();
  localStorage.setItem('minepulse_notifications', JSON.stringify(list));
  updateNotifDot();
}

function updateNotifDot() {
  const stored = localStorage.getItem('minepulse_notifications');
  let unread = 0;
  if (stored) {
    try { const list = JSON.parse(stored); unread = list.filter(n => !n.read).length; } catch(e) {}
  }
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
}

// ---------- HISTORY ----------
function addHistoryItem(item) {
  state.history.unshift(item);
  renderHistory();
}
function renderHistory() {
  const tbody = $('payout-history-body');
  if (!tbody) return;
  if (state.history.length === 0) {
    tbody.innerHTML = '<div class="history-empty">No mining history yet.</div>';
    return;
  }
  let html = '';
  state.history.forEach(h => {
    html += `<div class="history-item">
      <span class="history-date">${formatDate(h.date)}</span>
      <span class="history-amount">₹${h.amount.toFixed(2)}</span>
      <span class="history-status ${h.status}">${h.status.toUpperCase()}</span>
    </div>`;
  });
  tbody.innerHTML = html;
  const miniBody = $('payout-history-body-mini');
  if (miniBody) miniBody.innerHTML = tbody.innerHTML;
}

// ---------- RESET TIMER ----------
function updateResetTimer() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  if (diff <= 0) { state.earned = 0; updateDashboard({ earned: 0 }); return; }
  const hours = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  const timer = $('reset-timer');
  if (timer) timer.textContent = `${hours}:${mins}:${secs}`;
  const timerMini = $('reset-timer-mini');
  if (timerMini) timerMini.textContent = `${hours}:${mins}:${secs}`;
}

// ---------- SETTINGS ----------
function setupSettings() {
  const select = $('payout-method-select-settings');
  const input = $('wallet-address-input-settings');
  const label = document.getElementById('wallet-label-settings');
  if (select && input) {
    select.addEventListener('change', () => {
      if (select.value === 'USDT') {
        label.textContent = 'USDT Wallet Address (TRC20)';
        input.placeholder = 'Enter TRC20 address';
      } else {
        label.textContent = 'UPI ID';
        input.placeholder = 'Enter your UPI ID';
      }
    });
    if (state.user) {
      select.value = state.user.payout_method || 'USDT';
      input.value = state.user.wallet_address || '';
      select.dispatchEvent(new Event('change'));
    }
    document.getElementById('save-payout-settings').addEventListener('click', async () => {
      const method = select.value;
      const wallet = input.value.trim();
      if (!wallet) { 
        showMessage('MinePulse', 'Please enter your wallet/UPI.');
        return; 
      }
      if (state.user) {
        try {
          await supabaseRequest(`/users?id=eq.${state.user.id}`, 'PATCH', {
            payout_method: method, wallet_address: wallet,
          });
          state.user.payout_method = method;
          state.user.wallet_address = wallet;
          showMessage('Settings Saved', 'Your payout settings have been updated.');
          $('payout-method-select').value = method;
          $('wallet-address-input').value = wallet;
          updateWalletLabel(method);
        } catch (err) { 
          showMessage('Save Failed', err.message);
        }
      }
    });
  }
}

function updateWalletLabel(method) {
  const label = document.getElementById('wallet-label');
  const input = $('wallet-address-input');
  if (!label || !input) return;
  if (method === 'USDT') {
    label.textContent = 'USDT Wallet Address (TRC20)';
    input.placeholder = 'Enter your TRC20 address';
  } else {
    label.textContent = 'UPI ID';
    input.placeholder = 'Enter your UPI ID';
  }
}

// ---------- RESOURCES ----------
async function fetchResources() {
  const grid = document.getElementById('resources-grid');
  if (!grid) return;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/resources`);
    if (!res.ok) throw new Error('Failed to fetch resources');
    const data = await res.json();
    localStorage.setItem('minepulse_resources', JSON.stringify(data));
    renderResources(data);
  } catch (e) {
    const cached = localStorage.getItem('minepulse_resources');
    if (cached) {
      renderResources(JSON.parse(cached));
    } else {
      grid.innerHTML = `<div class="resources-loading">Unable to load resources. Please try again later.</div>`;
    }
  }
}

function renderResources(items) {
  const grid = document.getElementById('resources-grid');
  if (!grid) return;
  if (!items || items.length === 0) {
    grid.innerHTML = '<div class="resources-loading">No resources available.</div>';
    return;
  }
  let html = '';
  items.forEach(item => {
    html += `
      <div class="resource-card">
        ${item.icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${item.icon}"/></svg>` : ''}
        <div class="name">${item.name}</div>
        <div class="desc">${item.description || ''}</div>
        <a href="${item.url}" target="_blank" class="btn-visit">Visit</a>
      </div>
    `;
  });
  grid.innerHTML = html;
}

// ---------- SUPPORT MODAL ----------
function setupSupportModal() {
  const modal = document.getElementById('support-modal');
  const openBtn = document.getElementById('change-password-btn');
  const closeBtns = document.querySelectorAll('.modal-close, .modal-close-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
  }
  closeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  });
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

// ---------- FAQ TOGGLE ----------
function setupFaq() {
  document.querySelectorAll('.faq-item').forEach(item => {
    const q = item.querySelector('.faq-q');
    const a = item.querySelector('.faq-a');
    const toggle = q.querySelector('.faq-toggle');
    q.addEventListener('click', () => {
      const isOpen = a.style.display === 'block';
      a.style.display = isOpen ? 'none' : 'block';
      item.classList.toggle('open');
      toggle.textContent = isOpen ? '+' : '−';
    });
  });
}

// ---------- OFFLINE ----------
function updateOfflineBanner(online) {
  const banner = document.getElementById('offline-banner');
  if (banner) banner.style.display = online ? 'none' : 'block';
}
window.addEventListener('online', () => updateOfflineBanner(true));
window.addEventListener('offline', () => updateOfflineBanner(false));

// ---------- INIT ----------
async function init() {
  updateNotifDot();

  const session = localStorage.getItem('minepulse_session');
  if (session) {
    try {
      const { userId } = JSON.parse(session);
      const users = await supabaseRequest(`/users?id=eq.${userId}`, 'GET');
      if (users && users.length > 0) {
        const user = users[0];
        state.user = { id: user.id, username: user.username, payout_method: user.payout_method, wallet_address: user.wallet_address };
        state.isLoggedIn = true;
        showPage('page-dashboard');
        showSubpage('dashboard');
        state.history = [
          { date: new Date(2026, 7, 12), amount: 70, status: 'completed' },
          { date: new Date(2026, 7, 11), amount: 70, status: 'completed' },
          { date: new Date(2026, 7, 10), amount: 54.20, status: 'pending' },
        ];
        renderHistory();
        state.weeklyPending = 490;
        $('weekly-pending').textContent = '₹490.00';
        $('user-avatar').textContent = state.user.username.charAt(0).toUpperCase();
        $('user-username').textContent = state.user.username;
        $('settings-username').textContent = state.user.username;
        updateDashboard({ hashrate: 12.5, earned: 45.20, status: 'inactive' });
        setupSettings();
        initChimera();
        registerPush();
        fetchResources();
      } else {
        localStorage.removeItem('minepulse_session');
        showPage('page-landing');
      }
    } catch (err) {
      console.warn('Session restore failed', err);
      localStorage.removeItem('minepulse_session');
      showPage('page-landing');
    }
  } else {
    showPage('page-landing');
  }

  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('goto-login').addEventListener('click', (e) => { e.preventDefault(); showPage('page-login'); });
  document.getElementById('goto-register').addEventListener('click', (e) => { e.preventDefault(); showPage('page-landing'); });
  document.getElementById('landing-start-btn').addEventListener('click', () => {
    if (state.isLoggedIn) { showPage('page-dashboard'); showSubpage('dashboard'); } else showPage('page-landing');
  });
  document.getElementById('landing-how-btn').addEventListener('click', () => { showPage('page-dashboard'); showSubpage('help'); });

  document.getElementById('mining-btn').addEventListener('click', toggleMining);
  document.getElementById('mining-btn-mini').addEventListener('click', toggleMining);
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      if (page) {
        showSubpage(page);
        document.querySelector('.sidebar')?.classList.remove('open');
      }
    });
  });

  document.getElementById('payout-method-select').addEventListener('change', (e) => {
    updateWalletLabel(e.target.value);
  });

  setupFaq();
  setupSupportModal();
  setInterval(updateResetTimer, 1000);
  updateResetTimer();

  for (let i = 0; i < 20; i++) graphPoints.push(Math.random() * 30 + 10);
  updateGraph(state.hashrate || 0);
  updateOfflineBanner(navigator.onLine);
  console.log('MinePulse v3 initialized (fully branded popups, fixed registration).');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}