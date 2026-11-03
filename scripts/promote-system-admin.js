const db = require('../middleware/db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email || !/^[^\s@]+@my\.cspc\.edu\.ph$/.test(email)) {
  console.error('Usage: node scripts/promote-system-admin.js johregino@my.cspc.edu.ph');
  process.exit(1);
}

const user = db.prepare('SELECT id,name,email,role,admin_scope FROM users WHERE email = ?').get(email);
if (!user) {
  console.error(`No account found for ${email}. The user must register first.`);
  process.exit(1);
}

const promote = db.transaction(() => {
  db.prepare(`UPDATE users
    SET role = 'admin', admin_scope = 'system', email_verified = 1, must_change_password = 0
    WHERE id = ?`).run(user.id);

  // Force the promoted account to sign in again so its session receives the new role.
  const sessions = db.prepare('SELECT sid,data FROM app_sessions').all();
  const remove = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const session of sessions) {
    try {
      if (JSON.parse(session.data)?.user?.id === user.id) remove.run(session.sid);
    } catch {
      // Ignore malformed session rows; the normal session cleanup will handle them.
    }
  }
});

promote();
console.log(`Promoted ${user.name} <${user.email}> to system administrator.`);
console.log('The account password was not changed. Sign in again with the existing password.');
