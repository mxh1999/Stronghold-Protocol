// Optional persistence backend. Install before importing preference consumers.
// Without an extension, preferences stay in the browser and file transfers remain available.
let backend = null;
export function setPreferenceStorage(storage) { backend = storage; }
export function preferenceStorage() {
  try { return backend || globalThis.localStorage; } catch { return null; }
}
export function hasRemotePreferences() { return backend !== null; }
