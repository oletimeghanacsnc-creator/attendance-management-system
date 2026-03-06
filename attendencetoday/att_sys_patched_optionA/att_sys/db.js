const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./attendance.db');

db.serialize(() => {
  // Teachers
  db.run(`CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Classes (class details)
  db.run(`CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    class_name TEXT NOT NULL,
    section TEXT NOT NULL,
    subject_code TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    hours INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(teacher_id) REFERENCES teachers(id)
  )`);

  // Students (scoped to a class)
  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    usn TEXT NOT NULL,
    gender TEXT NOT NULL,
    UNIQUE(class_id, usn),
    FOREIGN KEY(class_id) REFERENCES classes(id)
  )`);

  // Attendance (unique per student per date)
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    hour INTEGER NOT NULL DEFAULT 1,
    time TEXT,
    start_time TEXT,
    end_time TEXT,
    status TEXT NOT NULL CHECK (status IN ('present','absent')),
    UNIQUE(student_id, date, hour),
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  // Migrate legacy attendance table to include hour/time columns.
  db.all(`PRAGMA table_info(attendance)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const hasHour = cols.some((c) => c.name === 'hour');
    const hasTime = cols.some((c) => c.name === 'time');
    const hasStartTime = cols.some((c) => c.name === 'start_time');
    const hasEndTime = cols.some((c) => c.name === 'end_time');

    if (!hasHour) db.run(`ALTER TABLE attendance ADD COLUMN hour INTEGER NOT NULL DEFAULT 1`);
    if (!hasTime) db.run(`ALTER TABLE attendance ADD COLUMN time TEXT`);
    if (!hasStartTime) db.run(`ALTER TABLE attendance ADD COLUMN start_time TEXT`);
    if (!hasEndTime) db.run(`ALTER TABLE attendance ADD COLUMN end_time TEXT`);

    // Ensure uniqueness is (student_id, date, hour). If not, rebuild table.
    db.all(`PRAGMA index_list(attendance)`, (idxErr, idxRows) => {
      if (idxErr || !Array.isArray(idxRows)) return;
      const uniqueIndexes = idxRows.filter((r) => r.unique);
      if (!uniqueIndexes.length) return;

      let checked = 0;
      let needsRebuild = true;
      uniqueIndexes.forEach((idx) => {
        db.all(`PRAGMA index_info(${idx.name})`, (infoErr, infoRows) => {
          checked += 1;
          if (!infoErr && Array.isArray(infoRows)) {
            const colsSet = infoRows.map((c) => c.name).sort().join(',');
            if (colsSet === 'date,hour,student_id') {
              needsRebuild = false;
            }
          }
          if (checked === uniqueIndexes.length && needsRebuild) {
            db.serialize(() => {
              db.run(`ALTER TABLE attendance RENAME TO attendance_old`);
              db.run(`CREATE TABLE attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                hour INTEGER NOT NULL DEFAULT 1,
                time TEXT,
                start_time TEXT,
                end_time TEXT,
                status TEXT NOT NULL CHECK (status IN ('present','absent')),
                UNIQUE(student_id, date, hour),
                FOREIGN KEY(student_id) REFERENCES students(id)
              )`);
              db.run(
                `INSERT INTO attendance (student_id, date, hour, time, start_time, end_time, status)
                 SELECT student_id, date,
                        COALESCE(hour, 1) AS hour,
                        time, start_time, end_time, status
                 FROM attendance_old`
              );
              db.run(`DROP TABLE attendance_old`);
            });
          }
        });
      });
    });
  });
});

module.exports = db;
