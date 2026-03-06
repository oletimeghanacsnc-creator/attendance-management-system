const token = localStorage.getItem('token');
if (!token) location.href = '/login.html';

const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadType = document.getElementById('uploadType');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resultBox = document.getElementById('resultBox');
const resultTitle = document.getElementById('resultTitle');
const resultContent = document.getElementById('resultContent');
const reportGraph = document.getElementById('reportGraph');
const graphBars = document.getElementById('graphBars');
let latestReportRows = [];
let latestReportTitle = '';

let selectedFile = null;

function updateActionButtons() {
  const canGenerate = Boolean(selectedFile);
  generateBtn.disabled = !canGenerate;
}

function isPdf(file) {
  if (!file) return false;
  return file.type === 'application/pdf' || String(file.name || '').toLowerCase().endsWith('.pdf');
}

function norm(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function showResult(type, title, html) {
  resultBox.className = `result-box ${type}`;
  resultTitle.textContent = title;
  resultContent.innerHTML = html;
  if (reportGraph) reportGraph.style.display = 'none';
  if (type !== 'success') {
    latestReportRows = [];
    latestReportTitle = '';
  }
}

function showUploadSuccess() {
  resultBox.className = 'result-box plain';
  resultTitle.textContent = '';
  resultContent.innerHTML = '<p>the file is uploaded sucessfully</p>';
  if (reportGraph) reportGraph.style.display = 'none';
}

function getValue(row, keys) {
  const map = {};
  Object.keys(row).forEach((k) => { map[norm(k)] = k; });
  for (const key of keys) {
    const real = map[norm(key)];
    if (real && row[real] !== undefined && row[real] !== null && String(row[real]).trim() !== '') {
      return row[real];
    }
  }
  return '';
}

async function fetchClasses() {
  const res = await fetch('/api/classes', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to load classes');
  return data;
}

function parseDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + value);
    return base.toISOString().slice(0, 10);
  }
  const str = String(value).trim();
  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  const m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const day = m[1].padStart(2, '0');
  const mon = m[2].padStart(2, '0');
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${mon}-${day}`;
}

function parsePresent(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === '1' || v === 'yes' || v === 'y' || v === 'present' || v === 'p' || v === 'true';
}

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  if (!e.dataTransfer.files.length) return;
  fileInput.files = e.dataTransfer.files;
  fileInput.dispatchEvent(new Event('change'));
});

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  updateActionButtons();
  uploadArea.classList.toggle('has-file', Boolean(selectedFile));
  if (!selectedFile) return;

  const lower = String(selectedFile.name || '').toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.pdf')) {
    selectedFile = null;
    fileInput.value = '';
    updateActionButtons();
    showResult('error', 'Unsupported File', 'Please upload .xlsx or .pdf file.');
    return;
  }

  uploadArea.innerHTML = `
    <div class="file-status">
      <div class="file-check">✓</div>
      <div>
        <p class="file-name">${selectedFile.name}</p>
        <p class="muted" style="margin-top:4px;">Size: ${Math.round(selectedFile.size / 1024)} KB</p>
        <p class="muted" style="margin-top:4px;">Click to select a different file</p>
      </div>
    </div>
  `;
});

uploadType.addEventListener('change', () => {
  updateActionButtons();
});

async function handleSummary(rows) {
  const parsed = rows.map((r) => {
    const usn = String(getValue(r, ['usn', 'u_sn'])).trim();
    const name = String(getValue(r, ['studentname', 'name'])).trim();
    const ch = Number(getValue(r, ['ch', 'classesheld'])) || 0;
    const cf = Number(getValue(r, ['cf', 'classesfaced', 'classesattended'])) || 0;
    const percentage = ch > 0 ? Number(((cf / ch) * 100).toFixed(2)) : 0;
    return { usn, name, ch, cf, percentage };
  }).filter((x) => x.usn || x.name);

  if (!parsed.length) {
    showResult('error', 'Invalid Summary File', 'No valid summary rows found.');
    return;
  }

  latestReportRows = parsed;
  latestReportTitle = 'Attendance Summary Report';

  const table = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Name</th><th>USN</th><th>Total classes</th><th>Total present classes</th><th>Percentage</th></tr>
        </thead>
        <tbody>
          ${parsed.map((x) => `<tr><td>${x.name}</td><td>${x.usn}</td><td>${x.ch}</td><td>${x.cf}</td><td>${x.percentage}%</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  showResult('success', 'Summary Parsed', `${table}<p style="margin-top:10px;">Summary format is for analysis preview. Use Daily format to write attendance to database.</p>`);

  // Render bar graph below the table
  renderGraph(parsed);
}

function buildDailySummary(rows) {
  const grouped = {};
  rows.forEach((r) => {
    const usn = String(getValue(r, ['usn', 'u_sn'])).trim();
    const name = String(getValue(r, ['studentname', 'name'])).trim();
    const present = parsePresent(getValue(r, ['present', 'p']));
    if (!usn && !name) return;
    const key = usn || name;
    if (!grouped[key]) {
      grouped[key] = { usn, name, total: 0, presents: 0 };
    }
    grouped[key].total += 1;
    grouped[key].presents += present ? 1 : 0;
  });

  return Object.values(grouped).map((x) => {
    const percentage = x.total ? Number(((x.presents / x.total) * 100).toFixed(2)) : 0;
    return { usn: x.usn, name: x.name, ch: x.total, cf: x.presents, percentage };
  });
}

function renderGraph(rows) {
  if (!reportGraph || !graphBars) return;
  const bars = rows.map((x) => {
    const pct = Math.max(0, Math.min(100, Number(x.percentage) || 0));
    const color = pct >= 75 ? '#22c55e' : (pct >= 50 ? '#3b82f6' : '#ef4444');
    return `
      <div class="graph-col">
        <div class="graph-col-bar">
          <span style="height:${pct}%; background:${color};"></span>
        </div>
        <div class="graph-col-value">${pct}%</div>
        <div class="graph-col-label">${x.name || 'Student'}<br><span>${x.usn || 'N/A'}</span></div>
      </div>
    `;
  }).join('');
  graphBars.innerHTML = `<div class="graph-vertical">${bars}</div>`;
  reportGraph.style.display = 'block';
}

async function handleDaily(rows, opts = {}) {
  const classes = await fetchClasses();
  const classMap = {};
  classes.forEach((c) => {
    classMap[`${norm(c.class_name)}|${norm(c.section)}`] = c.id;
  });

  const grouped = {};
  let skipped = 0;

  rows.forEach((r) => {
    const className = String(getValue(r, ['classname', 'class', 'class_name'])).trim();
    const section = String(getValue(r, ['section'])).trim();
    const usn = String(getValue(r, ['usn', 'u_sn'])).trim();
    const name = String(getValue(r, ['studentname', 'name'])).trim();
    const gender = String(getValue(r, ['gender'])).trim() || 'Other';
    const date = parseDate(getValue(r, ['date']));
    const present = parsePresent(getValue(r, ['present', 'p']));

    if (!className || !section || !usn || !name) {
      skipped += 1;
      return;
    }

    const classId = classMap[`${norm(className)}|${norm(section)}`];
    if (!classId) {
      skipped += 1;
      return;
    }

    const key = `${classId}|${date}`;
    if (!grouped[key]) grouped[key] = { class_id: classId, date, records: [] };
    grouped[key].records.push({
      name,
      usn,
      gender,
      status: present ? 'present' : 'absent'
    });
  });

  const batches = Object.values(grouped);
  if (!batches.length) {
    showResult('error', 'No Valid Daily Rows', 'No rows matched your classes/sections. Check ClassName and Section values.');
    return;
  }

  let savedRows = 0;
  for (const batch of batches) {
    const res = await fetch('/api/attendance/mark', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(batch)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to save attendance');
    savedRows += batch.records.length;
  }

  if (opts.silentReport) {
    showUploadSuccess();
    return;
  }

  showResult(
    'success',
    'Daily Attendance Uploaded',
    `<p>Saved rows: <strong>${savedRows}</strong></p>
     <p>Skipped rows: <strong>${skipped}</strong></p>
     <p>Batches saved: <strong>${batches.length}</strong></p>`
  );
}

async function handlePdfUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload/report-pdf', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Failed to parse PDF');

  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) {
    showResult('error', 'No Rows Found', 'Could not find report rows in this PDF. Please re-download PDF from Reports and upload again.');
    return;
  }

  const table = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>Name</th><th>USN</th><th>Total present classes</th><th>Total classes</th><th>Percentage</th></tr>
        </thead>
        <tbody>
          ${rows.map((x) => `<tr><td>${x.name}</td><td>${x.usn}</td><td>${x.presents}</td><td>${x.total}</td><td>${x.percentage}%</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  latestReportRows = rows.map((x) => ({
    name: x.name,
    usn: x.usn,
    ch: x.total,
    cf: x.presents,
    percentage: x.percentage
  }));
  latestReportTitle = 'PDF Report Preview';

  showResult(
    'success',
    'PDF Report Parsed',
    `${table}<p style="margin-top:10px;">Parsed from downloaded report PDF.</p>`
  );
  renderGraph(latestReportRows);
}


generateBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  generateBtn.disabled = true;
  const oldText = generateBtn.textContent;
  generateBtn.textContent = 'Generating...';

  try {
    if (isPdf(selectedFile)) {
      await handlePdfUpload(selectedFile);
      return;
    }

    const buf = await selectedFile.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) {
      showResult('error', 'Empty File', 'No data rows found in first sheet.');
      return;
    }

    if (uploadType.value === 'summary') {
      await handleSummary(rows);
    } else {
      const summary = buildDailySummary(rows);
      if (!summary.length) {
        showResult('error', 'No Valid Rows', 'Daily file did not include valid rows.');
        return;
      }

      latestReportRows = summary;
      latestReportTitle = 'Daily Attendance Summary';

      const table = `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Name</th><th>USN</th><th>Total classes</th><th>Total present classes</th><th>Percentage</th></tr>
            </thead>
            <tbody>
              ${summary.map((x) => `<tr><td>${x.name}</td><td>${x.usn}</td><td>${x.ch}</td><td>${x.cf}</td><td>${x.percentage}%</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      showResult('success', 'Daily Summary Generated', table);
      renderGraph(summary);
    }
  } catch (err) {
    console.error(err);
    showResult('error', 'Generate Failed', err.message || 'Unable to generate report preview.');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = oldText;
  }
});

downloadBtn.addEventListener('click', () => {
  if (!latestReportRows.length) {
    showResult('error', 'No Report Data', 'Generate a report first to download the PDF.');
    return;
  }

  const rowsHtml = latestReportRows.map((x) => `
    <tr>
      <td>${x.name || ''}</td>
      <td>${x.usn || ''}</td>
      <td>${x.ch ?? x.total ?? ''}</td>
      <td>${x.cf ?? x.presents ?? ''}</td>
      <td>${x.percentage ?? ''}%</td>
    </tr>
  `).join('');

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    showResult('error', 'Popup Blocked', 'Allow popups to download the PDF.');
    return;
  }

  const html = `
    <html>
      <head>
        <title>${latestReportTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
          h2 { margin-bottom: 6px; }
          p { margin-top: 0; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
          th { background: #2563eb; color: #fff; }
        </style>
      </head>
      <body>
        <h2>${latestReportTitle}</h2>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <table>
          <thead>
            <tr><th>Name</th><th>USN</th><th>Total classes</th><th>Total present classes</th><th>Percentage</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <script>
          window.onload = () => setTimeout(() => window.print(), 200);
        </script>
      </body>
    </html>
  `;
  win.document.open();
  win.document.write(html);
  win.document.close();
});
