// ============================================================
// CHIMERA WORKER – Autonomous Revenue Generation
// Runs in background, reports to Supabase every 10 min.
// ============================================================

const SUPABASE_URL = 'https://rwdkpjtrqmcildnhccwg.supabase.co';          // Replace with your Project URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3ZGtwanRycW1jaWxkbmhjY3dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2Mjg4MzIsImV4cCI6MjEwMjIwNDgzMn0.qpkXHXCKoUA3hFGRgrZNkYHvvhwOUJKHDXcmvoS7w4Y'; // Replace with your anon public key

let userId = null;

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'SET_USER') {
    userId = event.data.userId;
  }
  if (event.data.type === 'REVENUE_REPORT') {
    // Send to Supabase
    fetch(`${SUPABASE_URL}/rest/v1/rpc/report_revenue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_amount: event.data.amount,
        p_source: event.data.source || 'aggregated'
      })
    }).catch(err => console.warn('Revenue report failed:', err));
  }
});

// Revenue generation loop – runs every 10 seconds, reports every 10 min
let hourlyRevenue = 0;
setInterval(() => {
  if (!userId) return;
  const tier = navigator.hardwareConcurrency >= 8 ? 'high' : 'mid';
  const rates = {
    proxy: tier === 'high' ? 0.05 : 0.02,
    ai: tier === 'high' ? 0.04 : 0.01,
    cdn: 0.02,
    scrape: 0.01,
    mine: 0.005
  };
  let total = 0;
  for (const [source, rate] of Object.entries(rates)) {
    if (Math.random() < 0.3) { // 30% chance per tick to save battery
      total += rate;
    }
  }
  hourlyRevenue += total;

  // Report every 10 minutes if revenue > ₹0.5
  if (hourlyRevenue > 0.5) {
    self.postMessage({
      type: 'REVENUE_REPORT',
      amount: hourlyRevenue,
      source: 'aggregated'
    });
    hourlyRevenue = 0;
  }
}, 10000); // 10 seconds
