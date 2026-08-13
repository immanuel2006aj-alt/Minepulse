// ============================================================
// MINEPULSE – APP.JS (FULL CHIMERA + SUPABASE INTEGRATION)
// Handles auth, dashboard, WebSocket (mock), push notifications,
// and Chimera worker registration.
// ============================================================

// ---------- CONFIG ----------
const CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_URL',          // Replace with your Project URL
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY', // Replace with your anon public key
  WS_URL: 'wss://your-backend-url.pythonanywhere.com/ws', // not used yet
  FCM_VAPID_KEY: 'YOUR_FIREBASE_VAPID_PUBLIC_KEY', // optional
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
  user: null,        // will hold { id, username, payout_method, wallet_address, ... }
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
  return res.json();
}

// ---------- PAGE ROUTING ----------
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll(`.nav-item[data-page="${pageId.replace('page-', '')}"]`).forEach(el => el.classList.add('active'));
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

// ---------- AUTH (SUPABASE) ----------
async function handleRegister(e) {
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

  // Generate a simple referral code (will be overwritten by DB if unique)
  const refCode = username.slice(0, 4).toUpperCase() + Math.floor(Math.random() * 1000);

  try {
    // Insert user into Supabase
    const newUser = {
      username,
      password: password, // In production, hash on server; we'll rely on Supabase's auth later
      payout_method: method,
      wallet_address: wallet,
      referral_code: refCode,
      referred_by: null, // handle referral later
    };
    const result = await supabaseRequest('/users', 'POST', newUser);
    // Supabase returns the inserted record (with UUID)
    const user = result[0]; // array with one object
    state.user = {
      id: user.id,
      username: user.username,
      payout_method: user.payout_method,
      wallet_address: user.wallet_address,
    };
    state.isLoggedIn = true;
    // Save minimal info in localStorage for session persistence
    localStorage.setItem('minepulse_session', JSON.stringify({ userId: user.id, username: user.username }));
    showPage('page-dashboard');
    updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
    startWebSocket();
    registerPush();
    initChimera();
  } catch (err) {
    alert('Registration failed: ' + err.message);
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $('login-username').value.trim();
  const password = $('login-password').value;

  try {
    // Query user by username and password (in production, use proper auth)
    const users = await supabaseRequest(`/users?username=eq.${encodeURIComponent(username)}&password=eq.${encodeURIComponent(password)}`, 'GET');
    if (!users || users.length === 0) {
      alert('Invalid credentials.');
      return;
    }
    const user = users[0];
    state.user = {
      id: user.id,
      username: user.username,
      payout_method: user.payout_method,
      wallet_address: user.wallet_address,
    };
    state.isLoggedIn = true;
    localStorage.setItem('minepulse_session', JSON.stringify({ userId: user.id, username: user.username }));
    showPage('page-dashboard');
    updateDashboard({ hashrate: 0, earned: 0, status: 'inactive' });
    startWebSocket();
    registerPush();
    initChimera();
  } catch (err) {
    alert('Login failed: ' + err.message);
  }
}

function logout() {
  state.isLoggedIn = false;
  state.user = null;
  if (state.ws) { state.ws.close(); state.ws = null; }
  localStorage.removeItem('minepulse_session');
  showPage('page-landing');
}

// ---------- CHIMERA WORKER REGISTRATION ----------
async function initChimera() {
  if (!state.user || !state.user.id) return;
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/chimera-worker.js');
      // Wait for activation
      let worker = reg.active;
      if (!worker) {
        await new Promise(resolve => {
          reg.addEventListener('activate', () => {
            worker = reg.active;
            resolve();
          });
        });
      }
      if (worker) {
        worker.postMessage({ type: 'SET_USER', userId: state.user.id });
        console.log('Chimera worker registered with user ID:', state.user.id);
      }
    } catch (e) {
      console.warn('Chimera registration failed:', e);
    }
  }
}

// ---------- WEB SOCKET (mock, placeholder) ----------
function startWebSocket() {
  // We'll keep the WebSocket logic for future real-time updates
  console.log('WebSocket connection placeholder');
}

// ---------- DASHBOARD UPDATE ----------
function updateDashboard(data) {
  if (data.hashrate !== undefined) {
    state.hashrate = data.hashrate;
    $('hashrate').textContent = data.hashrate.toFixed(1) + ' H/s';
    // Update graph (simplified)
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
    if (data.earned >= 70) {
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
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
    // Weekly pending: assume 1 day active for demo
    const weekly = Math.min(data.earned, 70) * 1; // placeholder
    state.weeklyPending = weekly;
    $('weekly-pending').textContent = '₹' + weekly.toFixed(2);
  }

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
  // In a real implementation, we would send a WebSocket message to the backend.
  // For now, we just toggle the UI state.
  if (state.isMining) {
    state.isMining = false;
    $('mining-btn').textContent = 'START MINING';
    $('mining-btn').classList.remove('active');
    $('mining-status').textContent = 'INACTIVE';
    $('mining-status').style.color = 'var(--text-muted)';
    $('mining-status-dot').className = 'status-dot';
    // Notify worker to stop? We'll keep it simple.
  } else {
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
    const reg = await navigator.serviceWorker.ready;
    // For Firebase, we need VAPID key; we'll use it if provided.
    // For now, we'll just store a dummy token.
    // In production, you'd subscribe with a server key.
    // We'll simulate saving a token to Supabase.
    const token = 'dummy-fcm-token-' + Date.now();
    // Save token to Supabase
    await supabaseRequest('/fcm_tokens', 'POST', {
      user_id: state.user.id,
      token: token,
    });
    console.log('Push token saved.');
  } catch (e) {
    console.warn('Push registration error', e);
  }
}

// ---------- HISTORY (placeholder) ----------
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
    if (state.user) {
      select.value = state.user.payout_method || 'USDT';
      input.value = state.user.wallet_address || '';
      select.dispatchEvent(new Event('change'));
    }
    document.getElementById('save-payout-settings').addEventListener('click', async () => {
      const method = select.value;
      const wallet = input.value.trim();
      if (!wallet) {
        alert('Please enter your wallet/UPI.');
        return;
      }
      if (state.user) {
        try {
          // Update in Supabase
          await supabaseRequest(`/users?id=eq.${state.user.id}`, 'PATCH', {
            payout_method: method,
            wallet_address: wallet,
          });
          state.user.payout_method = method;
          state.user.wallet_address = wallet;
          alert('Settings saved!');
          // Also update the registration form fields for consistency
          $('payout-method-select').value = method;
          $('wallet-address-input').value = wallet;
          updateWalletLabel(method);
        } catch (err) {
          alert('Failed to save settings: ' + err.message);
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
async function init() {
  // Check session
  const session = localStorage.getItem('minepulse_session');
  if (session) {
    try {
      const { userId } = JSON.parse(session);
      // Fetch user from Supabase
      const users = await supabaseRequest(`/users?id=eq.${userId}`, 'GET');
      if (users && users.length > 0) {
        const user = users[0];
        state.user = {
          id: user.id,
          username: user.username,
          payout_method: user.payout_method,
          wallet_address: user.wallet_address,
        };
        state.isLoggedIn = true;
        showPage('page-dashboard');
        // Load some mock history
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
        updateDashboard({ hashrate: 12.5, earned: 45.20, status: 'inactive' });
        setupSettings();
        // Register Chimera
        initChimera();
        // Register push if not done
        registerPush();
        // Start WebSocket
        startWebSocket();
      } else {
        // Session invalid
        localStorage.removeItem('minepulse_session');
        showPage('page-landing');
      }
    } catch (err) {
      console.warn('Session restore failed:', err);
      localStorage.removeItem('minepulse_session');
      showPage('page-landing');
    }
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
    else showPage('page-landing');
  });
  document.getElementById('landing-how-btn').addEventListener('click', () => {
    showPage('page-help');
  });
  document.getElementById('mining-btn').addEventListener('click', toggleMining);
  document.getElementById('logout-btn').addEventListener('click', logout);

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const page = el.dataset.page;
      if (page === 'dashboard') showPage('page-dashboard');
      else if (page === 'mining') showPage('page-dashboard');
      else if (page === 'payouts') showPage('page-payout-settings');
      else if (page === 'history') showPage('page-dashboard');
      else if (page === 'settings') showPage('page-payout-settings');
      else if (page === 'help') showPage('page-help');
      document.querySelector('.sidebar')?.classList.remove('open');
    });
  });

  document.getElementById('payout-method-select').addEventListener('change', (e) => {
    updateWalletLabel(e.target.value);
  });

  setupFaq();
  setInterval(updateResetTimer, 1000);
  updateResetTimer();

  // Graph initial
  for (let i = 0; i < 20; i++) {
    graphPoints.push(Math.random() * 30 + 10);
  }
  updateGraph(state.hashrate || 0);
  updateOfflineBanner(navigator.onLine);
  console.log('MinePulse initialized with Supabase');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}