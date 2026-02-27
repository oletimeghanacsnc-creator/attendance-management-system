// ===============================
// 📊 Attendance Reports Script
// ===============================

// 🔐 Verify authentication
const tokenR = localStorage.getItem('token');
if (!tokenR) location.href = '/login.html';

// 🎯 Element references
const classSelectR = document.getElementById('classSelect');
const range = document.getElementById('range');
const tbodyR = document.getElementById('tbody');
const msgR = document.getElementById('msg');
const loadBtn = document.getElementById('load');

// 🌀 Load classes on page start
(async function loadClasses() {
  try {
    msgR.textContent = 'Fetching available classes...';
    const res = await fetch('/api/classes', {
      headers: { Authorization: `Bearer ${tokenR}` }
    });

    if (!res.ok) throw new Error('Failed to load classes');
    const list = await res.json();

    if (list.length === 0) {
      classSelectR.innerHTML = `<option value="">No classes found</option>`;
      msgR.textContent = 'No classes available to show reports.';
      return;
    }

    classSelectR.innerHTML = list
      .map(
        (c) =>
          `<option value="${c.id}">${c.class_name} - ${c.section} (${c.subject_code})</option>`
      )
      .join('');

    msgR.textContent = 'Select class and range, then click "Load Report".';
  } catch (error) {
    console.error(error);
    msgR.style.color = 'crimson';
    msgR.textContent = '⚠️ Unable to load classes. Please try again.';
  }
})();

// 📦 Load report when button is clicked
loadBtn.addEventListener('click', async () => {
  const class_id = classSelectR.value;
  const period = document.getElementById('period').value;
  const rangeValue = range.value;

  // 🧠 Validation
  if (!class_id) {
    msgR.style.color = 'crimson';
    msgR.textContent = 'Please select a class to view the report.';
    return;
  }

  msgR.style.color = '#1e3a8a';
  msgR.textContent = '⏳ Generating attendance report...';
  tbodyR.innerHTML = '';

  try {
    // Try new patched API first, fallback to original API
    let res, data;
    try {
      res = await fetch(`http://localhost:3001/reports?classId=${class_id}&period=${period}&range=${rangeValue}`);
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error loading report');
      
      // New API format: { totalClasses, rows: [...] }
      if (data.rows && data.rows.length === 0) {
        msgR.style.color = '#64748b';
        msgR.textContent = 'No attendance records found for the selected range.';
        return;
      }

      tbodyR.innerHTML = (data.rows || [])
        .map(
          (x) => `
        <tr class="fade-in">
          <td>${x.name}</td>
          <td>${x.usn}</td>
          <td>${x.presents}</td>
          <td>${x.total}</td>
          <td style="font-weight:600; color:${
            x.percentage >= 75 ? '#16a34a' : '#dc2626'
          };">${x.percentage}%</td>
        </tr>`
        )
        .join('');

      msgR.style.color = '#16a34a';
      msgR.textContent = `✅ Report loaded successfully! (${data.totalClasses || 0} classes)`;
    } catch (newApiError) {
      // Fallback to original API
      console.log('New API failed, using original API:', newApiError);
      const r = rangeValue === '0-100' ? 'weekly' : (period === '30' ? 'monthly' : 'weekly');
      res = await fetch(`/api/reports?class_id=${class_id}&range=${r}`, {
        headers: { Authorization: `Bearer ${tokenR}` }
      });

      data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error loading report');

      // Original API format: array of records
      if (data.length === 0) {
        msgR.style.color = '#64748b';
        msgR.textContent = 'No attendance records found for the selected range.';
        return;
      }

      tbodyR.innerHTML = data
        .map(
          (x) => `
        <tr class="fade-in">
          <td>${x.name}</td>
          <td>${x.usn}</td>
          <td>${x.presents}</td>
          <td>${x.total}</td>
          <td style="font-weight:600; color:${
            x.percentage >= 75 ? '#16a34a' : '#dc2626'
          };">${x.percentage}%</td>
        </tr>`
        )
        .join('');

      msgR.style.color = '#16a34a';
      msgR.textContent = '✅ Report loaded successfully!';
    }
  } catch (err) {
    console.error(err);
    msgR.style.color = 'crimson';
    msgR.textContent = '⚠️ Failed to load report. Please try again later.';
  }
});

// 📥 Download PDF report
document.getElementById('download').addEventListener('click', () => {
  const class_id = classSelectR.value;
  const period = document.getElementById('period').value;
  const rangeValue = range.value;

  if (!class_id) {
    msgR.style.color = 'crimson';
    msgR.textContent = 'Please select a class to download the report.';
    return;
  }

  // Open PDF download from patched server
  window.open(`http://localhost:3001/reports/download?classId=${class_id}&period=${period}&range=${rangeValue}`, '_blank');
  msgR.style.color = '#16a34a';
  msgR.textContent = '📥 PDF download started...';
});

// 🪄 Add simple fade-in effect for smooth table row appearance
const style = document.createElement('style');
style.textContent = `
  .fade-in {
    opacity: 0;
    animation: fadeIn 0.4s ease-in-out forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);
