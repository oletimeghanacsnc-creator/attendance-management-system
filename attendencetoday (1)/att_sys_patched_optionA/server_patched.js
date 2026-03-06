
/* Patched server for Attendance System
   Adds:
   - /upload-excel (POST) : upload .xlsx to import students/classes (enforces 60 limit)
   - /reports (GET) : JSON report filtered by range & period
   - /reports/download (GET) : PDF download
   - /classes (GET) : list classes

   Requires: npm install express multer xlsx pdfkit sqlite3 sqlite cors
*/
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

let bcrypt = null;
try {
  // Reuse bcrypt from the bundled att_sys package if available.
  bcrypt = require(path.join(__dirname, 'att_sys', 'node_modules', 'bcryptjs'));
} catch (_) {
  bcrypt = null;
}

const SESSION_COOKIE = 'ams_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map();
const protectedPages = new Set([
  '/dashboard.html',
  '/class_management.html',
  '/attendance.html',
  '/reports.html',
  '/excel.html'
]);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(v.join('=') || '');
  });
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function setSessionCookie(res, token) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );
}

function requireAuthApi(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session.user;
  next();
}

function requireAuthPage(req, res, next) {
  const session = getSession(req);
  if (!session) return res.redirect('/login');
  req.user = session.user;
  next();
}

async function hashPassword(password) {
  if (bcrypt) return bcrypt.hash(password, 10);
  return sha256(password);
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('$2') && bcrypt) {
    return bcrypt.compare(password, storedHash);
  }
  // Fallback for legacy/plain or sha256 entries
  return storedHash === password || storedHash === sha256(password);
}

function normalizedPath(pathname) {
  const lower = (pathname || '').toLowerCase();
  if (lower.startsWith('/public/')) {
    return lower.slice('/public'.length);
  }
  return lower;
}

const upload = multer({ dest: 'uploads/' });

let db;
let httpServer;
(async () => {
  try {
    // Use existing database if available, otherwise create new one
    const dbPath = fs.existsSync('./att_sys/attendance.db') ? './att_sys/attendance.db' : './attendance.db';
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username)');
    // Use existing schema - tables already exist with different structure
    // Existing: classes (id, teacher_id, class_name, section, subject_code, subject_name, hours)
    // Existing: students (id, class_id, name, usn, gender)
    // Existing: attendance (id, student_id, date, status) where status is 'present' or 'absent'
    console.log('Database initialized successfully');
    
    // Start server after database is ready
    const PORT = process.env.PORT || 3001;
    // Keep a strong reference to the server so the process stays alive
    httpServer = app.listen(PORT, () => console.log('Patched server running on', PORT));
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
})();

async function countStudents(classId) {
  const row = await db.get('SELECT COUNT(*) AS cnt FROM students WHERE class_id = ?', classId);
  return row ? row.cnt : 0;
}

app.post('/api/register', async (req, res) => {
  try {
    const name = (req.body.name || '').toString().trim();
    const username = (req.body.username || '').toString().trim().toLowerCase();
    const password = (req.body.password || '').toString();

    if (!name || !username || !password) {
      return res.status(400).json({ error: 'name, username and password are required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const existing = await db.get('SELECT id FROM teachers WHERE username = ?', [username]);
    if (existing) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const passwordHash = await hashPassword(password);
    try {
      await db.run(
        'INSERT INTO teachers (name, username, password_hash) VALUES (?, ?, ?)',
        [name, username, passwordHash]
      );
    } catch (insertErr) {
      if (String(insertErr.message || '').toLowerCase().includes('unique')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw insertErr;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('ERROR in /api/register:', err);
    return res.status(500).json({ error: 'Failed to register' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = (req.body.username || '').toString().trim().toLowerCase();
    const password = (req.body.password || '').toString();
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const user = await db.get(
      'SELECT id, name, username, password_hash FROM teachers WHERE username = ?',
      [username]
    );
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, {
      user: { id: user.id, name: user.name, username: user.username },
      expiresAt: Date.now() + SESSION_TTL_MS
    });
    setSessionCookie(res, token);
    return res.json({ success: true, user: { id: user.id, name: user.name, username: user.username } });
  } catch (err) {
    console.error('ERROR in /api/login:', err);
    return res.status(500).json({ error: 'Failed to login' });
  }
});

app.post('/api/logout', (req, res) => {
  const session = getSession(req);
  if (session) {
    sessions.delete(session.token);
  }
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/me', requireAuthApi, (req, res) => {
  res.json({ user: req.user });
});

// Guard protected pages before static file serving.
app.use((req, res, next) => {
  const target = normalizedPath(req.path);
  if (protectedPages.has(target)) {
    return requireAuthPage(req, res, next);
  }
  return next();
});

// Visiting home clears active session so user must login again.
app.use((req, res, next) => {
  const target = normalizedPath(req.path);
  if (target === '/' || target === '/index.html') {
    const session = getSession(req);
    if (session) {
      sessions.delete(session.token);
      clearSessionCookie(res);
    }
  }
  return next();
});

// serve frontend assets from project root
app.use(express.static(__dirname));
// backward compatibility for old /public/... URLs
app.use('/public', express.static(__dirname));

app.post('/upload-excel', requireAuthApi, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const teacherId = req.user.id;
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const rejected = [];
    const added = [];

    for (const r of rows) {
      const className = (r.ClassName || r.class || r.Class || '').toString().trim();
      const section = (r.Section || r.section || '').toString().trim();
      const subject = (r.Subject || r.subject || '').toString().trim();
      const usn = (r.USN || r.usn || r.U_SN || '').toString().trim();
      const studentName = (r.StudentName || r.Name || r.name || '').toString().trim();

      if (!className || !usn || !studentName) {
        rejected.push({ row: r, reason: 'Missing className or usn or studentName' });
        continue;
      }

      // Use existing schema: class_name, subject_name instead of name, subject
      // and scope class operations to the logged-in teacher.
      let cls = await db.get(
        'SELECT * FROM classes WHERE teacher_id = ? AND class_name = ? AND section = ? AND subject_name = ?',
        [teacherId, className, section, subject]
      );
      if (!cls) {
        const result = await db.run(
          'INSERT INTO classes (teacher_id, class_name, section, subject_code, subject_name, hours) VALUES (?, ?, ?, ?, ?, ?)',
          [teacherId, className, section, subject || 'N/A', subject, 0]
        );
        cls = { id: result.lastID, class_name: className, section, subject_name: subject };
      }

      const currentCount = await countStudents(cls.id);
      if (currentCount >= 60) {
        rejected.push({ usn, name: studentName, reason: 'Class size limit (60) reached' });
        continue;
      }

      try {
        // Existing schema requires gender field - default to 'Not Specified'
        await db.run('INSERT OR IGNORE INTO students (usn, name, class_id, gender) VALUES (?, ?, ?, ?)', [usn, studentName, cls.id, 'Not Specified']);
        await db.run('UPDATE students SET name = ? WHERE usn = ? AND class_id = ?', [studentName, usn, cls.id]);
        added.push({ usn, name: studentName, classId: cls.id });
      } catch (err) {
        rejected.push({ usn, name: studentName, reason: err.message });
      }
    }

    fs.unlinkSync(file.path);
    res.json({ added, rejected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Test endpoint to check database
// serve login page at root
app.get('/', (req, res) => {
  const session = getSession(req);
  if (session) {
    sessions.delete(session.token);
    clearSessionCookie(res);
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// additional simple routes for demo purposes
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/test-db', async (req, res) => {
  try {
    const test = await db.all('SELECT sql FROM sqlite_master WHERE type="table" AND name="classes"');
    res.json({ tables: test, dbPath: './att_sys/attendance.db' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/classes', requireAuthApi, async (req, res) => {
  try {
    console.log('GET /classes endpoint hit');
    // First get all columns to see what we have
    const testQuery = await db.all('PRAGMA table_info(classes)');
    console.log('Classes table structure:', testQuery);
    
    const query = 'SELECT id, class_name, section, subject_code, subject_name, hours FROM classes WHERE teacher_id = ?';
    console.log('Executing:', query);
    const classes = await db.all(query, [req.user.id]);
    console.log('Found classes:', classes.length);
    
    // Map to expected format; include raw pieces and a combined display value
    const mapped = classes.map(c => {
      const parts = [c.class_name || c.name];
      if (c.section) parts.push(c.section);
      if (c.subject_name) parts.push(c.subject_name);
      const display = parts.filter(Boolean).join(' - ');
      return {
        id: c.id,
        display,
        name: display // also provide 'name' so older clients still work
      };
    });
    res.json(mapped);
  } catch (err) {
    console.error('ERROR in /classes:', err.message);
    console.error('Full error:', err);
    res.status(500).json({ 
      error: err.message, 
      actualQuery: 'SELECT id, class_name, section FROM classes',
      hint: 'Check database schema'
    });
  }
});

// Create a class from the "Upload Class Details" UI
app.post('/classes', requireAuthApi, async (req, res) => {
  try {
    const className = (req.body.className || req.body.class_name || '').toString().trim();
    const section = (req.body.section || '').toString().trim();
    const subjectCode = (req.body.subjectCode || req.body.subject_code || '').toString().trim();
    const subjectName = (req.body.subjectName || req.body.subject_name || '').toString().trim();
    const hoursRaw = req.body.hours;
    const hours = Number.isFinite(Number(hoursRaw)) ? parseInt(hoursRaw, 10) : 0;

    if (!className || !section || !subjectCode || !subjectName) {
      return res.status(400).json({ error: 'className, section, subjectCode, subjectName are required' });
    }

    const teacherId = req.user.id;

    // Avoid duplicates: if same class already exists for this teacher, return it
    const existing = await db.get(
      'SELECT id, class_name, section, subject_code, subject_name, hours FROM classes WHERE teacher_id = ? AND class_name = ? AND section = ? AND subject_code = ? AND subject_name = ? LIMIT 1',
      [teacherId, className, section, subjectCode, subjectName]
    );
    if (existing) {
      const parts = [existing.class_name];
      if (existing.section) parts.push(existing.section);
      if (existing.subject_name) parts.push(existing.subject_name);
      return res.json({
        id: existing.id,
        display: parts.filter(Boolean).join(' - '),
        className: existing.class_name,
        section: existing.section,
        subjectCode: existing.subject_code,
        subjectName: existing.subject_name,
        hours: existing.hours
      });
    }

    const result = await db.run(
      'INSERT INTO classes (teacher_id, class_name, section, subject_code, subject_name, hours) VALUES (?, ?, ?, ?, ?, ?)',
      [teacherId, className, section, subjectCode, subjectName, hours || 0]
    );

    const created = await db.get(
      'SELECT id, class_name, section, subject_code, subject_name, hours FROM classes WHERE id = ?',
      [result.lastID]
    );

    const parts = [created.class_name];
    if (created.section) parts.push(created.section);
    if (created.subject_name) parts.push(created.subject_name);
    res.json({
      id: created.id,
      display: parts.filter(Boolean).join(' - '),
      className: created.class_name,
      section: created.section,
      subjectCode: created.subject_code,
      subjectName: created.subject_name,
      hours: created.hours
    });
  } catch (err) {
    console.error('ERROR in POST /classes:', err);
    res.status(500).json({ error: err.message });
  }
});

// return students for a given class id
app.get('/classes/:id/students', requireAuthApi, async (req, res) => {
  try {
    const classId = parseInt(req.params.id);
    if (!classId) return res.status(400).json({ error: 'classId required' });
    const classRow = await db.get(
      'SELECT id FROM classes WHERE id = ? AND teacher_id = ?',
      [classId, req.user.id]
    );
    if (!classRow) return res.status(404).json({ error: 'Class not found' });
    const students = await db.all('SELECT name, usn, gender FROM students WHERE class_id = ?', [classId]);
    res.json({ students });
  } catch (err) {
    console.error('ERROR in /classes/:id/students', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/reports', requireAuthApi, async (req, res) => {
  try {
    const classId = parseInt(req.query.classId);
    const period = parseInt(req.query.period) || 7;
    const range = (req.query.range || '').split('-');
    const minPct = parseFloat(range[0]) || 0;
    const maxPct = parseFloat(range[1]) || 100;

    if (!classId) return res.status(400).json({ error: 'classId required' });
    const classRow = await db.get('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, req.user.id]);
    if (!classRow) return res.status(404).json({ error: 'Class not found' });

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - period);
    const sinceISO = sinceDate.toISOString().slice(0,10);

    // Existing schema: attendance doesn't have class_id, need to join through students
    const datesRow = await db.get(`
      SELECT COUNT(DISTINCT a.date) AS cnt 
      FROM attendance a 
      JOIN students s ON a.student_id = s.id 
      WHERE s.class_id = ? AND a.date >= ?
    `, [classId, sinceISO]);
    const totalClasses = datesRow ? datesRow.cnt : 0;

    if (totalClasses === 0) return res.json({ totalClasses:0, rows: [] });

    const students = await db.all('SELECT id, usn, name FROM students WHERE class_id = ?', [classId]);
    const rows = [];
    for (const s of students) {
      // Use existing schema: status='present' instead of present=1
      const presentRow = await db.get('SELECT COUNT(*) AS cnt FROM attendance WHERE student_id = ? AND date >= ? AND status = ?', [s.id, sinceISO, 'present']);
      const presents = presentRow ? presentRow.cnt : 0;
      const absents = totalClasses - presents;
      const percentage = totalClasses === 0 ? 0 : (presents / totalClasses) * 100;
      if (percentage >= minPct && percentage <= maxPct) {
        rows.push({ usn: s.usn, name: s.name, presents, absents, total: totalClasses, percentage: Math.round(percentage*100)/100 });
      }
    }

    res.json({ totalClasses, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/reports/download', requireAuthApi, async (req, res) => {
  try {
    const classId = parseInt(req.query.classId);
    const period = parseInt(req.query.period) || 7;
    const range = (req.query.range || '').split('-');
    const minPct = parseFloat(range[0]) || 0;
    const maxPct = parseFloat(range[1]) || 100;

    if (!classId) return res.status(400).json({ error: 'classId required' });
    const classRow = await db.get('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, req.user.id]);
    if (!classRow) return res.status(404).json({ error: 'Class not found' });

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - period);
    const sinceISO = sinceDate.toISOString().slice(0,10);

    // Existing schema: attendance doesn't have class_id, need to join through students
    const datesRow = await db.get(`
      SELECT COUNT(DISTINCT a.date) AS cnt 
      FROM attendance a 
      JOIN students s ON a.student_id = s.id 
      WHERE s.class_id = ? AND a.date >= ?
    `, [classId, sinceISO]);
    const totalClasses = datesRow ? datesRow.cnt : 0;

    const students = await db.all('SELECT id, usn, name FROM students WHERE class_id = ?', [classId]);
    const rows = [];
    for (const s of students) {
      // Use existing schema: status='present' instead of present=1
      const presentRow = await db.get('SELECT COUNT(*) AS CNT FROM attendance WHERE student_id = ? AND date >= ? AND status = ?', [s.id, sinceISO, 'present']);
      const presents = presentRow ? presentRow.CNT : 0;
      const absents = totalClasses - presents;
      const percentage = totalClasses === 0 ? 0 : (presents / totalClasses) * 100;
      if (percentage >= minPct && percentage <= maxPct) {
        rows.push({ usn: s.usn, name: s.name, presents, absents, total: totalClasses, percentage: Math.round(percentage*100)/100 });
      }
    }

    const classInfo = await db.get('SELECT * FROM classes WHERE id = ?', [classId]);
    const classDisplay = classInfo
      ? `${classInfo.class_name || classInfo.name || ''}${classInfo.section ? ` - ${classInfo.section}` : ''}${(classInfo.subject_name || classInfo.subject) ? ` - ${classInfo.subject_name || classInfo.subject}` : ''}`
      : `Class ${classId}`;

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-disposition', `attachment; filename=attendance_report_class_${classId}.pdf`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    doc.fontSize(16).text('Attendance Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Class ID: ${classId}`);
    doc.fontSize(12).text(`Class Name: ${classDisplay}`);
    doc.fontSize(12).text(`Period: last ${period} days   Filter: ${minPct}% - ${maxPct}%`);
    doc.moveDown();

    const headers = ['USN', 'Name', 'Presents', 'Absents', 'Total', 'Percentage'];
    const colWidths = [80, 170, 70, 70, 60, 85];
    const tableX = 30;
    const rowHeight = 24;
    const headerFill = '#f3f4f6';
    const textColor = '#111111';
    const borderColor = '#333333';

    function drawHeader(y) {
      let x = tableX;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(textColor);
      for (let i = 0; i < headers.length; i++) {
        const w = colWidths[i];
        doc.save();
        doc.rect(x, y, w, rowHeight).fillAndStroke(headerFill, borderColor);
        doc.restore();
        doc.text(headers[i], x + 4, y + 7, {
          width: w - 8,
          align: i === 1 ? 'left' : 'center',
          lineBreak: false
        });
        x += w;
      }
    }

    function drawDataRow(y, data) {
      let x = tableX;
      doc.font('Helvetica').fontSize(10).fillColor(textColor);
      for (let i = 0; i < data.length; i++) {
        const w = colWidths[i];
        doc.rect(x, y, w, rowHeight).stroke(borderColor);
        doc.text(String(data[i]), x + 4, y + 7, {
          width: w - 8,
          align: i === 1 ? 'left' : 'center',
          lineBreak: false
        });
        x += w;
      }
    }

    let y = doc.y;
    drawHeader(y);
    y += rowHeight;

    rows.forEach(r => {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(y);
        y += rowHeight;
      }
      drawDataRow(y, [
        r.usn || '',
        r.name || '',
        r.presents,
        r.absents != null ? r.absents : (r.total - r.presents),
        r.total,
        `${r.percentage}%`
      ]);
      y += rowHeight;
    });

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/attendance/mark', requireAuthApi, async (req, res) => {
  const { classId, date, marks } = req.body;
  if (!classId || !date || !Array.isArray(marks)) return res.status(400).json({ error: 'Invalid payload' });
  try {
    const classRow = await db.get('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, req.user.id]);
    if (!classRow) return res.status(404).json({ error: 'Class not found' });

    for (const m of marks) {
      let student = await db.get('SELECT id FROM students WHERE usn = ? AND class_id = ?', [m.usn, classId]);
      // If student does not exist yet (e.g. added from Record Attendance UI), create it on the fly
      if (!student) {
        try {
          const result = await db.run(
            'INSERT INTO students (usn, name, class_id, gender) VALUES (?, ?, ?, ?)',
            [
              m.usn,
              m.name || m.usn || 'Unknown',
              classId,
              m.gender || 'Not Specified'
            ]
          );
          student = { id: result.lastID };
        } catch (e) {
          // If insert fails for some reason, skip this mark but continue loop
          console.error('Failed to create student for attendance mark', e);
          continue;
        }
      }
      // Use existing schema: status instead of present integer
      await db.run('INSERT OR REPLACE INTO attendance (student_id, date, status) VALUES (?, ?, ?)', 
        [student.id, date, m.present ? 'present' : 'absent']);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// download attendance for a specific class/date as PDF
app.get('/attendance/download', requireAuthApi, async (req, res) => {
  try {
    const classId = parseInt(req.query.classId);
    const date = req.query.date;
    const time = req.query.time;
    const hours = req.query.hours;
    if (!classId || !date) return res.status(400).json({ error: 'classId and date required' });
    const classRow = await db.get('SELECT id FROM classes WHERE id = ? AND teacher_id = ?', [classId, req.user.id]);
    if (!classRow) return res.status(404).json({ error: 'Class not found' });
    const students = await db.all('SELECT s.usn, s.name, a.status FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ? WHERE s.class_id = ?', [date, classId]);
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-disposition', `attachment; filename=attendance_${classId}_${date}.pdf`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(16).text('Attendance Sheet', { align: 'center' });
    doc.moveDown();
    let headerLine = `Class ID: ${classId}   Date: ${date}`;
    if (time) headerLine += `   Time: ${time}`;
    if (hours) headerLine += `   Hours: ${hours}`;
    doc.fontSize(12).text(headerLine);
    doc.moveDown();
    doc.font('Helvetica-Bold');
    doc.text('USN', 50, doc.y, { continued: true });
    doc.text('Name', 120, doc.y, { continued: true });
    doc.text('Status', 400, doc.y);
    doc.moveDown();
    doc.font('Helvetica');
    students.forEach(s => {
      doc.text(s.usn || '', 50, doc.y, { continued: true });
      doc.text(s.name || '', 120, doc.y, { continued: true });
      doc.text((s.status=='present'?'Present':'Absent'), 400, doc.y);
      doc.moveDown();
    });
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Server startup moved to database initialization block above


// ---------------------------
// Upload Attendance Excel
// ---------------------------
app.post('/upload-attendance-excel', requireAuthApi, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const teacherId = req.user.id;
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    let added = 0, skipped = 0;
    for (const r of rows) {
      const className = (r.ClassName || r.Class || r.class || '').toString().trim();
      const section = (r.Section || r.section || '').toString().trim();
      const usn = (r.USN || r.usn || '').toString().trim();
      const dateRaw = (r.Date || r.date || '').toString().trim();
      const presentRaw = (r.Present || r.present || r.P || r.p || '').toString().trim();

      if (!className || !usn) { skipped++; continue; }
      // parse date, fallback to today if missing
      let date = '';
      if (dateRaw) {
        // try ISO or dd/mm/yyyy
        const d = new Date(dateRaw);
        if (!isNaN(d)) date = d.toISOString().slice(0,10);
        else {
          // try dd/mm/yyyy
          const m = dateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) {
            const dd = m[1].padStart(2,'0'), mm = m[2].padStart(2,'0'), yy = m[3];
            date = `${yy}-${mm}-${dd}`;
          } else {
            date = new Date().toISOString().slice(0,10);
          }
        }
      } else {
        date = new Date().toISOString().slice(0,10);
      }

      const present = (presentRaw && (presentRaw.toString().trim() === '1' || presentRaw.toString().toLowerCase().startsWith('y') || presentRaw.toString().toLowerCase().startsWith('p'))) ? 1 : 0;

      // find class id
      const cls = await db.get(
        'SELECT id FROM classes WHERE teacher_id = ? AND class_name = ? AND section = ?',
        [teacherId, className, section]
      );
      if (!cls) { skipped++; continue; }
      const student = await db.get('SELECT id FROM students WHERE usn = ? AND class_id = ?', [usn, cls.id]);
      if (!student) { skipped++; continue; }

      await db.run('INSERT OR REPLACE INTO attendance (student_id, date, status) VALUES (?, ?, ?)', [student.id, date, present ? 'present' : 'absent']);
      added++;
    }

    // remove uploaded file
    try { fs.unlinkSync(file.path); } catch(e){}

    res.json({ success: true, added, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
