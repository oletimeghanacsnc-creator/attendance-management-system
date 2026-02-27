// ---------------------------
// 🎓 Smart Attendance System
// Record Attendance Script
// ---------------------------

const token = localStorage.getItem('token');
if (!token) location.href = '/login.html';

const classSelect = document.getElementById('classSelect');
const dateInput = document.getElementById('date');
const rowsContainer = document.getElementById('rows');
const msg = document.getElementById('msg');

dateInput.valueAsNumber = Date.now();

// Utility: Display message
function showMessage(text, color = '#334155') {
  msg.style.color = color;
  msg.textContent = text;
}

// ✅ Load Class List
async function loadClasses() {
  try {
    const res = await fetch('/api/classes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch classes');

    const list = await res.json();
    if (!list.length) {
      classSelect.innerHTML = `<option value="">No classes available</option>`;
      return;
    }

    classSelect.innerHTML =
      `<option value="">-- Select a Class --</option>` +
      list
        .map(
          (c) =>
            `<option value="${c.id}">${c.class_name} - ${c.section} (${c.subject_code})</option>`
        )
        .join('');
  } catch (err) {
    showMessage('⚠️ Unable to load classes. Please try again.', '#dc2626');
  }
}
loadClasses();

// ➕ Add Student Row
document.getElementById('addRow').addEventListener('click', () => {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input class="input" placeholder="Student Name" required></td>
    <td><input class="input" placeholder="USN" required></td>
    <td>
      <select class="input">
        <option value="Male">Male</option>
        <option value="Female">Female</option>
        <option value="Other">Other</option>
      </select>
    </td>
    <td>
      <button type="button" class="status-btn" onclick="toggleStatus(this)">Present</button>
    </td>
  `;
  rowsContainer.appendChild(tr);
});

// 🟩 / 🟥 Toggle Present ↔ Absent
function toggleStatus(btn) {
  if (btn.classList.contains('absent')) {
    btn.classList.remove('absent');
    btn.textContent = 'Present';
    btn.style.backgroundColor = '#16a34a';
  } else {
    btn.classList.add('absent');
    btn.textContent = 'Absent';
    btn.style.backgroundColor = '#dc2626';
  }
}

// 💾 Save Attendance
document.getElementById('save').addEventListener('click', async () => {
  const class_id = classSelect.value;
  const date = dateInput.value;

  if (!class_id || !date) {
    showMessage('⚠️ Please select a class and date.', '#dc2626');
    return;
  }

  // Collect all rows
  const records = [...rowsContainer.querySelectorAll('tr')]
    .map((tr) => {
      const [nameInput, usnInput] = tr.querySelectorAll('input.input');
      const gender = tr.querySelector('select').value;
      const statusBtn = tr.querySelector('.status-btn');
      const status = statusBtn.classList.contains('absent') ? 'absent' : 'present';

      return {
        name: nameInput.value.trim(),
        usn: usnInput.value.trim(),
        gender,
        status,
      };
    })
    .filter((r) => r.name && r.usn);

  if (!records.length) {
    showMessage('⚠️ Add at least one student record before saving.', '#dc2626');
    return;
  }

  showMessage('💾 Saving attendance, please wait...', '#2563eb');

  try {
    const res = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ class_id, date, records }),
    });

    const data = await res.json();
    if (!res.ok) {
      showMessage(data.message || '❌ Error saving attendance.', '#dc2626');
      return;
    }

    showMessage('✅ Attendance saved successfully!', '#16a34a');
    rowsContainer.innerHTML = '';
  } catch (err) {
    showMessage('⚠️ Network error. Please check your connection.', '#dc2626');
  }
});
