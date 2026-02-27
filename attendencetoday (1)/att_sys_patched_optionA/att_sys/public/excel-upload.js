// ================================
// 📤 Excel Upload Script
// ================================

// 🔐 Verify authentication
const token = localStorage.getItem('token');
if (!token) {
  location.href = '/login.html';
}

// 🎯 Element references
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const resultBox = document.getElementById('resultBox');
const resultTitle = document.getElementById('resultTitle');
const resultContent = document.getElementById('resultContent');

let selectedFile = null;

// 📁 File selection handlers
uploadArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    handleFileSelect(file);
  }
});

// 🎯 Drag and drop handlers
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.xlsx')) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelect(file);
  } else {
    showError('Please select a valid .xlsx file');
  }
});

// 📄 Handle file selection
function handleFileSelect(file) {
  if (!file.name.endsWith('.xlsx')) {
    showError('Please select a valid Excel file (.xlsx format)');
    return;
  }

  selectedFile = file;
  uploadArea.innerHTML = `
    <div class="upload-icon">✅</div>
    <p style="font-size: 1.2rem; margin: 12px 0;">
      <strong>${file.name}</strong>
    </p>
    <p style="color: #94a3b8; font-size: 0.9rem;">
      Size: ${(file.size / 1024).toFixed(2)} KB
    </p>
    <p style="color: #3b82f6; font-size: 0.9rem; margin-top: 8px;">
      Click to select a different file
    </p>
  `;
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadBtn.disabled = false;
  resultBox.className = 'result-box';
}

// 📤 Upload file
uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    showError('Please select a file first');
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = '⏳ Uploading...';
  resultBox.className = 'result-box';

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    const res = await fetch('http://localhost:3001/upload-excel', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    // Show results
    showResults(data);

  } catch (err) {
    console.error('Upload error:', err);
    showError(err.message || 'Failed to upload file. Please try again.');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '📤 Upload File';
  }
});

// ✅ Show success results
function showResults(data) {
  resultBox.className = 'result-box success';
  resultTitle.textContent = '✅ Upload Complete!';
  
  let html = '';
  
  if (data.added && data.added.length > 0) {
    html += `<div style="margin-bottom: 20px;">
      <h4 style="color: #22c55e; margin-bottom: 8px;">
        ✅ Successfully Added (${data.added.length})
      </h4>
      <div class="added-list">
        ${data.added.map(item => 
          `<div class="added-item">
            <strong>${item.name}</strong> (USN: ${item.usn}) - Class ID: ${item.classId}
          </div>`
        ).join('')}
      </div>
    </div>`;
  }

  if (data.rejected && data.rejected.length > 0) {
    html += `<div>
      <h4 style="color: #ef4444; margin-bottom: 8px;">
        ❌ Rejected (${data.rejected.length})
      </h4>
      <div class="rejected-list">
        ${data.rejected.map(item => 
          `<div class="rejected-item">
            <strong>${item.name || 'Unknown'}</strong> (USN: ${item.usn || 'N/A'})<br>
            <small>Reason: ${item.reason || 'Unknown error'}</small>
          </div>`
        ).join('')}
      </div>
    </div>`;
  }

  if (!data.added || data.added.length === 0) {
    html = '<p>No students were added. Please check your file format and try again.</p>';
  }

  resultContent.innerHTML = html;
}

// ❌ Show error
function showError(message) {
  resultBox.className = 'result-box error';
  resultTitle.textContent = '❌ Upload Failed';
  resultContent.innerHTML = `<p>${message}</p>`;
}




// New buttons for report generation & PDF
const generateReportBtn = document.createElement('button');
generateReportBtn.id = 'generateReportBtn';
generateReportBtn.textContent = '📈 Generate Report';
generateReportBtn.className = 'btn';
generateReportBtn.disabled = true;
uploadBtn.parentNode.insertBefore(generateReportBtn, uploadBtn.nextSibling);

const downloadPdfBtn = document.createElement('button');
downloadPdfBtn.id = 'downloadPdfBtn';
downloadPdfBtn.textContent = '📄 Download Report PDF';
downloadPdfBtn.className = 'btn';
downloadPdfBtn.disabled = true;
uploadBtn.parentNode.insertBefore(downloadPdfBtn, generateReportBtn.nextSibling);

// Enable buttons when file selected
fileInput.addEventListener('change', () => {
  uploadBtn.disabled = !fileInput.files.length;
  generateReportBtn.disabled = !fileInput.files.length;
  downloadPdfBtn.disabled = !fileInput.files.length;
});

// Function to upload attendance excel to server and insert into attendance table
async function uploadAttendanceExcel() {
  if (!fileInput.files.length) return alert('Select a file first');
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);

  const resp = await fetch('/upload-attendance-excel', { method: 'POST', body: fd });
  const data = await resp.json();
  if (!resp.ok) {
    showError(data.error || 'Upload failed');
    return;
  }
  // show result summary
  resultBox.className = 'result-box success';
  resultTitle.textContent = '✅ Attendance Uploaded';
  resultContent.innerHTML = `<p>Added: ${data.added} records. Skipped: ${data.skipped}.</p>`;
  return data;
}

// Generate report button: upload attendance then open reports page
generateReportBtn && generateReportBtn.addEventListener('click', async () => {
  generateReportBtn.disabled = true;
  const r = await uploadAttendanceExcel();
  generateReportBtn.disabled = false;
  if (r && r.added>=0) {
    // open reports page in new tab
    window.open('/reports_patched.html', '_blank');
  }
});

// Download PDF button: upload attendance then trigger PDF download for the class if possible
downloadPdfBtn && downloadPdfBtn.addEventListener('click', async () => {
  downloadPdfBtn.disabled = true;
  const r = await uploadAttendanceExcel();
  downloadPdfBtn.disabled = false;
  if (r) {
    // Open reports download; require user to choose class/period/range in reports page, so open it
    window.open('/reports_patched.html', '_blank');
  }
});



// ========================
// Client-side Excel parsing (SheetJS)
// ========================

// Utility: normalize header keys
function norm(k){ return k ? k.toString().trim().toLowerCase().replace(/\s+/g,'') : ''; }

// Parse Excel in-browser and prepare marks payload for /attendance/mark
async function parseAndSendExcel() {
  if (!fileInput.files.length) return showError('Please select a file first');
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, {type:'array'});
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, {defval: ''});
      if (!rows || !rows.length) return showError('No data in Excel');

      // Detect format:
      // 1) Per-date attendance rows: expect Date and Present (or P)
      // 2) Summary rows: CH and CF present -> compute percentages and show locally
      const headerKeys = Object.keys(rows[0]).map(k => norm(k));
      const hasDate = headerKeys.some(k => k.includes('date'));
      const hasPresent = headerKeys.some(k => k.includes('present') || k === 'p' || k === 'presentstatus');
      const hasCH = headerKeys.some(k => k === 'ch' || k.includes('classesheld'));
      const hasCF = headerKeys.some(k => k === 'cf' || k.includes('classesfaced') || k.includes('classesattended'));

      // Try to get className and section header names
      let classKeys = headerKeys.filter(k => k.includes('class') || k.includes('classname'));
      let sectionKeys = headerKeys.filter(k => k.includes('section') && !k.includes('subject'));

      // If summary (CH/CF) found, compute percentage and show result; ask user to upload per-date Excel for DB insertion
      if (hasCH && hasCF && (!hasDate || !hasPresent)) {
        // compute percentages
        const results = rows.map(r => {
          const keys = Object.keys(r);
          const lk = {};
          keys.forEach(k=> lk[norm(k)]=k);
          const chv = Number((r[lk['ch']||lk['classesheld']||lk['classeshelds']]||r[lk['classesheld']]||r[lk['classeshelds']]||0)) || Number(r[lk['classesheld']]||0) || 0;
          const cfv = Number((r[lk['cf']||lk['classesfaced']||lk['classesattended']]||0)) || 0;
          const usn = r[lk['usn']||lk['usn']||lk['unique student number']||'USN'] || r[lk['usn']||'usn'] || '';
          const name = r[lk['studentname']||lk['name']||'name'] || '';
          const perc = chv>0 ? Math.round((cfv/chv)*10000)/100 : 0;
          return { usn, name, ch: chv, cf: cfv, percentage: perc };
        });

        resultBox.className = 'result-box success';
        resultTitle.textContent = '📊 Summary computed (CH/CF present)';
        resultContent.innerHTML = '<div style="max-height:300px;overflow:auto">'+
          '<table style="width:100%;border-collapse:collapse"><tr><th>Name</th><th>USN</th><th>CH</th><th>CF</th><th>%</th></tr>'+
          results.map(r=>`<tr><td>${r.name}</td><td>${r.usn}</td><td>${r.ch}</td><td>${r.cf}</td><td>${r.percentage}%</td></tr>`).join('')+
          '</table></div><p style="margin-top:8px;color:#cbd5e1">Note: To store per-date attendance into the database, the Excel must include Date and Present columns (one row per student per date).</p>';

        return { summary: true, results };
      }

      // If per-date format detected, group by date and post to /attendance/mark
      if (hasDate && hasPresent) {
        // Build payload grouped by (classId/date). But first need to map className+section to classId by asking server for classes
        // We'll request /classes (server_patched.js exposes GET /classes)
        const classesResp = await fetch('/classes');
        const classes = classesResp.ok ? await classesResp.json() : [];
        const classMap = {}; // key: classname|section -> id
        classes.forEach(c=> classMap[(c.class_name||c.classname||c.name)+'|'+(c.section||'')]=c.id);

        // Prepare marks grouped by date and classId
        const grouped = {}; // key = classId|date -> { classId, date, marks: [] }
        for (const r of rows) {
          const keys = Object.keys(r);
          const lk = {}; keys.forEach(k=> lk[norm(k)]=k);
          const className = (r[lk['classname']||lk['class']||lk['classname']]||'').toString().trim();
          const section = (r[lk['section']||'section']||'').toString().trim();
          const usn = (r[lk['usn']||'usn']||'').toString().trim();
          const dateRaw = (r[lk['date']||'date']||'').toString().trim();
          const presentRaw = (r[lk['present']||lk['p']||'present']||'').toString().trim();

          if (!className || !usn) continue;
          // parse date to yyyy-mm-dd
          let date = '';
          if (dateRaw) {
            const d = new Date(dateRaw);
            if (!isNaN(d)) date = d.toISOString().slice(0,10);
            else {
              const m = dateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
              if (m) { date = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
              else date = new Date().toISOString().slice(0,10);
            }
          } else {
            date = new Date().toISOString().slice(0,10);
          }

          const present = (presentRaw && (presentRaw.toString().trim() === '1' || presentRaw.toString().toLowerCase().startsWith('y') || presentRaw.toString().toLowerCase().startsWith('p'))) ? true : false;

          const classKey = className+'|'+section;
          const classId = classMap[classKey];
          if (!classId) {
            // skip if class not found
            continue;
          }
          const gk = classId+'|'+date;
          if (!grouped[gk]) grouped[gk] = { classId: classId, date: date, marks: [] };
          grouped[gk].marks.push({ usn, present });
        }

        // Post each grouped date batch to /attendance/mark
        const results = [];
        for (const k of Object.keys(grouped)) {
          const batch = grouped[k];
          const payload = { classId: batch.classId, date: batch.date, marks: batch.marks };
          try {
            const resp = await fetch('/attendance/mark', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            const js = await resp.json();
            results.push({ ok: resp.ok, info: js, payloadSize: batch.marks.length });
          } catch(e) {
            results.push({ ok:false, error: e.message });
          }
        }

        // show summary
        resultBox.className = 'result-box success';
        resultTitle.textContent = '✅ Attendance uploaded (per-date rows parsed)';
        resultContent.innerHTML = `<p>Processed ${Object.keys(grouped).length} date-batches. Details:</p><pre style="white-space:pre-wrap">${JSON.stringify(results, null, 2)}</pre>`;

        return { summary:false, results };
      }

      // If unknown format
      showError('Could not detect Excel format. Expect either CH/CF columns (summary) or Date+Present columns (per-date attendance).');
    } catch(err) {
      console.error(err);
      showError('Error parsing Excel: '+err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Hook the existing upload and new buttons to use client-side parsing
// Replace uploadAttendanceExcel to use parseAndSendExcel
uploadBtn && uploadBtn.addEventListener('click', async () => {
  uploadBtn.disabled = true;
  const r = await parseAndSendExcel();
  uploadBtn.disabled = false;
  if (r && r.summary) {
    // nothing further
  } else if (r && r.results) {
    // open reports page automatically if any attendance uploaded
    window.open('/reports_patched.html', '_blank');
  }
});

// Also ensure generateReportBtn & downloadPdfBtn call parseAndSendExcel then open reports
const generateReportBtnEl = document.getElementById('generateReportBtn') || document.querySelector('#generateReportBtn');
const downloadPdfBtnEl = document.getElementById('downloadPdfBtn') || document.querySelector('#downloadPdfBtn');

generateReportBtnEl && generateReportBtnEl.addEventListener('click', async () => {
  generateReportBtnEl.disabled = true;
  const r = await parseAndSendExcel();
  generateReportBtnEl.disabled = false;
  if (r && !r.summary) window.open('/reports_patched.html', '_blank');
});

downloadPdfBtnEl && downloadPdfBtnEl.addEventListener('click', async () => {
  downloadPdfBtnEl.disabled = true;
  const r = await parseAndSendExcel();
  downloadPdfBtnEl.disabled = false;
  if (r && !r.summary) window.open('/reports_patched.html', '_blank');
});



// Helper: post the selected file to server endpoint (daily or summary)
async function postFileToServer(endpoint) {
  if (!fileInput.files.length) return showError('Please select a file first');
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  try {
    const resp = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok) { showError(data.error || 'Server error'); return null; }
    return data;
  } catch (err) {
    showError('Upload error: ' + err.message);
    return null;
  }
}


// Enhanced upload behavior: choose server-side route based on dropdown selection (Option A uses DB storage for summary)
const uploadTypeSelect = document.getElementById('uploadType');

uploadBtn && uploadBtn.addEventListener('click', async () => {
  uploadBtn.disabled = true;
  const mode = uploadTypeSelect ? uploadTypeSelect.value : 'daily';
  if (mode === 'daily') {
    // Prefer server-side route for daily in this mode
    const res = await postFileToServer('/upload-excel/daily');
    if (res) {
      resultBox.className = 'result-box success';
      resultTitle.textContent = '✅ Daily upload (server)';
      resultContent.innerHTML = `<p>Added: ${res.added} | Skipped: ${res.skipped}</p>`;
      // open reports
      window.open('/reports_patched.html', '_blank');
    }
  } else if (mode === 'summary') {
    const res = await postFileToServer('/upload-excel/summary');
    if (res) {
      resultBox.className = 'result-box success';
      resultTitle.textContent = '✅ Summary upload (server)';
      resultContent.innerHTML = `<p>Added: ${res.added} | Updated: ${res.updated} | Skipped: ${res.skipped}</p>`;
      // open reports
      window.open('/reports_patched.html', '_blank');
    }
  }
  uploadBtn.disabled = false;
});
