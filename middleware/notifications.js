const db = require('./db');

function notify(userId, type, message, requestId = null) {
  db.prepare('INSERT INTO notifications (user_id, request_id, type, message) VALUES (?, ?, ?, ?)')
    .run(userId, requestId, type, message);
}

function notifyDepartmentAdmins(department, type, message, requestId = null) {
  const admins = db.prepare("SELECT id FROM users WHERE role='admin' AND admin_scope='department' AND department=?").all(department);
  for (const admin of admins) notify(admin.id, type, message, requestId);
}

module.exports = { notify, notifyDepartmentAdmins };
