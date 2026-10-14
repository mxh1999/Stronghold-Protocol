// Plain JSON using the original browser preference values, including the existing statistics envelope.
import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_SAVE_BYTES = 8 * 1024 * 1024;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export function validData(data) {
  if (!object(data) || Object.keys(data).length > 128) return false;
  if (Object.keys(data).some((key) => key !== 'sp.name' && !/^sp\.pref\.[A-Za-z0-9_.-]{1,100}$/.test(key))) return false;
  if ('sp.name' in data && typeof data['sp.name'] !== 'string') return false;
  const pending = [[data, 0]];
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (depth > 64) return false;
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      pending.push([child, depth + 1]);
    }
  }
  return Buffer.byteLength(JSON.stringify(data)) <= MAX_SAVE_BYTES;
}

export function atomicJson(filename, value) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temp = `${filename}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, filename);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch { /* an interrupted temporary file is never used as a save */ }
  }
}

export function openSaves(directory) {
  const filename = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid account ID');
    return path.join(directory, `${id}.json`);
  };
  function read(id) {
    let raw;
    try { raw = readFileSync(filename(id), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return { revision: 0, data: null }; throw e; }
    const save = JSON.parse(raw);
    if (save.v !== 1 || !Number.isSafeInteger(save.revision) || save.revision < 1 || !validData(save.data)) {
      throw new Error('Invalid or newer save file; refusing to overwrite');
    }
    return { revision: save.revision, data: save.data };
  }
  return {
    directory, read,
    write(id, revision, data) {
      if (!validData(data)) throw new Error('Invalid save data');
      if (revision !== read(id).revision) return null;
      const result = { revision: revision + 1, data };
      // Compare and replace synchronously in the single server process; a crash never leaves partial JSON.
      atomicJson(filename(id), { v: 1, ...result });
      return result;
    },
  };
}
