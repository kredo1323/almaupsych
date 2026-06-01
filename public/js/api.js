// ===== API CLIENT =====
const API = {
  base: '',

  getToken() { return localStorage.getItem('token'); },
  getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } },
  setAuth(token, user) { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); },
  clearAuth() { localStorage.removeItem('token'); localStorage.removeItem('user'); },
  isLoggedIn() { return !!this.getToken(); },

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    const token = this.getToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(this.base + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },

  requireAuth(role) {
    if (!this.isLoggedIn()) { window.location.href = '/login.html'; return false; }
    const user = this.getUser();
    if (role && user.role !== role) {
      if (user.role === 'psychologist') window.location.href = '/psych.html';
      else window.location.href = '/dashboard.html';
      return false;
    }
    return true;
  }
};

// Toast notifications
function showToast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Format date — parse as LOCAL date to avoid UTC timezone shift (UTC+5/6)
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d); // local date, no UTC shift
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const monthsFull = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return {
    day: date.getDate(),
    month: months[date.getMonth()],
    full: `${date.getDate()} ${monthsFull[date.getMonth()]} ${date.getFullYear()} г.`
  };
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function statusLabel(s) {
  return { pending: 'Ожидает', confirmed: 'Подтверждено', cancelled: 'Отменено', completed: 'Завершено' }[s] || s;
}
