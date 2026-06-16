const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'almau_psych_secret_2024';
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

// ===== EMAIL =====
const emailTransporter = process.env.EMAIL_USER ? nodemailer.createTransport({
  host: 'smtp.mail.ru',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
}) : null;

async function sendEmail(to, subject, html) {
  if (!emailTransporter) return; // не настроено — молча пропускаем
  try {
    await emailTransporter.sendMail({
      from: `"AlmauPsych" <${process.env.EMAIL_USER}>`,
      to, subject, html
    });
  } catch(e) {
    console.error('Email error:', e.message);
  }
}

function emailBookingCreated(studentEmail, studentName, date, time) {
  return sendEmail(
    process.env.EMAIL_USER || 'psych@almau.edu.kz',
    `Новая запись — ${studentName}`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#1E1248">Новая запись к психологу</h2>
      <p>Студент <strong>${studentName}</strong> (${studentEmail}) записался на приём.</p>
      <p>📅 <strong>Дата:</strong> ${date}<br>🕐 <strong>Время:</strong> ${time}</p>
      <p>Войдите в <a href="https://almau-psych.up.railway.app/psych.html">кабинет психолога</a>, чтобы подтвердить или отклонить запись.</p>
    </div>`
  );
}

function emailStatusChanged(studentEmail, status, date, time) {
  const labels = { confirmed: 'подтверждена ✅', cancelled: 'отменена ❌', completed: 'завершена 🎉' };
  const label = labels[status] || status;
  return sendEmail(
    studentEmail,
    `Ваша запись ${label}`,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#1E1248">Статус записи изменён</h2>
      <p>Ваша запись на <strong>${date}</strong> в <strong>${time}</strong> — <strong>${label}</strong>.</p>
      ${status === 'confirmed' ? '<p>Ждём вас! Если нужно — напишите в <a href="https://almau-psych.up.railway.app/chat.html">чат</a>.</p>' : ''}
      ${status === 'cancelled' ? '<p>Вы можете <a href="https://almau-psych.up.railway.app/booking.html">записаться снова</a> на другое время.</p>' : ''}
    </div>`
  );
}

const ALL_TIMES = ['09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30'];

// ===== DATABASE =====
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: [], psychologists: [], appointments: [], messages: [], schedules: [], reset_tokens: [] };
  const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!d.schedules) d.schedules = [];
  if (!d.reset_tokens) d.reset_tokens = [];
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
  // TODO: раскомментировать для прода — только @almau.edu.kz
  // if (!email || !email.endsWith('@almau.edu.kz'))
  //   return res.status(400).json({ error: 'Только почта @almau.edu.kz' });
  if (!email || !email.includes('@'))
    return res.status(400).json({ error: 'Некорректный email' });
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

// ===== PASSWORD RESET =====
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  db = loadDB();
  const user = db.users.find(u => u.email === email);
  // Always respond OK to not reveal if email exists
  if (!user) return res.json({ message: 'Если такой email есть — письмо отправлено' });

  const token = require('crypto').randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  // Remove old tokens for this user
  db.reset_tokens = (db.reset_tokens || []).filter(t => t.user_id !== user.id);
  db.reset_tokens.push({ user_id: user.id, token, expires });
  saveDB(db);

  const APP_URL = process.env.APP_URL || 'https://almau-psych.up.railway.app';
  const link = `${APP_URL}/reset-password.html?token=${token}`;
  await sendEmail(
    email,
    'Сброс пароля — AlmauPsych',
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#1E1248">Сброс пароля</h2>
      <p>Вы запросили сброс пароля. Ссылка действительна 1 час.</p>
      <p><a href="${link}" style="background:#6D4FC2;color:white;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;display:inline-block">Сбросить пароль</a></p>
      <p style="color:#888;font-size:.85rem">Если вы не запрашивали сброс — просто проигнорируйте это письмо.</p>
    </div>`
  );
  res.json({ message: 'Если такой email есть — письмо отправлено' });
});

app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 6)
    return res.status(400).json({ error: 'Неверные данные' });

  db = loadDB();
  const record = (db.reset_tokens || []).find(t => t.token === token);
  if (!record || new Date(record.expires) < new Date())
    return res.status(400).json({ error: 'Ссылка недействительна или истекла' });

  const user = db.users.find(u => u.id === record.user_id);
  if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

  user.password = bcrypt.hashSync(password, 10);
  db.reset_tokens = db.reset_tokens.filter(t => t.token !== token);
  saveDB(db);
  res.json({ message: 'Пароль обновлён' });
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
  io.emit('slots_updated');
  // Уведомляем психолога о новой записи
  emailBookingCreated(req.user.email, req.user.name, date, time);
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
  const newStatus = req.body.status;
  appt.status = newStatus;
  saveDB(db);
  io.emit('slots_updated');
  // Уведомляем студента о смене статуса
  if (['confirmed', 'cancelled', 'completed'].includes(newStatus)) {
    const student = db.users.find(u => u.id === appt.student_id);
    if (student) emailStatusChanged(student.email, newStatus, appt.date, appt.time);
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

// ===== 404 =====
// Only for HTML page requests (not API or static assets)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/') || req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

server.listen(PORT, () => {
  console.log(`\n🌿 AlmauPsych: http://localhost:${PORT}`);
  console.log(`   Психолог: psych@almau.edu.kz / psych2024\n`);
});
