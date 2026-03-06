const form = document.getElementById('loginForm');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Get and trim input values
  const formData = new FormData(form);
  const username = formData.get('username')?.trim();
  const password = formData.get('password')?.trim();

  // Quick validation
  if (!username || !password) {
    showMessage('Please enter both username and password.', 'error');
    return;
  }

  showMessage('Authenticating...', 'loading');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || 'Invalid credentials. Try again.', 'error');
      return;
    }

    // ✅ Success
    localStorage.setItem('token', data.token);
    showMessage('✅ Login successful! Redirecting...', 'success');

    setTimeout(() => {
      window.location.href = '/dashboard.html';
    }, 800);
    
  } catch (error) {
    console.error('Login error:', error);
    showMessage('⚠️ Network error. Please try again later.', 'error');
  }
});

/**
 * Display styled feedback messages
 * @param {string} text - The message to display
 * @param {'success'|'error'|'loading'} type - Message type
 */
function showMessage(text, type = 'loading') {
  msg.textContent = text;

  // Reset style first
  msg.style.color = '';
  msg.style.fontWeight = '500';
  msg.style.transition = 'all 0.3s ease';
  
  switch (type) {
    case 'success':
      msg.style.color = 'limegreen';
      break;
    case 'error':
      msg.style.color = '#f87171'; // soft red
      break;
    case 'loading':
      msg.style.color = '#93c5fd'; // light blue
      break;
  }
}
