const express = require('express');
const db = require('../middleware/db');
const { isSystemAdmin } = require('../middleware/auth');
const { stats } = require('../middleware/views');
const router = express.Router();
const todayPhilippines = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

router.get('/admin/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.status(403).send(req.app.locals.page(req, 'Forbidden', '<h1>Access denied</h1>'));
  if (isSystemAdmin(req.session.user)) return res.redirect('/admin/department-admins');
  const department = req.session.user.department;
  const params = [department];
  const pending = db.prepare("SELECT COUNT(*) AS n FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE e.department=? AND r.status='pending'").get(...params).n;
  const onLoan = db.prepare("SELECT COALESCE(SUM(r.quantity),0) AS n FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE e.department=? AND r.status='approved'").get(department).n;
  const overdue = db.prepare("SELECT COALESCE(SUM(r.quantity),0) AS n FROM borrow_requests r JOIN equipment e ON e.id=r.equipment_id WHERE e.department=? AND r.status='approved' AND r.due_date < ?").get(department, todayPhilippines()).n;
  const inventory = db.prepare('SELECT COUNT(*) AS items FROM equipment WHERE department=? AND archived_at IS NULL').get(department);
  const body = `<div class="admin-stock-heading"><div><span class="catalog-kicker">${require('../middleware/views').esc(department)}</span><h1>Dashboard</h1></div><span class="catalog-count">Department overview</span></div>
    ${stats([['Pending requests',pending,true],['Copies on loan',onLoan],['Overdue copies',overdue],['Active items',inventory.items]])}`;
  res.send(req.app.locals.page(req, 'Dashboard', body));
});
module.exports = router;
