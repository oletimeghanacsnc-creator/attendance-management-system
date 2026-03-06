// ✅ Immediately invoked function for secure initialization
(async function initDashboard() {
  const greet = document.getElementById('greet');
  greet.textContent = 'Loading your profile...';

  try {
    const token = localStorage.getItem('token');

    // 🔒 Redirect if not logged in
    if (!token) {
      showGreeting('Session expired. Redirecting to login...', 'error');
      setTimeout(() => (location.href = '/login.html'), 1000);
      return;
    }

    // 🧠 Fetch user details
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      showGreeting('Authentication failed. Redirecting...', 'error');
      setTimeout(() => (location.href = '/login.html'), 1200);
      return;
    }

    const me = await res.json();

    // ✅ Animate welcome message
    showGreeting(`👋 Welcome back, ${me.name}!`, 'success');
  } catch (err) {
    console.error('Dashboard init error:', err);
    showGreeting('⚠️ Unable to load dashboard. Please refresh.', 'error');
  }
})();

/**
 * 🎨 Utility: Show styled greeting message
 * @param {string} text - The message to display
 * @param {'success'|'error'} type - Message type
 */
function showGreeting(text, type = 'success') {
  const greet = document.getElementById('greet');
  greet.textContent = text;
  greet.style.transition = 'all 0.4s ease';
  greet.style.fontWeight = '600';

  if (type === 'success') {
    greet.style.color = '#22c55e'; // soft green
  } else if (type === 'error') {
    greet.style.color = '#ef4444'; // red
  }
}

/**
 * 🚪 Secure logout handler
 */
function logout() {
  if (confirm('Are you sure you want to log out?')) {
    localStorage.removeItem('token');
    showGreeting('Logging out...', 'error');
    setTimeout(() => (location.href = '/index.html'), 600);
  }
}
