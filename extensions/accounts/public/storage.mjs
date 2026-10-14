const prefix = 'sp.pref.';
const allowed = (key) => key === 'sp.name' || key.startsWith(prefix);
export function readLocal(storage) {
  const data = {};
  for (let i = 0; i < (storage?.length || 0); i++) {
    const key = storage.key(i);
    if (!allowed(key)) continue;
    const raw = storage.getItem(key);
    try { data[key] = key === 'sp.name' ? raw : JSON.parse(raw); } catch { /* leave damaged local values untouched */ }
  }
  return data;
}
export function createStorage(initial, changed = () => {}) {
  const data = structuredClone(initial);
  return {
    getItem(key) {
      if (!Object.hasOwn(data, key)) return null;
      return key === 'sp.name' ? data[key] : JSON.stringify(data[key]);
    },
    setItem(key, raw) {
      if (!allowed(key)) throw new Error('Non-preference key');
      if (this.getItem(key) === raw) return;
      data[key] = key === 'sp.name' ? raw : JSON.parse(raw);
      changed();
    },
    removeItem(key) { if (Object.hasOwn(data, key)) { delete data[key]; changed(); } },
    snapshot: () => structuredClone(data),
  };
}
