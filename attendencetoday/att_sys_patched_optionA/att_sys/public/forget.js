const form = document.getElementById('forgotForm');
const msg = document.getElementById('msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = 'Processing...';

  const payload = Object.fromEntries(new FormData(form).entries());
  if (payload.newPassword !== payload.confirmPassword) {
    msg.textContent = 'Passwords do not match';
    return;
  }

  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: payload.username,
        newPassword: payload.newPassword
      })
    });

    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.message || 'Error resetting password';
      return;
    }

    msg.style.color = 'limegreen';
    msg.textContent = 'Password updated! Redirecting to login...';
    setTimeout(() => location.href = '/login.html', 1200);

  } catch {
    msg.textContent = 'Network error';
  }
});
