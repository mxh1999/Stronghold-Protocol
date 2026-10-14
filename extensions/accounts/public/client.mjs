import { setPreferenceStorage } from '/js/preferences.js';
import { t } from '/shared/i18n.js';
import { api } from './api.mjs';
import { readLocal, createStorage } from './storage.mjs';
import { createSync } from './sync.mjs';
import { mountControls, announceAuth } from './ui.mjs';

export async function prepare() {
  const { user, registration } = await api('session');
  let sync, controls, draftKey, backend;
  let leaving = false;
  if (user) {
    let initial = await api('save');
    if (initial.userId !== user.id) throw new Error('Account changed during boot');
    // First login seeds the original local preferences; subsequent logins always load server data.
    if (initial.data === null) {
      let data = {};
      try { data = readLocal(localStorage); } catch { /* unavailable local storage: use game defaults */ }
      try {
        const saved = await api('save', { method: 'PUT', body: { userId: user.id, revision: 0, data } });
        initial = { ...saved, data };
      } catch (e) { if (e.status !== 409) throw e; initial = await api('save'); }
      if (initial.userId && initial.userId !== user.id) throw new Error('Account changed during boot');
    }
    draftKey = `sp.account.draft.${user.id}`;
    let draft;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); } catch { /* unavailable or damaged draft */ }
    let restored = initial.data;
    if (draft && Number.isSafeInteger(draft.revision) && draft.data && typeof draft.data === 'object') {
      if (JSON.stringify(draft.data) !== JSON.stringify(initial.data)) {
        restored = draft.data;
        initial.revision = draft.revision;
      } else { try { sessionStorage.removeItem(draftKey); } catch { /* unavailable */ } }
    }
    backend = createStorage(restored, () => sync?.changed());
    setPreferenceStorage(backend);
    sync = createSync({ initial, read: backend.snapshot,
      save: (value) => api('save', { method: 'PUT', body: { ...value, userId: user.id } }),
      status(state) {
        controls?.status(state);
        try {
          if (state === 'saved') sessionStorage.removeItem(draftKey);
          else sessionStorage.setItem(draftKey, JSON.stringify({ revision: sync.revision(), data: backend.snapshot() }));
        } catch { /* navigation guard still protects unsaved changes */ }
      },
    });
  }
  // A login change must not append another account's in-progress match to this account's statistics.
  const { identity } = await import('/js/net.js');
  try {
    const owner = user?.id || 'guest';
    const localOwner = localStorage.getItem('sp.account.owner');
    if ((localOwner && localOwner !== owner) || (!localOwner && user)) {
      localStorage.removeItem('sp.tokens'); localStorage.removeItem('sp.matches');
    }
    const tabOwner = sessionStorage.getItem('sp.account.owner');
    if ((tabOwner && tabOwner !== owner) || (!tabOwner && user)) {
      identity.clearToken(); identity.setEntered(false);
    }
    localStorage.setItem('sp.account.owner', owner); sessionStorage.setItem('sp.account.owner', owner);
  } catch { /* private browsing can disable session storage */ }
  // Language/settings modules can now read the selected backend safely.
  const { initLang } = await import('/js/ui/lang.js');
  await initLang();
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/_account/style.css';
  document.head.append(stylesheet);
  const reload = () => {
    if (sync?.dirty() && !confirm(t('重新加载会放弃本页未保存的修改，是否继续？'))) return;
    if (draftKey) { try { sessionStorage.removeItem(draftKey); } catch { /* unavailable */ } }
    leaving = true; location.reload();
  };
  controls = mountControls({ user, registration, reload,
    logout: async () => {
      if (sync && !await sync.flush()) return;
      try {
        await api('logout', { method: 'POST', body: { userId: user.id } });
        leaving = true; sync?.dispose(); announceAuth(); location.reload();
      } catch { controls.status('blocked'); }
    },
  });
  if (sync) { controls.status('saved'); sync.changed(); }
  addEventListener('beforeunload', (event) => {
    if (!leaving && sync?.dirty()) { event.preventDefault(); event.returnValue = ''; }
  });
  addEventListener('online', () => { void sync?.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void sync?.flush(); });
  let checking = false;
  const check = async () => {
    if (checking || leaving) return;
    checking = true;
    try {
      if ((await api('session')).user?.id !== user?.id) { sync?.dispose(); controls.expired(); }
    } catch { /* transient network failures must not switch to guest storage */ }
    finally { checking = false; }
  };
  addEventListener('storage', (event) => { if (event.key === 'sp.account.changed') void check(); });
  addEventListener('focus', () => { void check(); });
  setInterval(() => { void check(); }, 30000);
}
