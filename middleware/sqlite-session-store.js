const session = require('express-session');

class SQLiteSessionStore extends session.Store {
  constructor(db, { ttlMs = 8 * 60 * 60 * 1000, cleanupMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    this.getRow = db.prepare('SELECT data, expires_at FROM app_sessions WHERE sid = ?');
    this.upsert = db.prepare(`INSERT INTO app_sessions (sid, data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at`);
    this.remove = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
    this.touchRow = db.prepare('UPDATE app_sessions SET expires_at = ? WHERE sid = ?');
    this.prune = db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?');
    this.timer = setInterval(() => {
      try { this.prune.run(Date.now()); } catch (error) { console.error('Session cleanup failed:', error.message); }
    }, cleanupMs);
    this.timer.unref?.();
  }

  get(sid, callback) {
    try {
      const row = this.getRow.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.remove.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) { return callback(error); }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const cookieExpiry = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : 0;
      const maxAgeExpiry = Number.isFinite(sess?.cookie?.maxAge) ? Date.now() + sess.cookie.maxAge : 0;
      const expiresAt = Math.max(cookieExpiry, maxAgeExpiry, Date.now() + this.ttlMs);
      this.upsert.run(sid, JSON.stringify(sess), expiresAt);
      callback(null);
    } catch (error) { callback(error); }
  }

  touch(sid, sess, callback = () => {}) {
    try {
      const cookieExpiry = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : 0;
      const maxAgeExpiry = Number.isFinite(sess?.cookie?.maxAge) ? Date.now() + sess.cookie.maxAge : 0;
      this.touchRow.run(Math.max(cookieExpiry, maxAgeExpiry, Date.now() + this.ttlMs), sid);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { this.remove.run(sid); callback(null); } catch (error) { callback(error); }
  }

  clear(callback = () => {}) {
    try { this.db.prepare('DELETE FROM app_sessions').run(); callback(null); } catch (error) { callback(error); }
  }

  length(callback) {
    try { callback(null, this.db.prepare('SELECT COUNT(*) AS count FROM app_sessions WHERE expires_at > ?').get(Date.now()).count); }
    catch (error) { callback(error); }
  }
}

module.exports = SQLiteSessionStore;
