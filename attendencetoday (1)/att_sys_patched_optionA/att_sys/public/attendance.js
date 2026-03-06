const token = localStorage.getItem('token');
if (!token) location.href = '/login.html';

const classSelect = document.getElementById('classSelect');
const dateInput = document.getElementById('date');
const hourSelect = document.getElementById('hour');
const rowsContainer = document.getElementById('rows');
const msg = document.getElementById('msg');
const classHoursMap = new Map();
const completedHoursCache = new Map();
const storageKey = 'att_last_selection';
const completedKey = (classId, date) => `att_completed_${classId}_${date}`;

dateInput.valueAsNumber = Date.now();

function showMessage(text, color = '#334155') {
  msg.style.color = color;
  msg.textContent = text;
}

function setHourOptions(hours) {
  if (!hourSelect) return;
  const count = Math.max(1, Number(hours) || 1);
  const current = hourSelect.value;
  hourSelect.innerHTML = Array.from({ length: count }, (_, i) => {
    const val = i + 1;
    return `<option value="${val}">Hour ${val}</option>`;
  }).join('');
  if (current && Number(current) <= count) {
    hourSelect.value = current;
  }
}

function applyCompletedHours(hoursSet) {
  if (!hourSelect) return;
  const previous = hourSelect.value;
  [...hourSelect.options].forEach((opt) => {
    const val = Number(opt.value);
    if (hoursSet.has(val)) {
      const label = `Hour ${val} ✓`;
      opt.textContent = label;
      opt.label = label;
      opt.dataset.completed = '1';
      opt.disabled = true;
    } else {
      const label = `Hour ${val}`;
      opt.textContent = label;
      opt.label = label;
      opt.dataset.completed = '0';
      opt.disabled = false;
    }
  });

  // If the previously selected hour is now completed, move to the first available hour.
  const prevOption = [...hourSelect.options].find((opt) => opt.value === previous);
  if (prevOption && prevOption.disabled) {
    const firstOpen = [...hourSelect.options].find((opt) => !opt.disabled);
    if (firstOpen) hourSelect.value = firstOpen.value;
  }
}

function cacheCompletedHour(classId, date, hour) {
  const key = `${classId}|${date}`;
  const set = completedHoursCache.get(key) || new Set();
  set.add(Number(hour));
  completedHoursCache.set(key, set);
  applyCompletedHours(set);
  try {
    localStorage.setItem(completedKey(classId, date), JSON.stringify([...set]));
  } catch {
    // ignore storage failures
  }
}

async function refreshHourStatus() {
  const classId = classSelect.value;
  const date = dateInput.value;
  if (!classId || !date) return;

  // Apply locally cached completed hours immediately (persists across reloads).
  try {
    const stored = JSON.parse(localStorage.getItem(completedKey(classId, date)) || '[]');
    if (Array.isArray(stored) && stored.length) {
      const localSet = new Set(stored.map((h) => Number(h)));
      applyCompletedHours(localSet);
      completedHoursCache.set(`${classId}|${date}`, localSet);
    }
  } catch {
    // ignore JSON issues
  }

  try {
    const res = await fetch(`/api/attendance/hours?class_id=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch hours');
    const hoursSet = new Set((data.hours || []).map((h) => Number(h)));
    applyCompletedHours(hoursSet);
    completedHoursCache.set(`${classId}|${date}`, hoursSet);
    try {
      localStorage.setItem(completedKey(classId, date), JSON.stringify([...hoursSet]));
    } catch {
      // ignore storage failures
    }
  } catch {
    const fallback = completedHoursCache.get(`${classId}|${date}`);
    if (fallback) applyCompletedHours(fallback);
  }
}

async function readResponsePayload(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await res.text();
    return text ? { message: text } : null;
  } catch {
    return null;
  }
}

async function requestStudentDelete(payload) {
  const attempts = [
    { url: '/api/students/remove', method: 'POST' },
    { url: '/api/students', method: 'DELETE' },
    { url: '/api/students/delete', method: 'POST' }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: attempt.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await readResponsePayload(res);
      if (res.ok) return data || { message: 'Student removed from class' };

      // Keep trying if server only supports a different route/method.
      if (res.status === 404 || res.status === 405) continue;

      throw new Error((data && data.message) || 'Failed to delete student');
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to delete student');
}

async function loadClasses() {
  try {
    const res = await fetch('/api/classes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch classes');

    const list = await res.json();
    if (!list.length) {
      classSelect.innerHTML = '<option value="">No classes available</option>';
      return;
    }

    classHoursMap.clear();
    list.forEach((c) => classHoursMap.set(String(c.id), Number(c.hours || 1)));

    classSelect.innerHTML =
      '<option value="">-- Select a Class --</option>' +
      list
        .map(
          (c) =>
            `<option value="${c.id}">${c.class_name} - ${c.section} (${c.subject_code})</option>`
        )
        .join('');

    // Restore last selected class/date if available.
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved.class_id && classHoursMap.has(String(saved.class_id))) {
      classSelect.value = String(saved.class_id);
      if (saved.date) dateInput.value = saved.date;
    } else {
      classSelect.value = list[0]?.id ? String(list[0].id) : '';
    }

    const hours = classHoursMap.get(String(classSelect.value)) || list[0]?.hours || 1;
    setHourOptions(hours);
    if (classSelect.value) {
      loadStudentsForClass(classSelect.value, { silent: true });
      refreshHourStatus();
      setTimeout(refreshHourStatus, 250);
    }
  } catch {
    showMessage('Unable to load classes. Please try again.', '#dc2626');
  }
}

async function deleteStudentFromClass(classId, usn, studentId, tr, deleteBtn) {
  const ok = window.confirm(`Remove ${usn} from this class permanently?`);
  if (!ok) return;

  deleteBtn.disabled = true;
  const oldLabel = deleteBtn.textContent;
  deleteBtn.textContent = 'Deleting...';
  try {
    await requestStudentDelete({
      class_id: classId,
      usn,
      student_id: studentId || undefined
    });
    tr.remove();
    await loadStudentsForClass(classId, { silent: true });
    if (!rowsContainer.querySelector('tr')) {
      showMessage('Student removed. No students left in this class.', '#16a34a');
      return;
    }
    showMessage(`${usn} removed from class.`, '#16a34a');
  } catch (err) {
    showMessage(err.message || 'Unable to remove student.', '#dc2626');
    deleteBtn.disabled = false;
    deleteBtn.textContent = oldLabel;
  }
}

function createStudentRow(student = {}, opts = {}) {
  const tr = document.createElement('tr');
  const name = String(student.name || '').replace(/"/g, '&quot;');
  const usn = String(student.usn || '').replace(/"/g, '&quot;');
  const gender = String(student.gender || 'Female');
  const persisted = Boolean(opts.persisted);
  const classId = opts.classId ? String(opts.classId) : '';
  const studentId = opts.studentId ? String(opts.studentId) : '';
  tr.dataset.studentId = studentId;

  tr.innerHTML = `
    <td><input class="input" placeholder="Student Name" value="${name}" required></td>
    <td><input class="input" placeholder="USN" value="${usn}" required></td>
    <td>
      <select class="input">
        <option value="Female" ${gender === 'Female' ? 'selected' : ''}>Female</option>
        <option value="Male" ${gender === 'Male' ? 'selected' : ''}>Male</option>
        <option value="Other" ${gender !== 'Male' && gender !== 'Female' ? 'selected' : ''}>Other</option>
      </select>
    </td>
    <td>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <button type="button" class="status-btn">Present</button>
        <button
          type="button"
          class="btn danger"
          style="padding:6px 10px; font-size:12px; border-radius:8px;"
        >
          Delete
        </button>
      </div>
    </td>
  `;

  const statusBtn = tr.querySelector('.status-btn');
  const deleteBtn = tr.querySelector('.btn.danger');
  statusBtn.addEventListener('click', () => toggleStatus(statusBtn));

  deleteBtn.addEventListener('click', async () => {
    const currentUsn = tr.querySelectorAll('input.input')[1].value.trim();
    const currentStudentId = tr.dataset.studentId ? Number(tr.dataset.studentId) : null;
    if (!currentUsn) {
      tr.remove();
      return;
    }

    if (persisted && classId) {
      await deleteStudentFromClass(classId, currentUsn, currentStudentId, tr, deleteBtn);
    } else {
      tr.remove();
      showMessage('Row removed.', '#334155');
    }
  });

  return tr;
}

async function loadStudentsForClass(classId, options = {}) {
  const silent = Boolean(options.silent);
  if (!classId) {
    rowsContainer.innerHTML = '';
    if (!silent) showMessage('');
    return;
  }

  try {
    if (!silent) showMessage('Loading class members...', '#2563eb');
    rowsContainer.innerHTML = '';

    const res = await fetch(`/api/students?class_id=${encodeURIComponent(classId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to fetch students');

    if (!data.length) {
      if (!silent) showMessage('No students found in this class. Add manually if needed.', '#334155');
      return;
    }

    data.forEach((student) =>
      rowsContainer.appendChild(createStudentRow(student, {
        persisted: true,
        classId,
        studentId: student.id
      }))
    );
    if (!silent) {
      showMessage(`Loaded ${data.length} class member(s). Default status: Present.`, '#16a34a');
    }
  } catch {
    if (!silent) showMessage('Unable to load class members. Please try again.', '#dc2626');
  }
}

classSelect.addEventListener('change', (e) => {
  const hours = classHoursMap.get(String(e.target.value)) || 1;
  setHourOptions(hours);
  loadStudentsForClass(e.target.value);
  localStorage.setItem(storageKey, JSON.stringify({
    class_id: e.target.value,
    date: dateInput.value
  }));
  refreshHourStatus();
});

dateInput.addEventListener('change', () => {
  localStorage.setItem(storageKey, JSON.stringify({
    class_id: classSelect.value,
    date: dateInput.value
  }));
  refreshHourStatus();
});

if (hourSelect) {
  hourSelect.addEventListener('focus', () => refreshHourStatus());
  hourSelect.addEventListener('mousedown', () => refreshHourStatus());
}

document.getElementById('addRow').addEventListener('click', () => {
  // Auto-increment USN based on the last filled USN in the table.
  const usnInputs = [...rowsContainer.querySelectorAll('tr')].map((tr) => {
    const inputs = tr.querySelectorAll('input.input');
    return inputs[1] || null;
  }).filter(Boolean);
  let nextUsn = '';
  for (let i = usnInputs.length - 1; i >= 0; i -= 1) {
    const val = usnInputs[i].value.trim();
    if (!val) continue;
    const m = val.match(/^(.*?)(\d+)$/);
    if (m) {
      const prefix = m[1];
      const num = m[2];
      const nextNum = String(Number(num) + 1).padStart(num.length, '0');
      nextUsn = `${prefix}${nextNum}`;
    }
    break;
  }
  rowsContainer.appendChild(createStudentRow({ usn: nextUsn }, { persisted: false }));
});

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

document.getElementById('save').addEventListener('click', async () => {
  const class_id = classSelect.value;
  const date = dateInput.value;
  const hour = hourSelect ? hourSelect.value : 1;

  if (!class_id || !date) {
    showMessage('Please select a class and date.', '#dc2626');
    return;
  }

  if (hourSelect) {
    const selectedOpt = hourSelect.options[hourSelect.selectedIndex];
    if (selectedOpt && selectedOpt.disabled) {
      showMessage(`Hour ${hour} is already completed. Choose another hour.`, '#dc2626');
      return;
    }
  }

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
    showMessage('Add at least one student record before saving.', '#dc2626');
    return;
  }

  showMessage('Saving attendance, please wait...', '#2563eb');

  try {
    const res = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ class_id, date, hour, records }),
    });

    const data = await res.json();
    if (!res.ok) {
      showMessage(data.message || 'Error saving attendance.', '#dc2626');
      return;
    }

    showMessage('Attendance saved successfully.', '#16a34a');
    if (class_id && date) cacheCompletedHour(class_id, date, hour);
    localStorage.setItem(storageKey, JSON.stringify({
      class_id,
      date
    }));
    refreshHourStatus();
    setTimeout(refreshHourStatus, 400);
  } catch {
    showMessage('Network error. Please check your connection.', '#dc2626');
  }
});

loadClasses();
setTimeout(refreshHourStatus, 300);
