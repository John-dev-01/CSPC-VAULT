const db = require('./db');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svg = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  equipment: svg('<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>'),
  requests: svg('<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>'),
  queue: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 010 7M18 14.5c2.2.6 3.5 2.4 3.5 5.5"/>'),
  stock: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>'),
  messages: svg('<path d="M21 11.5a8.5 8.5 0 01-8.5 8.5 9 9 0 01-4-.9L3 21l1.9-5.2A8.5 8.5 0 1121 11.5z"/><path d="M8 11h8m-8 4h5"/>'),
  notifications: svg('<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'),
};
const themeToggle = `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to light mode" title="Switch to light mode"><svg class="sun-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><svg class="moon-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 018.8 3.5 8.6 8.6 0 1020.5 15.2z"/></svg><span class="sr-only">Toggle light and dark mode</span></button>`;
  const themeSelector = `<div class="theme-switcher" id="sidebar-theme-selector" role="group" aria-label="Theme preference">
    <button class="theme-option" type="button" data-theme-choice="system" aria-label="System theme" title="System"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-6-9 3-3 2 2 3-4 3 5"/></svg><span class="sr-only">System</span></button>
    <button class="theme-option" type="button" data-theme-choice="light" aria-label="Day / Light theme" title="Day / Light"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l-1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span class="sr-only">Day / Light</span></button>
    <button class="theme-option" type="button" data-theme-choice="dark" aria-label="Night / Dark theme" title="Night / Dark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 018.8 3.5 8.6 8.6 0 1020.5 15.2z"/></svg><span class="sr-only">Night / Dark</span></button>
  </div>`;
  const themeSwitcherTrigger = `<button class="theme-switcher-trigger" type="button" data-theme-switcher-toggle aria-expanded="false" aria-haspopup="true" aria-controls="sidebar-theme-selector" aria-label="Open theme settings" title="Theme settings"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg></button>`;
const roleLabel = user => user.role !== 'admin' ? 'Borrower' : user.admin_scope === 'system' ? 'System admin' : 'Department admin';
function page(req, title, body, options = {}) {
  const u = req.session.user;
  const flash = req.session.flash; delete req.session.flash;
  const path = req.path || '';
  const themeStorageKey = u ? `cspc-theme:user:${u.id}` : 'cspc-theme:guest';
  const replayIntro = !u && (path === '/login' || path === '/register');
  const sectionTitle = !u ? '' : u.role === 'admin'
    ? (path === '/admin/chat' || path === '/admin/messages' ? 'Chat' : path === '/admin/dashboard' ? 'Dashboard' : path.startsWith('/admin/equipment') || path.startsWith('/admin/categories') ? 'Manage stock' : path.startsWith('/admin/department-admins') ? 'Department accounts' : 'Request queue')
    : (path === '/chat' || path === '/messages' ? 'Chat' : path === '/my-requests' || path.startsWith('/requests/') ? 'My requests' : path === '/notifications' ? 'Notifications' : 'Equipment');
  const tabTitle = !u ? `${title} | CSPC Vault`
    : u.role === 'admin' ? `${sectionTitle} | Admin | CSPC Vault`
    : `${sectionTitle} | ${(u.name || 'Account').trim()} | CSPC Vault`;
  const unreadNotificationCount = u && !(u.role === 'admin' && u.admin_scope === 'system')
    ? db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL').get(u.id).n
    : 0;
  const unreadChatCount = !u || (u.role === 'admin' && u.admin_scope === 'system') ? 0 : u.role === 'admin'
    ? db.prepare("SELECT COUNT(*) AS n FROM chat_messages m JOIN users b ON b.id=m.borrower_id WHERE b.role='borrower' AND b.department=? AND m.sender_role='borrower' AND m.read_at IS NULL").get(u.department).n
    : db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE borrower_id=? AND sender_role='admin' AND read_at IS NULL").get(u.id).n;
  const link = (href, icon, label) => {
    const unreadCount = icon === 'notifications' ? unreadNotificationCount : icon === 'messages' ? unreadChatCount : 0;
    const badge = unreadCount ? `<span class="sidebar-notification-count" aria-label="${unreadCount} unread ${icon === 'messages' ? 'chat messages' : 'notifications'}">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
    return `<a href="${href}" title="${label}" aria-label="${label}"${path === href ? ' class="active" aria-current="page"' : ''}>${ICONS[icon] || ''}<span>${label}</span>${badge}</a>`;
  };
  const flashHtml = flash ? `<p class="flash ${flash.type}">${esc(flash.msg)}</p>` : '';
  const csrfToken = req.csrfToken ? req.csrfToken() : '';
  const safeBody = String(body).replace(/<form\b([^>]*\bmethod\s*=\s*([\"'])post\2[^>]*)>/gi, match => `${match}<input type=\"hidden\" name=\"_csrf\" value=\"${esc(csrfToken)}\">`);
  const authFlashInsidePanel = Boolean(flash && !u && ['/login', '/register'].includes(path) && safeBody.includes('<div class="auth-form-area">'));
  const guestSafeBody = authFlashInsidePanel ? safeBody.replace('<div class="auth-form-area">', `<div class="auth-form-area">${flashHtml}`) : safeBody;
  const intro = `<div id="site-intro" class="site-intro" role="status" aria-live="polite">
    <div class="site-intro-content">
      <div class="site-intro-logo" aria-hidden="true">
        <svg class="auth-logo-svg" viewBox="0 0 48 48" role="img" aria-label="Animated geometric logo">
          <path class="orbit" d="M24 4a20 20 0 1 1-14.14 5.86" />
          <path class="orbit orbit-secondary" d="M24 10a14 14 0 1 1-9.9 4.1" />
          <path class="core" d="m24 13 11 6.35v12.3L24 38l-11-6.35v-12.3z" />
          <path class="core-lines" d="M24 13v12.5m11-6.15-11 6.15-11-6.15" />
        </svg>
      </div>
      <p id="site-intro-tagline" class="site-intro-tagline" hidden>CSPC Vault</p>
    </div>
  </div>`;
  const head = `<!doctype html><html lang="en" data-theme-storage-key="${esc(themeStorageKey)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="csrf-token" content="${esc(csrfToken)}"><title>${esc(tabTitle)}</title><link id="animated-favicon" rel="icon" type="image/png" sizes="96x96" href="/favicon.png"><script>(()=>{try{const key=document.documentElement.dataset.themeStorageKey||'cspc-theme:guest';const saved=localStorage.getItem(key);const preference=saved==='light'||saved==='dark'?saved:'system';document.documentElement.dataset.themePreference=preference;document.documentElement.dataset.theme=preference==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;if(localStorage.getItem('cspc-sidebar')==='hidden')document.documentElement.dataset.sidebar='hidden';const savedSidebarWidth=Number(localStorage.getItem('cspc-sidebar-width'));if(Number.isFinite(savedSidebarWidth)&&savedSidebarWidth>=180){const maxSidebarWidth=Math.min(420,Math.floor(window.innerWidth*.42));document.documentElement.style.setProperty('--sidebar-width',Math.max(180,Math.min(maxSidebarWidth,savedSidebarWidth))+'px')}const navTransition=sessionStorage.getItem('cspc-sidebar-nav-transition');if(navTransition==='up'||navTransition==='down'){document.documentElement.dataset.navTransition=navTransition;sessionStorage.removeItem('cspc-sidebar-nav-transition')}const introSeen=sessionStorage.getItem('cspc-intro-seen-v2')==='1';sessionStorage.setItem('cspc-intro-seen-v2','1');if(introSeen&&!${replayIntro})document.documentElement.dataset.introSeen='true'}catch(e){document.documentElement.dataset.theme='light'}})()</script><link rel="stylesheet" href="/style.css"><script src="/monument-particles.js" defer></script><script src="/app.js" defer></script><script src="/favicon.js" defer></script><script src="/intro.js" defer></script><script src="/chat.js" defer></script></head><body class="${u ? 'portal-body' : 'auth-body'}">${intro}`;
  if (!u) return `${head}<div class="app guest"><div class="content"><main>${authFlashInsidePanel ? '' : flashHtml}${guestSafeBody}</main></div></div></body></html>`;
  if (u.must_change_password) return `${head}<div class="forced-password-layout"><main>${flashHtml}${safeBody}</main></div></body></html>`;
  const side = u.role === 'admin'
    ? (u.admin_scope === 'system'
      ? ''
      : link('/admin/dashboard', 'queue', 'Dashboard') + link('/admin/requests', 'queue', 'Request queue') + link('/admin/equipment', 'stock', 'Manage equipment') + link('/admin/chat', 'messages', 'Chat') + link('/notifications', 'notifications', 'Notifications'))
    : link('/equipment', 'equipment', 'Equipment') + link('/my-requests', 'requests', 'My requests') + link('/chat', 'messages', 'Chat') + link('/notifications', 'notifications', 'Notifications');
  const passwordDialog = `<dialog class="password-change-dialog" data-password-dialog aria-labelledby="password-dialog-title">
    <form class="password-dialog-content" method="post" action="/change-password">
      <div class="password-dialog-heading"><div><span class="catalog-kicker">ACCOUNT SECURITY</span><h2 id="password-dialog-title">Change password</h2></div><button class="password-dialog-close" type="button" data-close-password-dialog aria-label="Close">×</button></div>
      <label>Current password<input type="password" name="current_password" autocomplete="current-password" required></label>
      <label>New password<input type="password" name="new_password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
      <label>Confirm new password<input type="password" name="confirm_password" autocomplete="new-password" minlength="12" maxlength="72" required></label>
      <p class="field-note">Use 12+ characters with uppercase, lowercase, a number, and a symbol. Current password required.</p>
      <div class="password-dialog-actions"><button type="button" class="password-dialog-cancel" data-close-password-dialog>Cancel</button><button type="submit">Update password</button></div>
    </form>
  </dialog>`;
  const isSystemAdmin = u.role === 'admin' && u.admin_scope === 'system';
  const isDepartmentAdmin = u.role === 'admin' && u.admin_scope === 'department';
  const avatarInitial = esc((u.name || '?').trim().charAt(0).toUpperCase());
  const avatarImage = u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  const accountExpandIcon = isSystemAdmin
    ? `<span class="account-expand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 10 5-5 5 5"/><path d="m7 14 5 5 5-5"/></svg></span>`
    : `<span class="account-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5"/></svg><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></span>`;
  const account = `<div class="account-menu"><button class="account-trigger" type="button" data-account-toggle aria-expanded="false" aria-haspopup="true" aria-controls="account-menu" aria-label="Open account menu for ${esc(u.name)}" title="Open account menu"><span class="avatar" aria-hidden="true"><span class="avatar-initial">${avatarInitial}</span>${avatarImage}</span><span class="who"><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></span>${accountExpandIcon}</button><div class="account-popover" id="account-menu" data-account-menu hidden><span class="account-menu-name">${esc(u.name)}</span><small>${esc(u.email)}</small><button class="account-menu-action" type="button" data-open-password-dialog>Change password</button><form method="post" action="/logout"><button class="signout-button">Sign out</button></form></div>${passwordDialog}</div>`;
  const accountWithCsrf = account.replace(/<form\b([^>]*\bmethod\s*=\s*(["\'])post\2[^>]*)>/gi, match => `${match}<input type="hidden" name="_csrf" value="${esc(csrfToken)}">`);
  const floatingControls = isSystemAdmin
    ? `<div class="floating-portal-controls"><div class="floating-controls-bar"><div class="system-admin-account-card">${accountWithCsrf}</div><div class="system-admin-theme-card">${themeSelector}</div></div></div>`
    : '';
  const leftControlPanel = !isSystemAdmin
    ? `<aside class="sidebar" id="control-sidebar"><div class="sidebar-heading"><a class="brand" href="/" aria-label="CSPC Vault"><span class="brand-logo" aria-hidden="true"><svg viewBox="0 0 48 48"><path class="brand-orbit" d="M24 4a20 20 0 1 1-14.14 5.86"/><path class="brand-orbit brand-orbit-secondary" d="M24 10a14 14 0 1 1-9.9 4.1"/><path class="brand-core" d="m24 13 11 6.35v12.3L24 38l-11-6.35v-12.3z"/><path class="brand-core-lines" d="M24 13v12.5m11-6.15-11 6.15-11-6.15"/></svg></span><span class="brand-copy">CSPC<small>VAULT</small></span></a><button class="sidebar-toggle" type="button" data-sidebar-toggle aria-label="Hide sidebar" title="Hide sidebar" aria-controls="control-sidebar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m8-11-3 3 3 3"/></svg></button></div><nav aria-label="Main navigation">${side}</nav>${options.sidebarControls || ''}<div class="sidebar-bottom">${themeSwitcherTrigger}${themeSelector}<div class="sidebar-account-card">${accountWithCsrf}</div></div></aside>`
    : '';
  return `${head}<div class="app${isSystemAdmin ? ' system-admin-portal' : ' sidebar-portal'}${isDepartmentAdmin ? ' dept-account-portal' : ''}">${leftControlPanel}${floatingControls}<div class="content"><main>${flashHtml}${safeBody}</main></div></div></body></html>`;
}
const badge = s => `<span class="badge ${esc(s)}">${esc(s)}</span>`;
const stats = items => `<div class="stats">${items.map(([l, v, hl]) => {
  const label = String(l).toLowerCase();
  const icon = label.includes('overdue')
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2M18.5 5.5l1.5-1.5"/></svg>'
    : label.includes('loan')
      ? '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22zM4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8M8 10h7"/></svg>'
      : label.includes('active')
        ? '<svg viewBox="0 0 24 24"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.6 8-4.6M12 12.1V21"/></svg>'
        : label.includes('matching')
          ? '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 12h8M5 18h6"/><path d="m16 16 2 2 4-5"/></svg>'
          : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>';
  return `<div class="stat${hl ? ' hl' : ''}"><span class="stat-label">${esc(l)}</span><strong>${esc(v)}</strong><span class="stat-icon" aria-hidden="true">${icon}</span></div>`;
}).join('')}</div>`;
module.exports = { esc, page, badge, stats, roleLabel };
