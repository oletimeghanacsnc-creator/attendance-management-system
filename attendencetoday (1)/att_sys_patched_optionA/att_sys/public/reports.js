const token = localStorage.getItem('token');
if (!token) location.href = '/login.html';

const classSelect = document.getElementById('classSelect');
const periodSelect = document.getElementById('period');
const rangeSelect = document.getElementById('range');
const tbody = document.getElementById('tbody');
const msg = document.getElementById('msg');
const loadBtn = document.getElementById('load');
const downloadBtn = document.getElementById('download');
let latestRows = [];
let allClasses = [];

function parseRange(value) {
  const [min, max] = String(value || '0-100').split('-').map(Number);
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 100
  };
}

function rowHtml(r) {
  const color = r.percentage >= 75 ? '#16a34a' : '#dc2626';
  return `
    <tr class="fade-in">
      <td>${r.name}</td>
      <td>${r.usn}</td>
      <td>${r.presents}</td>
      <td>${r.total}</td>
      <td style="font-weight:600;color:${color};">${r.percentage}%</td>
    </tr>
  `;
}

function renderClassOptions(list) {
  if (!list.length) {
    classSelect.innerHTML = '<option value="">No classes found</option>';
    return;
  }
  classSelect.innerHTML = list.map(c =>
    `<option value="${c.id}">${c.class_name} - ${c.section} (${c.subject_code})</option>`
  ).join('');
}

async function loadClasses() {
  try {
    msg.style.color = '#5c6f89';
    msg.textContent = 'Fetching available classes...';
    const res = await fetch('/api/classes', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to load classes');

    if (!data.length) {
      classSelect.innerHTML = '<option value="">No classes found</option>';
      msg.textContent = 'No classes available to show reports.';
      return;
    }

    allClasses = data;
    renderClassOptions(data);

    msg.textContent = 'Select class, period, and range then click Load Report.';
  } catch (err) {
    console.error(err);
    msg.style.color = '#dc2626';
    msg.textContent = 'Unable to load classes. Please refresh.';
  }
}

async function loadReport() {
  const classId = classSelect.value;
  const period = periodSelect.value;
  const attendanceRange = rangeSelect.value;
  const { min, max } = parseRange(attendanceRange);

  if (!classId) {
    msg.style.color = '#dc2626';
    msg.textContent = 'Please select a class to view report.';
    return;
  }

  try {
    msg.style.color = '#0e67d2';
    msg.textContent = 'Generating report...';
    tbody.innerHTML = '';

    const url = `/api/reports?class_id=${encodeURIComponent(classId)}&period=${encodeURIComponent(period)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error loading report');

    const filtered = data.filter(r => r.percentage >= min && r.percentage <= max);
    latestRows = filtered;
    if (!filtered.length) {
      msg.style.color = '#5c6f89';
      msg.textContent = `No records found in ${min}% - ${max}% range.`;
      return;
    }

    tbody.innerHTML = filtered.map(rowHtml).join('');
    msg.style.color = '#17874f';
    msg.textContent = `Report loaded: ${filtered.length} student(s) in ${min}% - ${max}% range.`;
  } catch (err) {
    console.error(err);
    msg.style.color = '#dc2626';
    msg.textContent = 'Failed to load report. Please try again.';
  }
}


async function downloadReportPdf() {
  const classId = classSelect.value;
  const period = periodSelect.value;
  const attendanceRange = rangeSelect.value;

  if (!classId) {
    msg.style.color = '#dc2626';
    msg.textContent = 'Please select a class to download report.';
    return;
  }

  try {
    msg.style.color = '#0e67d2';
    msg.textContent = 'Preparing PDF...';

    const url = `/api/reports/download?class_id=${encodeURIComponent(classId)}&period=${encodeURIComponent(period)}&attendance_range=${encodeURIComponent(attendanceRange)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || 'Failed to download PDF');
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `attendance_report_${classId}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);

    msg.style.color = '#17874f';
    msg.textContent = 'PDF downloaded successfully.';
  } catch (err) {
    console.error(err);
    msg.style.color = '#dc2626';
    msg.textContent = err.message || 'Unable to download PDF.';
  }
}

loadBtn.addEventListener('click', loadReport);
downloadBtn.addEventListener('click', downloadReportPdf);
loadClasses();

const style = document.createElement('style');
style.textContent = `
  .fade-in {
    opacity: 0;
    animation: fadeIn .35s ease-in-out forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);
