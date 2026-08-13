// ============================================================
// MINEPULSE – APP.JS
// Full frontend logic: routing, WebSocket, mining control,
// dashboard updates, push notifications, and more.
// ============================================================

// ---------- CONFIG ----------
const CONFIG = {
  API_BASE: 'https://your-backend-url.pythonanywhere.com', // replace with your actual backend
  WS_URL: 'wss://your-backend-url.pythonanywhere.com/ws',
  FCM_VAPID_KEY: 'YOUR_VAPID_PUBLIC_KEY', // replace with your Firebase VAPID key
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
  reconnectAttempts: 0,
  maxReconnect: 10,
  user: null,
  isLoggedIn: false,
};

// ---------- DOM REFS ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- UTILITY ----------
function formatINR(amount) {
  return '₹' + amount.toFixed(2);
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- PAGE ROUTING ----------
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  // Update sidebar/bottom nav active states
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`.nav-item[data-page="${pageId.replace('page-', '')}"]`).forEach(el => el.classList.add('active'));
  // Update page title
  const titleMap = {
    'page-landing': 'MinePulse',
    'page-login': 'Login',
    'page-dashboard': 'Dashboard',
    'page-payout-settings': 'Payout Settings',
    'page-help': 'Help',
  };
  const titleEl = document.querySelector('.page-title');
  if (titleEl) {
    const key = pageId;
    titleEl.textContent = titleMap[key] || 'Dashboard';
  }
}

// ---------- AUTH ----------
function handleRegister(e) {
  e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  const method = $('payout-method-select').value;
  const wallet = $('wallet-address-input').value.trim();
  const referral = $('referral').value.trim();

  if (!username || password.length < 6) {
    alert('Username required, password min 6 chars.');
    return;
  }
  if (!wallet) {
    alert('Please enter your wallet/UPI address.');
    return;
  }

  // Simulate registration – store in localStorage
  const user = { username, password, method, wallet, referral, balance: 0, totalMined: 0 };
  localStorage.setItem('minepulse_user', JSON.stringify(user));
  state.user = user;
  state.isLoggedIn = true;
  showPage('page-dashboard');
  updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
  startWebSocket();
  registerPush();
}

function handleLogin(e) {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  const stored = localStorage.getItem('minepulse_user');
  if (!stored) {
    alert('No account found. Please register.');
    return;
  }
  const user = JSON.parse(stored);
  if (user.username === username && user.password === password) {
    state.user = user;
    state.isLoggedIn = true;
    showPage('page-dashboard');
    updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
    startWebSocket();
    registerPush();
  } else {
    alert('Invalid credentials.');
  }
}

function logout() {
  state.isLoggedIn = false;
  state.user = null;
  if (state.ws) { state.ws.close(); state.ws = null; }
  showPage('page-landing');
}

// ---------- WEB SOCKET ----------
function startWebSocket() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
  state.ws = new WebSocket(CONFIG.WS_URL);
  state.ws.onopen = () => {
    console.log('WebSocket connected');
    state.reconnectAttempts = 0;
    // Send initial handshake with user info
    if (state.user) {
      state.ws.send(JSON.stringify({ type: 'auth', username: state.user.username }));
    }
  };
  state.ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'stats') {
        updateDashboard(data);
      } else if (data.type === 'payout') {
        // Handle payout notification
        console.log('Payout received:', data);
        addHistoryItem({ date: new Date(), amount: data.amount, status: 'completed', tx: data.tx });
        alert('Weekly payout of ₹' + data.amount + ' sent!');
      }
    } catch (e) { console.warn('WS parse error', e); }
  };
  state.ws.onclose = () => {
    console.warn('WebSocket closed, reconnecting...');
    if (state.isLoggedIn) {
      setTimeout(() => {
        if (state.reconnectAttempts < state.maxReconnect) {
          state.reconnectAttempts++;
          startWebSocket();
        }
      }, 3000);
    }
  };
  state.ws.onerror = (err) => { console.error('WS error', err); };
}

function sendWS(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  } else {
    console.warn('WebSocket not ready');
  }
}

// ---------- DASHBOARD UPDATE ----------
function updateDashboard(data) {
  // Update hashrate
  if (data.hashrate !== undefined) {
    state.hashrate = data.hashrate;
    $('hashrate').textContent = data.hashrate.toFixed(1) + ' H/s';
    // Update graph
    updateGraph(data.hashrate);
    // Update graph stats
    $('graph-hash').textContent = data.hashrate.toFixed(1) + ' H/s';
    // Track peak and average (simple rolling)
    if (!state.peak || data.hashrate > state.peak) state.peak = data.hashrate;
    if (!state.avg) state.avg = data.hashrate;
    else state.avg = (state.avg + data.hashrate) / 2;
    $('graph-peak').textContent = (state.peak || 0).toFixed(1) + ' H/s';
    $('graph-avg').textContent = (state.avg || 0).toFixed(1) + ' H/s';
  }

  // Update earnings (cap at 70)
  if (data.earned !== undefined) {
    state.earned = data.earned;
    const displayEarned = Math.min(data.earned, 70);
    $('today-earned').textContent = '₹' + displayEarned.toFixed(2);
    const pct = Math.min((data.earned / 70) * 100, 100);
    $('daily-progress').style.width = pct + '%';
    $('daily-progress-label').textContent = (data.earned >= 70) ? '100% ✅' : pct.toFixed(0) + '%';
    // Show target badge if earned >= 70
    const badge = $('target-badge');
    if (data.earned >= 70) {
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Update mining status
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

  // Update weekly pending (we compute from daily cap)
  if (data.earned !== undefined) {
    const daysActive = 1; // placeholder – should track from backend
    const weekly = Math.min(data.earned, 70) * daysActive;
    state.weeklyPending = weekly;
    $('weekly-pending').textContent = '₹' + weekly.toFixed(2);
  }

  // Update user info
  if (state.user) {
    $('user-username').textContent = state.user.username;
    $('user-avatar').textContent = state.user.username.charAt(0).toUpperCase();
  }
}

// ---------- GRAPH ----------
let graphPoints = [];
function updateGraph(value) {
  graphPoints.push(value);
  if (graphPoints.length > 50) graphPoints.shift();
  const line = document.getElementById('graph-line');
  if (!line) return;
  const width = 300;
  const height = 60;
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
    alert('Please login first.');
    return;
  }
  if (state.isMining) {
    // Stop mining
    sendWS({ type: 'control', action: 'stop' });
    // Optimistically update UI – backend will confirm
    state.isMining = false;
    $('mining-btn').textContent = 'START MINING';
    $('mining-btn').classList.remove('active');
    $('mining-status').textContent = 'INACTIVE';
    $('mining-status').style.color = 'var(--text-muted)';
    $('mining-status-dot').className = 'status-dot';
  } else {
    // Start mining
    sendWS({ type: 'control', action: 'start' });
    // Optimistic update
    state.isMining = true;
    $('mining-btn').textContent = 'MINING ACTIVE';
    $('mining-btn').classList.add('active');
    $('mining-status').textContent = 'ACTIVE';
    $('mining-status').style.color = 'var(--success)';
    $('mining-status-dot').className = 'status-dot active';
  }
}

// ---------- PUSH NOTIFICATIONS ----------
async function registerPush() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.warn('Push not supported');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      console.warn('Notification permission denied');
      return;
    }
    const reg = await navigator.serviceWorker.register('/service-worker.js');
    console.log('SW registered', reg);
    // Get push subscription
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: CONFIG.FCM_VAPID_KEY,
    });
    // Send subscription to backend (simulate)
    console.log('Push subscription:', sub);
    // In production, send to backend: POST /api/push/register
    // We'll just store in localStorage for demo
    localStorage.setItem('push_subscription', JSON.stringify(sub));
  } catch (e) {
    console.warn('Push registration error', e);
  }
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
    html += `
      <div class="history-item">
        <span class="history-date">${formatDate(h.date)}</span>
        <span class="history-amount">₹${h.amount.toFixed(2)}</span>
        <span class="history-status ${h.status}">${h.status.toUpperCase()}</span>
      </div>
    `;
  });
  tbody.innerHTML = html;
}

// ---------- RESET TIMER ----------
function updateResetTimer() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  if (diff <= 0) {
    // Reset daily
    state.earned = 0;
    updateDashboard({ earned: 0 });
    return;
  }
  const hours = String(Math.floor(diff / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
  const timer = document.getElementById('reset-timer');
  if (timer) timer.textContent = `${hours}:${mins}:${secs}`;
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
    // Load saved settings
    if (state.user) {
      select.value = state.user.method || 'USDT';
      input.value = state.user.wallet || '';
      // Trigger change
      select.dispatchEvent(new Event('change'));
    }
    // Save settings
    document.getElementById('save-payout-settings').addEventListener('click', () => {
      const method = select.value;
      const wallet = input.value.trim();
      if (!wallet) {
        alert('Please enter your wallet/UPI.');
        return;
      }
      if (state.user) {
        state.user.method = method;
        state.user.wallet = wallet;
        localStorage.setItem('minepulse_user', JSON.stringify(state.user));
        alert('Settings saved!');
        // Also update the registration form fields for consistency
        $('payout-method-select').value = method;
        $('wallet-address-input').value = wallet;
        // Update label on register form as well
        updateWalletLabel(method);
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

// ---------- OFFLINE HANDLING ----------
function updateOfflineBanner(online) {
  const banner = document.getElementById('offline-banner');
  if (banner) {
    banner.style.display = online ? 'none' : 'block';
  }
}
window.addEventListener('online', () => updateOfflineBanner(true));
window.addEventListener('offline', () => updateOfflineBanner(false));

// ---------- INIT ----------
function init() {
  // Check if user is already logged in
  const stored = localStorage.getItem('minepulse_user');
  if (stored) {
    state.user = JSON.parse(stored);
    state.isLoggedIn = true;
    showPage('page-dashboard');
    // Start WebSocket and push
    startWebSocket();
    registerPush();
    // Load some dummy history for demo
    state.history = [
      { date: new Date(2026, 7, 12), amount: 70, status: 'completed' },
      { date: new Date(2026, 7, 11), amount: 70, status: 'completed' },
      { date: new Date(2026, 7, 10), amount: 54.20, status: 'pending' },
    ];
    renderHistory();
    // Set weekly pending from dummy data
    state.weeklyPending = 490;
    $('weekly-pending').textContent = '₹490.00';
    // Update user avatar
    $('user-avatar').textContent = state.user.username.charAt(0).toUpperCase();
    $('user-username').textContent = state.user.username;
    // Set initial dashboard data (simulate)
    updateDashboard({ hashrate: 12.5, earned: 45.20, status: 'inactive' });
    // Prefill settings
    setupSettings();
  } else {
    showPage('page-landing');
  }

  // Bind events
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('goto-login').addEventListener('click', (e) => { e.preventDefault(); showPage('page-login'); });
  document.getElementById('goto-register').addEventListener('click', (e) => { e.preventDefault(); showPage('page-landing'); });
  document.getElementById('landing-start-btn').addEventListener('click', () => {
    if (state.isLoggedIn) showPage('page-dashboard');
    else showPage('page-landing'); // already there
  });
  document.getElementById('landing-how-btn').addEventListener('click', () => {
    showPage('page-help');
  });
  document.getElementById('mining-btn').addEventListener('click', toggleMining);
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Sidebar toggle for mobile
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  // Navigation clicks (both sidebar and bottom nav)
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      if (page === 'dashboard') showPage('page-dashboard');
      else if (page === 'mining') showPage('page-dashboard'); // same for now
      else if (page === 'payouts') showPage('page-payout-settings');
      else if (page === 'history') showPage('page-dashboard');
      else if (page === 'settings') showPage('page-payout-settings');
      else if (page === 'help') showPage('page-help');
      // Close sidebar on mobile
      document.querySelector('.sidebar')?.classList.remove('open');
    });
  });

  // Payout method change on registration form
  document.getElementById('payout-method-select').addEventListener('change', (e) => {
    updateWalletLabel(e.target.value);
  });

  // FAQ setup
  setupFaq();

  // Reset timer
  setInterval(updateResetTimer, 1000);
  updateResetTimer();

  // Graph initial
  for (let i = 0; i < 20; i++) {
    graphPoints.push(Math.random() * 30 + 10);
  }
  updateGraph(state.hashrate || 0);

  // Check online status
  updateOfflineBanner(navigator.onLine);

  console.log('MinePulse initialized');
}

// Run when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}