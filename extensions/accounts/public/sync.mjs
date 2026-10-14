// Debounced snapshot saves. Never overwrite a newer device's revision silently.
export function createSync({ initial, read, save, status = () => {}, delay = 600, timers = globalThis }) {
  let revision = initial.revision;
  let saved = JSON.stringify(initial.data);
  let timer, inFlight, blocked = false, disposed = false, blockedState;
  const dirty = () => JSON.stringify(read()) !== saved;
  const schedule = (ms) => {
    timers.clearTimeout(timer);
    if (!disposed && !blocked) timer = timers.setTimeout(() => { void flush(); }, ms);
  };
  function flush() {
    if (inFlight) return inFlight;
    if (disposed || blocked || !dirty()) return Promise.resolve(!dirty());
    timers.clearTimeout(timer);
    inFlight = (async () => {
      while (!disposed && !blocked && dirty()) {
        const data = read(); status('saving');
        try {
          const result = await save({ revision, data });
          revision = result.revision; saved = JSON.stringify(data);
        } catch (e) {
          if ([400, 401, 403, 409, 413].includes(e.status)) {
            blocked = true; blockedState = e.status === 409 ? 'conflict' : 'blocked'; status(blockedState);
          } else { status('retry'); schedule(3000); }
          return false;
        }
      }
      if (!disposed) status('saved');
      return !dirty();
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    dirty, flush, revision: () => revision,
    changed() { if (dirty()) { if (!blocked && !disposed) { status('pending'); schedule(delay); } else status(blockedState || 'blocked'); } },
    dispose() { disposed = true; timers.clearTimeout(timer); },
  };
}
