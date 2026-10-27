import { h, api, UI, toast } from './ui.js';
import { mountPages } from './pages.js';
import { mountEditor } from './editor.js';

const root = document.getElementById('app');
let schema, cleanup = null, current = '';

function loginView(msg) {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Admin password', onkeydown: e => { if (e.key === 'Enter') go(); } });
  const err = h('p', { class: 'err', role: 'alert' }, msg || '');
  const go = async () => {
    try { await api('POST', '/api/login', { password: pw.value }); await boot(); }
    catch (e) { err.textContent = e.message; pw.select(); }
  };
  root.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'lcard' },
    h('div', { class: 'logo' }, h('span', { class: 'dot' }), 'Spotlight Studio'), h('p', { class: 'hint' }, 'Sign in to edit product pages.'),
    h('div', { class: 'field' }, h('label', {}, 'Admin password'), pw), err,
    h('button', { class: 'btn primary wide', type: 'button', onclick: go }, 'Sign in'))));
  pw.focus();
}

async function signOut() { try { await api('POST', '/api/logout'); } catch { /* already out */ } cleanup?.(); loginView(); }
UI.onUnauthed = () => { toast('Your session ended. Sign in again, then retry.', 'err'); };

export function navigate(hash, force) {
  if (location.hash === hash && !force) return route();
  if (location.hash === hash) return route(); // forced reload of same route
  location.hash = hash;
}

async function route() {
  cleanup?.(); cleanup = null;
  const m = /^#\/edit\/([a-f0-9]+)/.exec(location.hash);
  try {
    if (m) { document.title = 'Editing · Spotlight Studio'; cleanup = await mountEditor(root, m[1], schema, navigate); }
    else { document.title = 'Spotlight Studio'; await mountPages(root, schema, navigate, signOut); }
  } catch (e) {
    if (e.status === 401) return loginView();
    root.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'lcard' }, h('h2', {}, e.status === 404 ? 'Page not found' : 'Something went wrong'), h('p', { class: 'hint' }, e.message), h('a', { class: 'btn', href: '#/' }, '← All pages'))));
  }
}

async function boot() {
  const me = await api('GET', '/api/me');
  if (!me.admin) return loginView();
  schema = await api('GET', '/api/schema');
  route();
}
window.addEventListener('hashchange', route);
boot().catch(e => loginView(e.message));
