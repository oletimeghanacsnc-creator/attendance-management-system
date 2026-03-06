const form = document.getElementById('registerForm');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = 'Creating account...';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.message || 'Failed to register'; return; }
    msg.style.color = 'limegreen';
    msg.textContent = 'Account created. Redirecting to login...';
    setTimeout(() => location.href = '/login.html', 700);
  } catch {
    msg.textContent = 'Network error';
  }
});
