// Local password reset. Credentials are never accepted in argv or written to logs.
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import path from 'node:path';
import { defaultDataDir } from './start.mjs';
import { openAccounts } from './server/accounts.mjs';
import { validPassword, hashPassword } from './server/auth.mjs';

let accounts;
try {
  const [command, name] = process.argv.slice(2);
  if (command !== 'reset-password' || !name) throw new Error('Usage: node extensions/accounts/admin.mjs reset-password USERNAME');
  const filename = path.join(defaultDataDir(), 'accounts.sqlite');
  if (!existsSync(filename)) throw new Error('Account database not found; check SP_ACCOUNT_DATA');
  accounts = await openAccounts(filename);
  const user = accounts.findUser(name);
  if (!user) throw new Error('User not found');
  let password;
  if (process.stdin.isTTY) {
    const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    process.stdout.write('New password (hidden, 10-128 characters): ');
    try { password = await rl.question(''); } finally { rl.close(); process.stdout.write('\n'); }
  } else password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (!validPassword(password)) throw new Error('Password must have 10-128 characters');
  accounts.setPassword(user.id, await hashPassword(password));
  console.log('Password reset; login sessions revoked.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { accounts?.close(); }
