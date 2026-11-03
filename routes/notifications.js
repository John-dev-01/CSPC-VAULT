const express = require('express');
const db = require('../middleware/db');
const { isSystemAdmin } = require('../middleware/auth');
const { esc } = require('../middleware/views');
const router = express.Router();

function requireNotificationUser(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (isSystemAdmin(req.session.user)) return res.redirect('/admin/department-admins');
  next();
}
router.use('/notifications', requireNotificationUser);

router.get('/notifications', (req, res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.session.user.id);
  const rows = db.prepare('SELECT id,type,message,request_id,created_at,read_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100')
    .all(req.session.user.id);
  const unread = rows.filter(row => !row.read_at).length;
  const body = `<div class="admin-stock-heading"><div><span class="catalog-kicker">ACCOUNT UPDATES</span><h1>Notifications</h1></div><span class="catalog-count">${unread} unread</span></div>
    ${unread ? '<form method="post" action="/notifications/read-all"><button class="link">Mark all as read</button></form>' : ''}
    ${rows.length ? `<section class="notification-list">${rows.map(row => `<article class="notification-card${row.read_at ? '' : ' is-unread'}"><div><span class="catalog-kicker">${esc(row.type.replace(/[-_]/g, ' '))}</span><time>${esc(row.created_at)}</time><p>${esc(row.message)}</p></div><div class="notification-actions">${!row.read_at ? `<form method="post" action="/notifications/${row.id}/read"><button class="link" type="submit">Mark read</button></form>` : ''}<form method="post" action="/notifications/${row.id}/delete" data-confirm-notification-delete><button class="notification-delete-button" type="submit" aria-label="Delete notification" title="Delete notification"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button></form></div></article>`).join('')}</section><div class="notification-list-footer"><form method="post" action="/notifications/delete-all" data-confirm-notification-delete-all><button class="notification-delete-all-button" type="submit" aria-label="Delete all notifications" title="Delete all notifications"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/></svg></button></form></div>` : '<p class="muted">You have no notifications yet.</p>'}`;
  res.send(req.app.locals.page(req, 'Notifications', body));
});
router.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.session.user.id);
  res.redirect('/notifications');
});
router.post('/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND read_at IS NULL')
    .run(req.params.id, req.session.user.id);
  res.redirect('/notifications');
});
router.post('/notifications/delete-all', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id=?').run(req.session.user.id);
  res.redirect('/notifications');
});
router.post('/notifications/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (Number.isSafeInteger(id) && id > 0) {
    db.prepare('DELETE FROM notifications WHERE id=? AND user_id=?').run(id, req.session.user.id);
  }
  res.redirect('/notifications');
});
module.exports = router;
