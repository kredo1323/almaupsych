/* ============================================
   AlmauPsych · UX Animations & Micro-interactions
   Подключается на всех app-страницах после mobile.js
   ============================================ */

// ── 1. PAGE ENTRANCE — stagger fade-in для .main-body ──
(function pageEntrance() {
  document.addEventListener('DOMContentLoaded', () => {
    const body = document.querySelector('.main-body');
    if (!body) return;
    const children = Array.from(body.children);
    children.forEach((el, i) => {
      el.classList.add('ux-fade', `ux-d${Math.min(i + 1, 6)}`);
    });
  });
})();

// ── 2. RIPPLE эффект на кнопках ──
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const r = document.createElement('span');
  r.className = 'ripple';
  const size = Math.max(btn.offsetWidth, btn.offsetHeight);
  const rect = btn.getBoundingClientRect();
  r.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(r);
  setTimeout(() => r.remove(), 550);
});

// ── 3. СКЕЛЕТОН для .stat-box при загрузке страницы ──
const statBoxes = document.querySelectorAll('.stat-box');
if (statBoxes.length) {
  statBoxes.forEach(b => b.classList.add('skeleton'));
  // Снимаем скелетон когда данные готовы (наблюдаем изменения .stat-num)
  const removeSkeletons = () => {
    statBoxes.forEach((b, i) => {
      setTimeout(() => {
        b.classList.remove('skeleton');
        const numEl = b.querySelector('.stat-num');
        if (numEl) numEl.classList.add('stat-num-animate');
      }, i * 80);
    });
  };
  // Убираем скелетон когда DOM изменился (данные пришли) или через 3с
  const mo = new MutationObserver(() => { removeSkeletons(); mo.disconnect(); });
  statBoxes.forEach(b => mo.observe(b, { childList: true, subtree: true, characterData: true }));
  setTimeout(() => { removeSkeletons(); mo.disconnect(); }, 3000);
}

// ── 4. КНОПКИ — loading state при async-действиях ──
// Автоматически вешает spinner когда кнопка внутри формы нажата
window.btnLoading = function(btn) {
  if (!btn || btn.classList.contains('btn-loading')) return;
  btn.classList.add('btn-loading');
  btn._origDisabled = btn.disabled;
  btn.disabled = true;
};
window.btnReady = function(btn) {
  if (!btn) return;
  btn.classList.remove('btn-loading');
  btn.disabled = btn._origDisabled || false;
};

// ── 5. TOAST — улучшенные уведомления с авто-закрытием ──
window.showToast = function(msg, type = 'success', duration = 3500) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);

  // Авто-удаление с анимацией
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 280);
  }, duration);
};

// ── 6. АНИМАЦИЯ СООБЩЕНИЙ В ЧАТЕ ──
// appendMsg уже вешает CSS-анимацию через .msg класс
// Дополнительно — автоскролл плавный
window.smoothScrollChat = function(el) {
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
};

// ── 7. СЛАЙДИНГ ИНДИКАТОР ДЛЯ ТАБОВ (psych.html) ──
window.initTabIndicator = function(tabsEl) {
  if (!tabsEl) return;
  const indicator = document.createElement('div');
  indicator.className = 'tab-indicator';
  tabsEl.style.position = 'relative';
  tabsEl.appendChild(indicator);

  function moveIndicator(activeTab) {
    if (!activeTab) return;
    const tabsRect = tabsEl.getBoundingClientRect();
    const activeRect = activeTab.getBoundingClientRect();
    indicator.style.left = (activeRect.left - tabsRect.left) + 'px';
    indicator.style.width = activeRect.width + 'px';
  }

  // Начальная позиция
  const active = tabsEl.querySelector('.tab.active, [class*="tab"].active');
  moveIndicator(active);

  // Следим за кликами
  tabsEl.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab], .tab-btn, [onclick*="showTab"]');
    if (tab) setTimeout(() => {
      const nowActive = tabsEl.querySelector('.tab.active, [class*="tab"].active') || tab;
      moveIndicator(nowActive);
    }, 10);
  });
};

// ── 8. КАРТОЧКИ ЗАПИСЕЙ — ripple при подтверждении ──
window.animateApptConfirm = function(card) {
  if (!card) return;
  card.style.transition = 'background 0.4s ease';
  card.style.background = 'var(--teal-50)';
  setTimeout(() => { card.style.background = ''; }, 800);
};

// ── 9. HOVER — поднятие карточек на мобильном (tap feedback) ──
if ('ontouchstart' in window) {
  document.addEventListener('touchstart', function(e) {
    const card = e.target.closest('.appt-card, .stat-box, .psych-option, .about-card');
    if (card) card.style.transform = 'scale(0.98)';
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    document.querySelectorAll('.appt-card, .stat-box, .psych-option, .about-card').forEach(c => {
      c.style.transform = '';
    });
  }, { passive: true });
}

// ── 10. ПЛАВНОЕ ПОЯВЛЕНИЕ МОДАЛЬНЫХ ОКОН ──
window.openModal = function(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
};
window.closeModal = function(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
};

// ── 11. ИНИЦИАЛИЗАЦИЯ ПОСЛЕ ЗАГРУЗКИ ──
document.addEventListener('DOMContentLoaded', () => {
  // Таб-индикатор если есть .tabs
  const tabs = document.querySelector('.tabs');
  if (tabs) setTimeout(() => initTabIndicator(tabs), 100);

  // Плавный scroll для #anchor ссылок в навигации
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  // Добавляем aria-label на hamburger для доступности
  const hamburger = document.querySelector('.hamburger');
  if (hamburger) hamburger.setAttribute('aria-label', 'Открыть меню');
});

// ── 12. OFFLINE РЕЖИМ — баннер при потере соединения ──
(function offlineMode() {
  const BANNER_ID = 'offline-banner';

  function showOffline() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:9999;
      background:#1e1248;color:white;
      padding:.7rem 1.5rem;font-size:.9rem;font-weight:600;
      display:flex;align-items:center;justify-content:center;gap:.6rem;
      animation:fadeInUp .3s ease;
    `;
    banner.innerHTML = '📡 Нет соединения с интернетом — некоторые функции недоступны';
    document.body.prepend(banner);
  }

  function hideOffline() {
    const b = document.getElementById(BANNER_ID);
    if (b) {
      b.style.animation = 'toastOut .25s ease forwards';
      setTimeout(() => b.remove(), 280);
    }
    showToast && showToast('Соединение восстановлено ✅', 'success', 2500);
  }

  window.addEventListener('offline', showOffline);
  window.addEventListener('online',  hideOffline);
  if (!navigator.onLine) showOffline();
})();

// ── helper: getInitials (если не определена в другом скрипте) ──
if (typeof getInitials === 'undefined') {
  window.getInitials = function(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name[0].toUpperCase();
  };
}
