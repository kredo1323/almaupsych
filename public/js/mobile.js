// ===== MOBILE SIDEBAR =====
function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('mob-overlay')?.classList.add('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('mob-overlay')?.classList.remove('open');
}

// Close sidebar on outside click
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('mob-overlay');
  if (overlay) overlay.addEventListener('click', closeSidebar);
});

// ===== INJECT MOBILE UI =====
// Adds: overlay, hamburger button in header, bottom nav bar
document.addEventListener('DOMContentLoaded', () => {
  // Overlay
  if (!document.getElementById('mob-overlay')) {
    const ov = document.createElement('div');
    ov.id = 'mob-overlay';
    ov.className = 'sidebar-overlay';
    ov.onclick = closeSidebar;
    document.body.prepend(ov);
  }

  // Hamburger in main-header
  const header = document.querySelector('.main-header');
  if (header && !header.querySelector('.hamburger')) {
    const btn = document.createElement('button');
    btn.className = 'hamburger';
    btn.onclick = openSidebar;
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:.5rem;display:flex;flex-direction:column;gap:4px';
    header.insertBefore(btn, header.firstChild);
  }

  // Bottom nav — detect current page
  const path = location.pathname;
  const isPsych = path.includes('psych');

  if (!isPsych && document.querySelector('.app-layout')) {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    const links = [
      { href: '/dashboard.html', icon: '🏠', label: 'Главная' },
      { href: '/booking.html',   icon: '📅', label: 'Записаться' },
      { href: '/chat.html',      icon: '💬', label: 'Чат' },
      { href: '/profile.html',   icon: '👤', label: 'Профиль' },
    ];
    nav.innerHTML = links.map(l => `
      <a href="${l.href}" class="${path.includes(l.href.replace('.html','').replace('/','')) || (path==='/' && l.href==='/dashboard.html') ? 'active' : ''}">
        <span class="bn-icon">${l.icon}</span>
        ${l.label}
      </a>`).join('');
    document.body.appendChild(nav);
  }
});
