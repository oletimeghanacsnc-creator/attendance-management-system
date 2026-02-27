const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const db = require('./db');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_key_change_me';

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
  const { class_id, date, records } = req.body;
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
              `INSERT OR REPLACE INTO attendance (student_id, date, status) VALUES (?, ?, ?)`,
              [st.id, date, status]
            );
          }
        }
      );
    });

    res.json({ message: 'Attendance saved' });
  });
});

// ---- Reports ----
app.get('/api/reports', auth, (req, res) => {
  const { class_id, range } = req.query;
  if (!class_id) return res.status(400).json({ message: 'class_id required' });

  const days = range === 'monthly' ? 30 : 7;
  const sql = `
    SELECT s.id as student_id, s.name, s.usn,
           SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS presents,
           COUNT(a.id) AS total
    FROM students s
    LEFT JOIN attendance a ON a.student_id = s.id
      AND a.date >= date('now', ?)
    WHERE s.class_id = ?
    GROUP BY s.id, s.name, s.usn
    ORDER BY s.usn ASC`;

  db.all(sql, [`-${days} day`, class_id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'DB error' });
    const out = rows.map(r => ({
      ...r,
      percentage: r.total ? Math.round((r.presents / r.total) * 100) : 0
    }));
    res.json(out);
  });
});

// ---- Pages ----
app.get('/', (_, res) =>
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











































































































































































































































































































































































































































































































































































































































































































































































































































































































