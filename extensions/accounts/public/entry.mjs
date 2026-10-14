import { prepare } from './client.mjs';
try {
  await prepare();
  await import('/js/main.js');
} catch (error) {
  console.error('[accounts] boot failed', error);
  // Reuse the upstream boot failure UI; never run with partially hydrated preferences.
  globalThis.__spBootFail?.('load');
}
