import { t, onLangChange } from '/shared/i18n.js';
import { api } from './api.mjs';
const el = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
export function mountControls({ user, registration, logout, reload }) {
  const bar = el('aside'); bar.className = 'account-controls'; bar.dataset.testid = 'account-controls';
  const status = el('span'); status.setAttribute('role', 'status');
  const refresh = el('button', t('重新加载')); refresh.type = 'button'; refresh.hidden = true;
  let lastState = 'saved', action;
  refresh.onclick = reload;
  const stateText = (state) => ({ saved: t('已自动保存到服务器'), pending: t('等待自动保存'), saving: t('正在保存'),
    retry: t('保存失败，正在重试'), conflict: t('其他页面更新了存档，请重新加载'), blocked: t('自动保存已停止，请重新登录') })[state];
  if (user) {
    const label = el('span', user.username); label.className = 'account-name';
    const out = el('button', t('退出登录')); out.type = 'button'; out.dataset.testid = 'account-logout';
    action = out;
    out.onclick = async () => { out.disabled = true; try { await logout(); } finally { out.disabled = false; } };
    bar.append(label, status, refresh, out);
  } else {
    const login = el('button', t('登录')); login.type = 'button'; login.dataset.testid = 'account-login';
    action = login;
    login.onclick = () => showLogin(registration); bar.append(login);
  }
  document.body.append(bar);
  onLangChange(() => {
    refresh.textContent = t('重新加载'); action.textContent = user ? t('退出登录') : t('登录');
    if (user) status.textContent = stateText(lastState);
  });
  return {
    status(state) { lastState = state; status.textContent = stateText(state); refresh.hidden = !['conflict', 'blocked'].includes(state); },
    expired() {
      if (document.querySelector('.account-expired')) return;
      const dialog = el('dialog'); dialog.className = 'account-dialog account-expired';
      dialog.append(el('p', t('账户已切换或登录已过期，请重新加载页面')));
      const button = el('button', t('重新加载')); button.onclick = reload; dialog.append(button);
      dialog.addEventListener('cancel', (event) => event.preventDefault());
      document.body.append(dialog); dialog.showModal();
    },
  };
}
function showLogin(registration) {
  const dialog = el('dialog'); dialog.className = 'account-dialog';
  const close = el('button', t('关闭')); close.type = 'button'; close.className = 'account-close'; close.onclick = () => dialog.close();
  dialog.append(close, el('h2', t('登录')),
    el('p', t('登录后自动保存全部配置和战绩。首次登录会保存当前本机数据，已有云存档则载入云存档。')));
  const form = el('form');
  const field = (text, type, name) => {
    const label = el('label', text); const input = el('input');
    Object.assign(input, { type, name, required: true, autocomplete: type === 'password' ? 'current-password' : 'username' });
    if (type === 'password') { input.minLength = 10; input.maxLength = 128; }
    else { input.pattern = '[A-Za-z0-9_]{3,24}'; input.maxLength = 24; }
    label.append(input); form.append(label); return input;
  };
  const username = field(t('用户名'), 'text', 'username');
  const password = field(t('密码'), 'password', 'password');
  form.append(el('small', t('用户名为3至24位字母、数字或下划线，密码为10至128个字符')));
  const login = el('button', t('登录')); login.type = 'submit';
  const register = el('button', t('注册')); register.type = 'submit'; register.value = 'register';
  form.append(login); if (registration) form.append(register);
  const notice = el('p'); notice.setAttribute('role', 'status'); form.append(notice);
  form.onsubmit = async (event) => {
    event.preventDefault(); login.disabled = register.disabled = true;
    try {
      await api(event.submitter?.value === 'register' ? 'register' : 'login', {
        method: 'POST', body: { username: username.value, password: password.value },
      });
      password.value = ''; announceAuth(); location.reload();
    } catch (e) {
      const errors = { INVALID_CREDENTIALS: t('用户名或密码错误'), USERNAME_TAKEN: t('用户名已被使用'),
        RATE: t('操作过于频繁，请稍后重试'), REGISTRATION_CLOSED: t('服务器已关闭注册'),
        CREDENTIAL_FORMAT: t('用户名为3至24位字母、数字或下划线，密码为10至128个字符') };
      notice.textContent = errors[e.message] || t('请求失败，请稍后重试');
    } finally { login.disabled = register.disabled = false; }
  };
  dialog.append(form, el('small', t('忘记密码请联系服务器管理员')));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog); dialog.showModal(); username.focus();
}
export function announceAuth() {
  try { localStorage.setItem('sp.account.changed', String(Date.now())); } catch { /* focus check also detects changes */ }
}
