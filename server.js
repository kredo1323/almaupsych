const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'almau_psych_secret_2024';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

const ALL_TIMES = ['09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'];

// ===== DATABASE =====
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: [], psychologists: [], appointments: [], messages: [], schedules: [] };
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!d.schedules) d.schedules = [];
  return d;
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function nextId(arr) { return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1; }

// ===== SEED: ONE ADMIN PSYCHOLOGIST =====
let db = loadDB();

// Reset if old multi-psychologist data exists
const hasManyPsychs = db.psychologists && db.psychologists.length > 1;
if (db.users.length === 0 || hasManyPsychs) {
  // Keep existing student accounts
  const students = (db.users || []).filter(u => u.role === 'student');
  const studentAppts = (db.appointments || []).filter(a => {
    const s = students.find(u => u.id === a.student_id);
    return !!s;
  });

  db.users = students;
  db.psychologists = [];
  db.appointments = studentAppts;
  db.messages = (db.messages || []);
  db.schedules = [];

  // Create single admin psychologist account
  const adminId = nextId(db.users.length ? db.users : [{id:0}]);
  db.users.push({
    id: adminId,
    name: 'Психологический центр AlmaU',
    email: 'psych@almau.edu.kz',
    password: bcrypt.hashSync('psych2024', 10),
    role: 'psychologist',
    created_at: new Date().toISOString()
  });
  db.psychologists.push({
    id: 1,
    user_id: adminId,
    bio: 'Психологический центр Almaty Management University',
    specialization: 'Психологическая помощь студентам'
  });

  // Fix existing appointments to point to psych id=1
  db.appointments = db.appointments.map(a => ({ ...a, psychologist_id: 1 }));
  saveDB(db);
  console.log('✅ База сброшена. Аккаунт: psych@almau.edu.kz / psych2024');
}

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Нет доступа' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Неверный токен' }); }
}

// ===== AUTH =====
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !email.endsWith('@almau.edu.kz'))
    return res.status(400).json({ error: 'Только почта @almau.edu.kz' });
  db = loadDB();
  if (db.users.find(u => u.email === email))
    return res.status(400).json({ error: 'Email уже зарегистрирован' });
  const id = nextId(db.users);
  const user = { id, name, email, password: bcrypt.hashSync(password, 10), role: 'student', created_at: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ id, role: 'student', name, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, name, email, role: 'student' } });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db = loadDB();
  const user = db.users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(400).json({ error: 'Неверный email или пароль' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/me', auth, (req, res) => {
  db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const { password, ...safe } = user;
  res.json(safe);
});

// ===== PSYCHOLOGIST PROFILE (always returns the single one) =====
app.get('/api/my-psych-profile', auth, (req, res) => {
  db = loadDB();
  const psych = db.psychologists.find(p => p.user_id === req.user.id);
  if (!psych) return res.status(404).json({ error: 'Профиль не найден' });
  res.json(psych);
});

// ===== AVAILABLE SLOTS (for booking page — live, not cached) =====
app.get('/api/available-slots/:date', (req, res) => {
  db = loadDB();
  const { date } = req.params;
  const dow = new Date(date + 'T12:00:00').getDay();

  // Get schedule for the one psychologist
  const psych = db.psychologists[0];
  if (!psych) return res.json({ available: [], booked: [] });

  const sched = db.schedules.find(s => s.psychologist_id === psych.id);
  let availTimes;
  if (sched?.overrides?.[date] !== undefined) {
    availTimes = sched.overrides[date];
  } else if (sched?.weekly?.[String(dow)]?.length > 0) {
    availTimes = sched.weekly[String(dow)];
  } else if (!sched && dow >= 1 && dow <= 5) {
    availTimes = [...ALL_TIMES];
  } else {
    availTimes = [];
  }

  // Only 'pending' and 'confirmed' appointments occupy a slot
  const bookedTimes = db.appointments
    .filter(a => a.psychologist_id === psych.id && a.date === date && (a.status === 'pending' || a.status === 'confirmed'))
    .map(a => a.time);

  const free = availTimes.filter(t => !bookedTimes.includes(t));
  res.json({ available: free, booked: bookedTimes, all: availTimes });
});

// ===== APPOINTMENTS =====
app.post('/api/appointments', auth, (req, res) => {
  const { date, time, note } = req.body;
  db = loadDB();
  const psych = db.psychologists[0];
  if (!psych) return res.status(500).json({ error: 'Психолог не найден' });

  // Check slot is still free (real-time check)
  const conflict = db.appointments.find(a =>
    a.psychologist_id === psych.id && a.date === date && a.time === time &&
    a.status !== 'cancelled'
  );
  if (conflict) return res.status(400).json({ error: 'Это время уже занято, выберите другое' });

  const id = nextId(db.appointments);
  db.appointments.push({ id, student_id: req.user.id, psychologist_id: psych.id, date, time, note: note || '', status: 'pending', created_at: new Date().toISOString() });
  saveDB(db);
  res.json({ id, message: 'Запись создана' });
});

app.get('/api/appointments', auth, (req, res) => {
  db = loadDB();
  if (req.user.role === 'student') {
    const appts = db.appointments
      .filter(a => a.student_id === req.user.id)
      .map(a => ({ ...a, psych_name: 'Психологический центр AlmaU', specialization: 'Психологическая помощь' }))
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json(appts);
  } else {
    // Psychologist sees all
    const appts = db.appointments
      .map(a => {
        const su = db.users.find(u => u.id === a.student_id);
        return { ...a, student_name: su?.name || '—', student_email: su?.email || '—' };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    res.json(appts);
  }
});

app.patch('/api/appointments/:id', auth, (req, res) => {
  db = loadDB();
  const appt = db.appointments.find(a => a.id === Number(req.params.id));
  if (!appt) return res.status(404).json({ error: 'Не найдено' });
  appt.status = req.body.status;
  saveDB(db);
  // Free the slot when cancelled or completed
  if (req.body.status === 'cancelled' || req.body.status === 'completed') {
    io.emit('slots_updated');
  }
  res.json({ message: 'Обновлено' });
});

// DELETE appointment → slot immediately freed
app.delete('/api/appointments/:id', auth, (req, res) => {
  db = loadDB();
  const idx = db.appointments.findIndex(a => a.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ error: 'Не найдено' });
  db.appointments.splice(idx, 1);
  saveDB(db);
  // Notify clients that slots changed
  io.emit('slots_updated');
  res.json({ message: 'Удалено' });
});

// Reschedule
app.patch('/api/appointments/:id/reschedule', auth, (req, res) => {
  db = loadDB();
  const appt = db.appointments.find(a => a.id === Number(req.params.id));
  if (!appt) return res.status(404).json({ error: 'Не найдено' });
  const { date, time } = req.body;
  const conflict = db.appointments.find(a =>
    a.id !== appt.id && a.psychologist_id === appt.psychologist_id &&
    a.date === date && a.time === time && a.status !== 'cancelled'
  );
  if (conflict) return res.status(400).json({ error: 'Это время уже занято' });
  appt.date = date; appt.time = time;
  saveDB(db);
  io.emit('slots_updated');
  res.json({ message: 'Перенесено' });
});

// ===== SCHEDULE =====
app.get('/api/schedule/:psych_id', (req, res) => {
  db = loadDB();
  const sched = db.schedules.find(s => s.psychologist_id === Number(req.params.psych_id)) || {
    psychologist_id: Number(req.params.psych_id),
    weekly: { "1": [...ALL_TIMES], "2": [...ALL_TIMES], "3": [...ALL_TIMES], "4": [...ALL_TIMES], "5": [...ALL_TIMES] },
    overrides: {}
  };
  res.json(sched);
});

app.put('/api/schedule', auth, (req, res) => {
  db = loadDB();
  const psych = db.psychologists.find(p => p.user_id === req.user.id);
  if (!psych) return res.status(403).json({ error: 'Нет доступа' });
  const idx = db.schedules.findIndex(s => s.psychologist_id === psych.id);
  const sched = { psychologist_id: psych.id, weekly: req.body.weekly, overrides: req.body.overrides || {} };
  if (idx >= 0) db.schedules[idx] = sched; else db.schedules.push(sched);
  saveDB(db);
  io.emit('slots_updated'); // notify booking pages
  res.json({ message: 'Расписание сохранено' });
});

// ===== MESSAGES (per student, not per appointment) =====

// Get all messages in a conversation with a student
app.get('/api/chat/:student_id', auth, (req, res) => {
  db = loadDB();
  const sid = Number(req.params.student_id);
  const msgs = db.messages
    .filter(m => m.student_id === sid)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(m => {
      const u = db.users.find(u => u.id === m.sender_id);
      return { ...m, sender_name: u?.name || '—', sender_role: u?.role || '—' };
    });
  res.json(msgs);
});

// Get list of students who have any appointment (for psychologist chat list)
app.get('/api/chat-students', auth, (req, res) => {
  db = loadDB();
  const studentIds = [...new Set(db.appointments.map(a => a.student_id))];
  const students = studentIds.map(sid => {
    const u = db.users.find(u => u.id === sid);
    const appts = db.appointments
      .filter(a => a.student_id === sid)
      .sort((a, b) => a.date.localeCompare(b.date));
    const lastMsg = db.messages
      .filter(m => m.student_id === sid)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { id: sid, name: u?.name || '—', email: u?.email || '—', appointments: appts, lastMessage: lastMsg || null };
  }).filter(s => s.name !== '—');
  res.json(students);
});

// Legacy endpoint kept for compatibility
app.get('/api/messages/:appointment_id', auth, (req, res) => {
  res.json([]);
});

// ===== SOCKET.IO =====
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Нет токена'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Неверный токен')); }
});

io.on('connection', (socket) => {
  // Join a student-based chat room
  socket.on('join_student_chat', (student_id) => {
    socket.join(`schat_${student_id}`);
  });

  // Send message in a student conversation
  socket.on('send_student_message', ({ student_id, text }) => {
    db = loadDB();
    const id = nextId(db.messages);
    const msg = {
      id,
      student_id: Number(student_id),
      sender_id: socket.user.id,
      text,
      created_at: new Date().toISOString()
    };
    db.messages.push(msg); saveDB(db);
    const u = db.users.find(u => u.id === socket.user.id);
    io.to(`schat_${student_id}`).emit('new_student_message', {
      ...msg, sender_name: u?.name, sender_role: u?.role
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n🌿 AlmauPsych: http://localhost:${PORT}`);
  console.log(`   Психолог: psych@almau.edu.kz / psych2024\n`);
});
