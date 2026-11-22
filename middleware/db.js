const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database(path.join(__dirname, '..', 'borrowing.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const initialDepartments = require('./departments');
db.exec(`CREATE TABLE IF NOT EXISTS departments (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
const insertDepartment = db.prepare('INSERT OR IGNORE INTO departments (name) VALUES (?)');
for (const name of initialDepartments) insertDepartment.run(name);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'borrower' CHECK (role IN ('borrower','admin')),
  department TEXT NOT NULL DEFAULT 'College of Computer Studies',
  admin_scope TEXT NOT NULL DEFAULT 'system' CHECK (admin_scope IN ('system','department'))
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  condition TEXT NOT NULL DEFAULT 'Good',
  department TEXT NOT NULL DEFAULT 'College of Computer Studies'
);
CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS borrow_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  borrow_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','returned','cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  borrower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('borrower', 'admin')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS chat_messages_borrower_id_id_idx ON chat_messages (borrower_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_unread_idx ON chat_messages (borrower_id, sender_role, read_at);
CREATE TABLE IF NOT EXISTS chat_message_equipment (
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, equipment_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES borrow_requests(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications (user_id, read_at, id DESC);
CREATE TABLE IF NOT EXISTS pending_registrations (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  department TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  token_hash TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL,
  last_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_email_sends (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_sends_email_time_idx ON verification_email_sends (email, sent_at);
CREATE INDEX IF NOT EXISTS verification_sends_ip_time_idx ON verification_email_sends (ip, sent_at);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  request_ip TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx ON password_reset_tokens (expires_at);
CREATE TABLE IF NOT EXISTS admin_password_reset_tokens (
  id INTEGER PRIMARY KEY,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  request_ip TEXT NOT NULL,
  verification_email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_password_reset_tokens_target_idx ON admin_password_reset_tokens (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_password_reset_tokens_expiry_idx ON admin_password_reset_tokens (expires_at);
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL,
  requested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_requests_email_time_idx ON password_reset_requests (email, requested_at);
CREATE INDEX IF NOT EXISTS password_reset_requests_ip_time_idx ON password_reset_requests (ip, requested_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx ON login_attempts (email, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_time_idx ON login_attempts (ip, attempted_at);
CREATE TABLE IF NOT EXISTS app_sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

function addColumn(table, column, definition) {
  if (!db.pragma(`table_info(${table})`).some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  }
  return false;
}
addColumn('users', 'department', "TEXT NOT NULL DEFAULT 'College of Computer Studies'");
addColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'google_sub', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'avatar_url', "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub <> \'\'');
addColumn('pending_registrations', 'token_hash', 'TEXT');
const emailLinkMigration = '20261028_email_verification_links';
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(emailLinkMigration)) {
  db.prepare('DELETE FROM pending_registrations').run();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(emailLinkMigration);
}
addColumn('equipment', 'department', "TEXT NOT NULL DEFAULT 'College of Computer Studies'");
addColumn('equipment', 'image_url', "TEXT NOT NULL DEFAULT ''");
addColumn('equipment', 'archived_at', 'TEXT');
addColumn('borrow_requests', 'quantity', 'INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1)');
addColumn('borrow_requests', 'rejection_reason', 'TEXT NOT NULL DEFAULT \'\'');
if (!db.pragma('table_info(users)').some(item => item.name === 'admin_scope')) {
  db.exec("ALTER TABLE users ADD COLUMN admin_scope TEXT NOT NULL DEFAULT 'system' CHECK (admin_scope IN ('system','department'))");
}
const forcedPasswordMigration='20261028_force_department_admin_password_change';
if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(forcedPasswordMigration)){
  db.prepare("UPDATE users SET must_change_password=1 WHERE role='admin' AND admin_scope='department'").run();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(forcedPasswordMigration);
}
db.exec(`UPDATE users SET department = 'College of Computer Studies' WHERE department IS NULL OR trim(department) = '';
UPDATE equipment SET department = 'College of Computer Studies' WHERE department IS NULL OR trim(department) = '';
UPDATE users SET email_verified = 1 WHERE role='admin';
CREATE INDEX IF NOT EXISTS equipment_department_active_idx ON equipment (department, archived_at, name);
CREATE INDEX IF NOT EXISTS users_department_role_idx ON users (department, role);
CREATE INDEX IF NOT EXISTS requests_item_dates_status_idx ON borrow_requests (equipment_id, status, borrow_date, due_date);
INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM equipment WHERE trim(category) <> '';`);
for (const row of db.prepare('SELECT DISTINCT department FROM users UNION SELECT DISTINCT department FROM equipment').all()) {
  if (row.department && row.department.trim()) insertDepartment.run(row.department.trim());
}

// Google sign-in is not part of this project; remove its unused legacy link table.
db.exec('DROP TABLE IF EXISTS google_accounts');

// Existing administrator accounts remain intact. Bootstrap credentials are read only from the environment.
const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
const adminName = String(process.env.ADMIN_NAME || 'CSPC Equipment Administrator').trim();
if (adminEmail || adminPassword) {
  if (!adminEmail) throw new Error('Set ADMIN_EMAIL when providing ADMIN_PASSWORD.');
  if (!/^[^\s@]+@my\.cspc\.edu\.ph$/.test(adminEmail)) throw new Error('ADMIN_EMAIL must be a valid @my.cspc.edu.ph address.');
  const existing = db.prepare('SELECT id,role,admin_scope FROM users WHERE email = ?').get(adminEmail);
  if (existing && (existing.role !== 'admin' || existing.admin_scope !== 'system')) {
    throw new Error('ADMIN_EMAIL is already assigned to a non-system account; choose a different address.');
  }
  if (!existing) {
    if (!adminPassword) throw new Error('Set ADMIN_PASSWORD to create the first system-admin account.');
    const { passwordPolicyError } = require('./password-policy');
    const problem = passwordPolicyError(adminPassword);
    if (problem) throw new Error(`ADMIN_PASSWORD does not meet policy: ${problem}`);
    db.prepare('INSERT INTO users (name,email,password_hash,role,department,admin_scope,email_verified) VALUES (?,?,?,?,?,?,1)')
      .run(adminName || 'CSPC Equipment Administrator', adminEmail, bcrypt.hashSync(adminPassword, 12), 'admin', initialDepartments[0], 'system');
  }
}

if (!db.prepare('SELECT 1 FROM equipment LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO equipment (name,category,quantity,condition,department) VALUES (?,?,?,?,?)');
  [['Chair', 'Media', 3, 'Good'], ['Projector', 'Presentation', 2, 'Good'],
   ['Extension Cord', 'Electrical', 10, 'Fair'], ['Laptop', 'Computing', 5, 'Good']]
    .forEach(row => ins.run(...row, initialDepartments[1] || initialDepartments[0]));
  db.exec("INSERT OR IGNORE INTO categories (name) SELECT DISTINCT category FROM equipment WHERE trim(category) <> '';");
}

module.exports = db;
