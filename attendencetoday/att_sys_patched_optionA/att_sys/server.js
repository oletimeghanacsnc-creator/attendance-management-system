const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const pdfParse = require('pdf-parse');
const db = require('./db');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_key_change_me';
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static frontend files (public folder)
app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth middleware ----
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Missing token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = user; // { id, username, name }
    next();
  });
}

// ---- Auth routes ----
app.post('/api/register', async (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) {
    return res.status(400).json({ message: 'name, username, password required' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO teachers (name, username, password_hash) VALUES (?, ?, ?)`,
      [name, username, hash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ message: 'Username already exists' });
          }
          return res.status(500).json({ message: 'DB error' });
        }
        res.json({ id: this.lastID, name, username });
      }
    );
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ message: 'username, password required' });

  db.get(`SELECT * FROM teachers WHERE username = ?`, [username], async (err, u) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    if (!u) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: u.id, username: u.username, name: u.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, name: u.name, username: u.username });
  });
});

app.get('/api/me', auth, (req, res) => {
  db.get(
    `SELECT id, name, username FROM teachers WHERE id = ?`,
    [req.user.id],
    (err, row) => {
      if (err) return res.status(500).json({ message: 'DB error' });
      res.json(row);
    }
  );
});

// ---- Classes ----
app.get('/api/classes', auth, (req, res) => {
  db.all(
    `SELECT * FROM classes WHERE teacher_id = ? ORDER BY created_at DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error' });
      res.json(rows);
    }
  );
});

app.post('/api/classes', auth, (req, res) => {
  const { class_name, section, subject_code, subject_name, hours } = req.body;
  if (!class_name || !section || !subject_code || !subject_name || !hours) {
    return res.status(400).json({ message: 'All fields required' });
  }

  db.run(
    `INSERT INTO classes (teacher_id, class_name, section, subject_code, subject_name, hours)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, class_name, section, subject_code, subject_name, hours],
    function (err) {
      if (err) return res.status(500).json({ message: 'DB error' });
      res.json({ id: this.lastID });
    }
  );
});

// ---- Students ----
app.get('/api/students', auth, (req, res) => {
  const { class_id } = req.query;
  if (!class_id) return res.status(400).json({ message: 'class_id required' });

  db.all(
    `SELECT * FROM students WHERE class_id = ? ORDER BY usn`,
    [class_id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error' });
      res.json(rows);
    }
  );
});

app.post('/api/students', auth, (req, res) => {
  const { class_id, name, usn, gender } = req.body;
  if (!class_id || !name || !usn || !gender) {
    return res.status(400).json({ message: 'class_id, name, usn, gender required' });
  }

  db.run(
    `INSERT OR IGNORE INTO students (class_id, name, usn, gender) VALUES (?, ?, ?, ?)`,
    [class_id, name, usn, gender],
    function (err) {
      if (err) return res.status(500).json({ message: 'DB error' });
      db.run(
        `UPDATE students SET name = ?, gender = ? WHERE class_id = ? AND usn = ?`,
        [name, gender, class_id, usn],
        (e2) => {
          if (e2) return res.status(500).json({ message: 'DB error' });
          db.get(
            `SELECT * FROM students WHERE class_id = ? AND usn = ?`,
            [class_id, usn],
            (e3, row) => {
              if (e3) return res.status(500).json({ message: 'DB error' });
              res.json(row);
            }
          );
        }
      );
    }
  );
});

// ---- Attendance ----
app.post('/api/attendance/mark', auth, (req, res) => {
  const { class_id, date, hour, start_time, end_time, records } = req.body;
  const hourValue = Number.parseInt(hour, 10);
  const period = Number.isFinite(hourValue) && hourValue > 0 ? hourValue : 1;
  const startTimeValue = typeof start_time === 'string' && start_time.trim()
    ? start_time.trim()
    : null;
  const endTimeValue = typeof end_time === 'string' && end_time.trim()
    ? end_time.trim()
    : null;
  if (!class_id || !date || !Array.isArray(records)) {
    return res.status(400).json({ message: 'class_id, date, records[] required' });
  }

  db.serialize(() => {
    records.forEach(r => {
      const status = r.status?.toLowerCase() === 'absent' ? 'absent' : 'present';

      // Insert or update student
      db.run(
        `INSERT OR IGNORE INTO students (class_id, name, usn, gender) VALUES (?, ?, ?, ?)`,
        [class_id, r.name, r.usn, r.gender]
      );
      db.run(
        `UPDATE students SET name = ?, gender = ? WHERE class_id = ? AND usn = ?`,
        [r.name, r.gender, class_id, r.usn]
      );

      // Get student id and mark attendance
      db.get(
        `SELECT id FROM students WHERE class_id = ? AND usn = ?`,
        [class_id, r.usn],
        (e, st) => {
          if (!e && st) {
            db.run(
              `INSERT OR REPLACE INTO attendance
               (student_id, date, hour, time, start_time, end_time, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [st.id, date, period, startTimeValue, startTimeValue, endTimeValue, status]
            );
          }
        }
      );
    });

    res.json({ message: 'Attendance saved' });
  });
});

app.get('/api/attendance/hours', auth, (req, res) => {
  const { class_id, date } = req.query;
  if (!class_id || !date) {
    return res.status(400).json({ message: 'class_id and date required' });
  }

  const sql = `
    SELECT DISTINCT a.hour
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    WHERE s.class_id = ? AND a.date = ?
    ORDER BY a.hour ASC`;

  db.all(sql, [class_id, date], (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    const hours = rows.map(r => Number(r.hour)).filter(n => Number.isFinite(n));
    res.json({ hours });
  });
});

// ---- Reports ----
app.get('/api/reports', auth, (req, res) => {
  const { class_id, range, period, attendance_range } = req.query;
  if (!class_id) return res.status(400).json({ message: 'class_id required' });

  const parsedPeriod = Number.parseInt(period, 10);
  const days = Number.isFinite(parsedPeriod) && parsedPeriod > 0
    ? parsedPeriod
    : (range === 'monthly' ? 30 : 7);
  if (!Number.isFinite(days) || days < 1) {
    return res.status(400).json({ message: 'period must be at least 1 day' });
  }

  let minPct = 0;
  let maxPct = 100;
  if (attendance_range && typeof attendance_range === 'string' && attendance_range.includes('-')) {
    const [min, max] = attendance_range.split('-').map(n => Number.parseFloat(n));
    if (Number.isFinite(min) && Number.isFinite(max)) {
      minPct = min;
      maxPct = max;
    }
  }

  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const offset = `-${Math.max(days - 1, 0)} day`;

  const totalSql = `
    SELECT COUNT(DISTINCT a.date || '-' || a.hour) as total_hours
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    WHERE s.class_id = ? AND a.date BETWEEN date(?, ?) AND ?`;

  db.get(totalSql, [class_id, endDate, offset, endDate], (totalErr, totalRow) => {
    if (totalErr) return res.status(500).json({ message: 'DB error' });
    const totalHours = Number(totalRow?.total_hours || 0);

    const sql = `
      SELECT s.id as student_id, s.name, s.usn,
        SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present_hours
      FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id
        AND a.date BETWEEN date(?, ?) AND ?
      WHERE s.class_id = ?
      GROUP BY s.id, s.name, s.usn
      ORDER BY s.usn ASC`;

    db.all(sql, [endDate, offset, endDate, class_id], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error' });
      const out = rows.map(r => {
        const present = Number((r.present_hours || 0).toFixed(2));
        const total = Number((totalHours || 0).toFixed(2));
        const absent = Number((total - present).toFixed(2));
        const percentage = total ? Number(((present / total) * 100).toFixed(2)) : 0;
        return {
          student_id: r.student_id,
          name: r.name,
          usn: r.usn,
          present,
          absent,
          total,
          percentage
        };
      }).filter(r => r.percentage >= minPct && r.percentage <= maxPct);

      res.json({
        mode: 'range',
        days,
        start_date: null,
        end_date: endDate,
        total_hours: totalHours,
        rows: out
      });
    });
  });
});

app.get('/api/reports/download', auth, (req, res) => {
  const { class_id, range, period, attendance_range } = req.query;
  if (!class_id) return res.status(400).json({ message: 'class_id required' });

  const parsedPeriod = Number.parseInt(period, 10);
  const days = Number.isFinite(parsedPeriod) && parsedPeriod > 0
    ? parsedPeriod
    : (range === 'monthly' ? 30 : 7);
  if (!Number.isFinite(days) || days < 1) {
    return res.status(400).json({ message: 'period must be at least 1 day' });
  }

  let minPct = 0;
  let maxPct = 100;
  if (attendance_range && typeof attendance_range === 'string' && attendance_range.includes('-')) {
    const [min, max] = attendance_range.split('-').map(n => Number.parseFloat(n));
    if (Number.isFinite(min) && Number.isFinite(max)) {
      minPct = min;
      maxPct = max;
    }
  }

  const now = new Date();
  const endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const offset = `-${Math.max(days - 1, 0)} day`;

  const totalSql = `
    SELECT COUNT(DISTINCT a.date || '-' || a.hour) as total_hours
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    WHERE s.class_id = ? AND a.date BETWEEN date(?, ?) AND ?`;

  db.get(totalSql, [class_id, endDate, offset, endDate], (totalErr, totalRow) => {
    if (totalErr) return res.status(500).json({ message: 'DB error' });
    const totalHours = Number(totalRow?.total_hours || 0);

    db.get(
      `SELECT class_name, section, subject_code FROM classes WHERE id = ? AND teacher_id = ?`,
      [class_id, req.user.id],
      (classErr, classRow) => {
        if (classErr) return res.status(500).json({ message: 'DB error' });
        if (!classRow) return res.status(404).json({ message: 'Class not found' });

        const sql = `
          SELECT s.name, s.usn,
            SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present_hours
          FROM students s
          LEFT JOIN attendance a ON a.student_id = s.id
            AND a.date BETWEEN date(?, ?) AND ?
          WHERE s.class_id = ?
          GROUP BY s.id, s.name, s.usn
          ORDER BY s.usn ASC`;

        db.all(sql, [endDate, offset, endDate, class_id], (err, rows) => {
          if (err) return res.status(500).json({ message: 'DB error' });

          const data = rows.map(r => {
            const presents = Number((r.present_hours || 0).toFixed(2));
            const total = Number((totalHours || 0).toFixed(2));
            const percentage = total ? Number(((presents / total) * 100).toFixed(2)) : 0;
            return { ...r, presents, total, percentage };
          }).filter(r => r.percentage >= minPct && r.percentage <= maxPct);

        const filename = `attendance_report_${classRow.class_name}_${classRow.section}.pdf`
          .replace(/\s+/g, '_');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Keep compression disabled so text extraction remains predictable.
        const doc = new PDFDocument({ margin: 36, size: 'A4', compress: false });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('error', () => {
          if (!res.headersSent) {
            res.status(500).json({ message: 'Failed to generate PDF' });
          } else {
            res.end();
          }
        });
        doc.on('end', () => {
          try {
            const pdfBuffer = Buffer.concat(chunks);
            const markerPayload = Buffer.from(JSON.stringify({
              class_id: Number(class_id),
              period: days,
              attendance_range: `${minPct}-${maxPct}`,
              rows: data
            }), 'utf8').toString('base64');
            const marker = `\nAMS_JSON_BEGIN\n${markerPayload}\nAMS_JSON_END\n`;
            const out = Buffer.concat([pdfBuffer, Buffer.from(marker, 'utf8')]);
            res.setHeader('Content-Length', out.length);
            res.end(out);
          } catch {
            if (!res.headersSent) res.status(500).json({ message: 'Failed to finalize PDF' });
            else res.end();
          }
        });

        doc.fontSize(16).text('Attendance Report', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(11).text(
          `Class: ${classRow.class_name} - ${classRow.section} (${classRow.subject_code})`
        );
        doc.fontSize(11).text(`Period: Last ${days} days`);
        doc.fontSize(11).text(`Range: ${minPct}% - ${maxPct}%`);
        doc.fontSize(11).text(`Generated: ${new Date().toLocaleString()}`);
        doc.moveDown(1);

        const headers = ['Name', 'USN', 'Presents', 'Total', 'Percentage'];
        const colWidths = [180, 120, 80, 60, 90];
        const rowHeight = 22;
        const startX = 36;
        let y = doc.y;

        const drawRow = (values, isHeader = false) => {
          let x = startX;
          doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
          for (let i = 0; i < values.length; i++) {
            doc.rect(x, y, colWidths[i], rowHeight).stroke('#6b7f99');
            doc.text(String(values[i]), x + 4, y + 6, {
              width: colWidths[i] - 8,
              align: i === 0 ? 'left' : 'center',
              ellipsis: true
            });
            x += colWidths[i];
          }
          y += rowHeight;
        };

        drawRow(headers, true);
        if (!data.length) {
          drawRow(['No rows for selected range', '-', '-', '-', '-']);
        } else {
          data.forEach((r) => {
            if (y + rowHeight > doc.page.height - 40) {
              doc.addPage();
              y = 36;
              drawRow(headers, true);
            }
            drawRow([r.name, r.usn, r.presents, r.total, `${r.percentage}%`]);
          });
        }

          doc.end();
        });
      }
    );
  });
});

function removeStudentFromClass(req, res) {
  const { class_id, usn, student_id } = req.body || {};
  if (!student_id && (!class_id || !usn)) {
    return res.status(400).json({ message: 'student_id OR (class_id and usn) required' });
  }

  const sql = student_id
    ? `SELECT s.id
       FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.id = ? AND c.teacher_id = ?`
    : `SELECT s.id
       FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.class_id = ? AND s.usn = ? AND c.teacher_id = ?`;

  const params = student_id
    ? [student_id, req.user.id]
    : [class_id, usn, req.user.id];

  db.get(
    sql,
    params,
    (err, row) => {
      if (err) return res.status(500).json({ message: 'DB error' });
      if (!row) return res.status(404).json({ message: 'Student not found in this class' });

      db.run(`DELETE FROM attendance WHERE student_id = ?`, [row.id], (e2) => {
        if (e2) return res.status(500).json({ message: 'DB error' });
        db.run(`DELETE FROM students WHERE id = ?`, [row.id], (e3) => {
          if (e3) return res.status(500).json({ message: 'DB error' });
          return res.json({ message: 'Student removed from class' });
        });
      });
    }
  );
}

app.delete('/api/students', auth, removeStudentFromClass);
app.post('/api/students/remove', auth, removeStudentFromClass);
app.post('/api/students/delete', auth, removeStudentFromClass);

app.post('/api/upload/report-pdf', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'PDF file is required' });

  try {
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (ext !== '.pdf') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ message: 'Only PDF files are supported' });
    }

    const dataBuffer = fs.readFileSync(req.file.path);
    fs.unlink(req.file.path, () => {});

    const raw = dataBuffer.toString('latin1');

    // Preferred path: machine-readable marker embedded by /api/reports/download.
    const markerMatch = raw.match(/AMS_JSON_BEGIN\s*([\s\S]*?)\s*AMS_JSON_END/);
    if (markerMatch && markerMatch[1]) {
      try {
        const decoded = Buffer.from(markerMatch[1].trim(), 'base64').toString('utf8');
        const payload = JSON.parse(decoded);
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        return res.json({ message: 'PDF parsed', rows });
      } catch {
        // Fallback parsing below.
      }
    }

    // Fallback for older PDFs without marker.
    let lines = [];
    try {
      const parsed = await pdfParse(dataBuffer);
      lines = String(parsed.text || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
    } catch {
      lines = [];
    }

    const rows = [];
    const rowRegex = /^(.*?)\s+([A-Za-z0-9_-]+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%$/;
    lines.forEach((line) => {
      const m = line.match(rowRegex);
      if (!m) return;
      rows.push({
        name: m[1].trim(),
        usn: m[2].trim(),
        presents: Number.parseInt(m[3], 10),
        total: Number.parseInt(m[4], 10),
        percentage: Number.parseFloat(m[5])
      });
    });

    return res.json({
      message: 'PDF parsed',
      rows
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(500).json({ message: err.message || 'Failed to parse PDF' });
  }
});

// ---- Pages ----
app.get('/', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/index.html', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.get('/home', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'home.html'))
);

app.get('/register', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'register.html'))
);

app.get('/dashboard.html', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

// ✅ Added Forgot Password route
app.get('/forget.html', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'forget.html'))
);

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});











































































































































































































































































































































































































































































































































































































































































































































































































































































































