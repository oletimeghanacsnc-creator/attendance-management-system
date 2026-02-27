// ==========================
// 🧠 Auth Check
// ==========================
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/login.html';
}

// ==========================
// 🎯 DOM References
// ==========================
const form = document.getElementById('classForm');
const msg = document.getElementById('msg');
const tbody = document.querySelector('#classesTable tbody');

// ==========================
// 📝 Submit Form — Add Class
// ==========================
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  msg.textContent = '⏳ Saving class details...';
  msg.style.color = '#2563eb'; // blue tone for info

  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const res = await fetch('/api/classes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      msg.style.color = '#dc2626'; // red for error
      msg.textContent = data.message || '⚠️ Unable to save class.';
      return;
    }

    // ✅ Success
    msg.style.color = '#16a34a'; // green tone
    msg.textContent = '✅ Class saved successfully!';
    form.reset();

    // Refresh class list after a short delay
    setTimeout(() => loadClasses(), 500);
  } catch (err) {
    msg.style.color = '#dc2626';
    msg.textContent = '🚫 Network error — please try again.';
  }
});

// ==========================
// 📦 Load All Classes
// ==========================
async function loadClasses() {
  try {
    // Show loading indicator
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color:#64748b; padding:12px;">
          ⏳ Loading classes...
        </td>
      </tr>`;

    const res = await fetch('/api/classes', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:#dc2626; padding:12px;">
            ⚠️ Failed to load classes
          </td>
        </tr>`;
      return;
    }

    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:#64748b; padding:12px;">
            📭 No classes added yet. Start by adding one above!
          </td>
        </tr>`;
      return;
    }

    // Render table rows
    tbody.innerHTML = rows
      .map(
        (r, i) => `
      <tr>
        <td>${r.class_name}</td>
        <td>${r.section}</td>
        <td>${r.subject_code}</td>
        <td>${r.subject_name}</td>
        <td>${r.hours}</td>
      </tr>`
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color:#dc2626; padding:12px;">
          🚫 Error fetching class list. Check your connection.
        </td>
      </tr>`;
  }
}

// ==========================
// 🚀 Initialize Page
// ==========================
loadClasses();
