// Tiny DOM + dialog helpers shared by the admin screens.
const PROPS = new Set(['value', 'checked', 'disabled', 'muted', 'selected', 'hidden', 'open', 'draggable', 'tabIndex', 'readOnly', 'multiple']);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => { if (Array.isArray(k)) k.forEach(add); else if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return el;
}

export const UI = { onUnauthed: null };

export async function api(method, url, body, { raw } = {}) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'x-spotlight': '1', ...(body && !raw ? { 'content-type': 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error(data?.error || res.statusText || 'Request failed');
    e.status = res.status; e.data = data;
    if (res.status === 401 && !url.endsWith('/login')) UI.onUnauthed?.();
    throw e;
  }
  return data;
}

// Upload with progress (fetch can't report upload progress).
export function upload(files, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/media');
    x.setRequestHeader('x-spotlight', '1');
    x.upload.onprogress = e => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let data = {}; try { data = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status === 401) UI.onUnauthed?.();
      x.status >= 200 && x.status < 300 ? resolve(data) : reject(Object.assign(new Error(data.error || data.errors?.join('\n') || 'Upload failed'), { data }));
    };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(fd);
  });
}

export function toast(msg, kind = 'ok') {
  const t = h('div', { class: `toast ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('out'), kind === 'err' ? 6000 : 2800);
  setTimeout(() => t.remove(), kind === 'err' ? 6400 : 3200);
}

export function modal({ title, body, footer, wide, onClose }) {
  const prev = document.activeElement;
  const close = v => { document.removeEventListener('keydown', onKey); back.remove(); prev?.focus?.(); onClose?.(v); };
  const onKey = e => { if (e.key === 'Escape' && back === [...document.querySelectorAll('.backdrop')].pop()) close(); };
  const dlg = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'x', type: 'button', 'aria-label': 'Close', onclick: () => close() }, '✕')),
    h('div', { class: 'mbody' }, body), footer ? h('footer', {}, footer) : null);
  const back = h('div', { class: 'backdrop', onmousedown: e => { if (e.target === back) close(); } }, dlg);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  (dlg.querySelector('input,textarea,select') || dlg.querySelector('button:not(.x)') || dlg).focus?.();
  return { el: dlg, close };
}

export const confirmDialog = (message, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) => new Promise(resolve => {
  let done = false;
  const finish = v => { if (!done) { done = true; resolve(v); } };
  const m = modal({ title, body: h('p', { class: 'msg' }, message), onClose: () => finish(false),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => { finish(true); m.close(); } }, ok)] });
});

export const promptDialog = (title, { label, value = '', ok = 'Save', placeholder = '' } = {}) => new Promise(resolve => {
  let done = false;
  const finish = v => { if (!done) { done = true; resolve(v); } };
  const input = h('input', { type: 'text', value, placeholder, onkeydown: e => { if (e.key === 'Enter') go(); } });
  const go = () => { const v = input.value.trim(); if (v) { finish(v); m.close(); } };
  const m = modal({ title, body: h('div', { class: 'field' }, h('label', {}, label), input), onClose: () => finish(null),
    footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: go }, ok)] });
  input.select();
});

export const fmtSize = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
export const fmtTime = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
