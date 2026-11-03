const path = require('path');
const fs = require('fs');
const db = require('../middleware/db');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset borrower data in production.');
  if (!process.argv.includes('--confirm-delete-borrowers')) {
    throw new Error('No data was changed. Re-run with --confirm-delete-borrowers only after reviewing the backup and demo-account instructions.');
  }
  const demoEmail = String(process.env.DEMO_BORROWER_EMAIL || '').trim().toLowerCase();
  if (!/^[^\s@]+@my\.cspc\.edu\.ph$/.test(demoEmail)) throw new Error('Set DEMO_BORROWER_EMAIL to the CSPC email of the single borrower to preserve.');
  const demo = db.prepare("SELECT id,email,role FROM users WHERE email=? COLLATE NOCASE AND role='borrower'").get(demoEmail);
  if (!demo) throw new Error('The selected demo borrower was not found. Create/select the demo borrower first; no borrower data was changed.');

  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `borrowing-before-borrower-reset-${safeTimestamp}.db`);
  await db.backup(backupPath);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size < 100) throw new Error('Database backup verification failed; borrower data was not changed.');

  const adminCountBefore = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
  const deleteBorrowers = db.transaction(() => {
    const deletedUsers = db.prepare("SELECT id,email FROM users WHERE role='borrower' AND id<>?").all(demo.id);
    const deleted = deletedUsers.map(row => row.id);
    const removeRequests = db.prepare('DELETE FROM borrow_requests WHERE user_id=?');
    for (const userId of deleted) removeRequests.run(userId);
    if (deleted.length) {
      const marks = deleted.map(() => '?').join(',');
      const linkedMessages = `SELECT id FROM chat_messages WHERE borrower_id IN (${marks}) OR sender_id IN (${marks})`;
      db.prepare(`DELETE FROM chat_message_equipment WHERE message_id IN (${linkedMessages})`).run(...deleted, ...deleted);
      db.prepare(`DELETE FROM chat_messages WHERE borrower_id IN (${marks}) OR sender_id IN (${marks})`).run(...deleted, ...deleted);
      const emailMarks=deletedUsers.map(()=>'?').join(',');
      db.prepare(`DELETE FROM verification_email_sends WHERE email IN (${emailMarks})`).run(...deletedUsers.map(row=>row.email));
      db.prepare(`DELETE FROM login_attempts WHERE email IN (${emailMarks})`).run(...deletedUsers.map(row=>row.email));
      db.prepare(`DELETE FROM users WHERE role='borrower' AND id IN (${marks})`).run(...deleted);
    }
    db.prepare('DELETE FROM pending_registrations').run();
    db.prepare('UPDATE users SET email_verified=1 WHERE id=? AND role=\'borrower\'').run(demo.id);
    const adminsAfter = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
    if (adminsAfter !== adminCountBefore) throw new Error('Admin account count changed unexpectedly; transaction aborted.');
    return deleted.length;
  });
  const deletedCount = deleteBorrowers();
  console.log(`Borrower reset complete. Removed ${deletedCount} borrower account(s) and their linked requests/chat. Preserved verified demo borrower: ${demo.email}.`);
  console.log(`Backup created before deletion: ${backupPath}`);
}

main().catch(error => {
  console.error(`Borrower reset stopped: ${error.message}`);
  process.exitCode = 1;
}).finally(() => db.close());
