// Only credentials and revocable sessions belong in SQLite. User preferences live in separate JSON files.
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function openAccounts(filename) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Accounts require Node >= 22.13');
  const { DatabaseSync } = await import('node:sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('Newer account database'); }
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    PRAGMA user_version = 1; PRAGMA journal_mode = WAL;`);
  const q = (sql) => db.prepare(sql);
  return {
    close: () => db.close(),
    backup: (destination) => q('VACUUM INTO ?').run(destination),
    createUser(username, hash) {
      const user = { id: randomUUID(), username };
      q('INSERT INTO users VALUES (?, ?, ?, ?)').run(user.id, username, hash, Date.now());
      return user;
    },
    findUser: (name) => q('SELECT * FROM users WHERE username = ?').get(name),
    setPassword(id, hash) {
      db.exec('BEGIN IMMEDIATE');
      try {
        q('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
        q('DELETE FROM sessions WHERE user_id = ?').run(id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    addSession(hash, id, expiresAt) {
      q('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      q('INSERT INTO sessions VALUES (?, ?, ?)').run(hash, id, expiresAt);
      q(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
        (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT 10)`).run(id, id);
    },
    session(hash) {
      return q(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash, Date.now()) || null;
    },
    revoke: (hash) => q('DELETE FROM sessions WHERE token_hash = ?').run(hash),
  };
}
