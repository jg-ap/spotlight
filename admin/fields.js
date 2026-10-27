// Builds editor forms from the section schema served by /api/schema.
import { h } from './ui.js';
import { openLibrary } from './media.js';

const optVal = o => (typeof o === 'string' ? o : o.value);
const optLabel = o => (typeof o === 'string' ? o : o.label);
const visible = (f, obj) => !f.showIf || Object.entries(f.showIf).every(([k, v]) => (Array.isArray(v) ? v.includes(obj[k]) : obj[k] === v));
let uid = 0;

export function blank(fields) {
  const o = {};
  for (const f of fields) {
    o[f.key] = f.type === 'list' || f.type === 'strings' ? [] : f.type === 'toggle' ? false : f.type === 'number' ? (f.min ?? 0) : f.type === 'select' ? optVal(f.options[0]) : '';
  }
  return o;
}

// ctx = { sid, change(), restructure(), open:Set, mediaOpts }
export function renderFields(fields, obj, ctx, path = '') {
  return fields.filter(f => visible(f, obj)).map(f => field(f, fields, obj, ctx, path));
}

function wrap(f, control, id) {
  return h('div', { class: 'field' }, h('label', { for: id }, f.label), control, f.hint ? h('p', { class: 'hint' }, f.hint) : null);
}

function field(f, siblings, obj, ctx, path) {
  const id = `f${++uid}`;
  const set = v => { obj[f.key] = v; ctx.change(); };
  switch (f.type) {
    case 'text': return wrap(f, h('input', { id, type: 'text', value: obj[f.key] ?? '', oninput: e => set(e.target.value) }), id);
    case 'url': return wrap(f, h('input', { id, type: 'text', inputmode: 'url', placeholder: 'https://… or #section', value: obj[f.key] ?? '', oninput: e => set(e.target.value) }), id);
    case 'textarea': case 'markdown':
      return wrap(f, h('textarea', { id, rows: f.rows || 3, value: obj[f.key] ?? '', oninput: e => set(e.target.value) }), id);
    case 'number': return wrap(f, h('input', { id, type: 'number', min: f.min, max: f.max, value: obj[f.key] ?? 0, oninput: e => set(e.target.value === '' ? 0 : Number(e.target.value)) }), id);
    case 'select': {
      const dependents = siblings.some(x => x.showIf && f.key in x.showIf);
      return wrap(f, h('select', { id, onchange: e => { set(e.target.value); if (dependents) ctx.restructure(); } },
        f.options.map(o => h('option', { value: optVal(o), selected: obj[f.key] === optVal(o) }, optLabel(o)))), id);
    }
    case 'toggle':
      return h('div', { class: 'field' }, h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!obj[f.key], onchange: e => set(e.target.checked) }), h('span', { class: 'slider' }), h('span', {}, f.label)));
    case 'image': case 'video': return mediaField(f, obj, ctx, id);
    case 'strings': return stringsField(f, obj, ctx);
    case 'list': return listField(f, obj, ctx, path);
    default: return h('div');
  }
}

export function mediaField(f, obj, ctx, id = `f${++uid}`) {
  const kind = f.type;
  const thumb = h('div', { class: 'thumb' });
  const input = h('input', { id, type: 'text', placeholder: 'Choose a file or paste a link', value: obj[f.key] ?? '', oninput: e => { obj[f.key] = e.target.value; refresh(); ctx.change(); } });
  const refresh = () => {
    const v = obj[f.key];
    thumb.replaceChildren(v ? (kind === 'image' ? h('img', { src: v, alt: '' }) : h('video', { src: v + '#t=0.5', preload: 'metadata', muted: true })) : h('span', {}, kind === 'image' ? '▣' : '▶'));
  };
  refresh();
  const choose = async () => {
    const url = await openLibrary({ kind, pick: true, ...ctx.mediaOpts });
    if (url) { obj[f.key] = url; input.value = url; refresh(); ctx.change(); }
  };
  const remove = () => { obj[f.key] = ''; input.value = ''; refresh(); ctx.change(); };
  return h('div', { class: 'field' }, h('label', { for: id }, f.label),
    h('div', { class: 'mediafield' }, thumb, h('div', { class: 'mf-main' }, input,
      h('div', { class: 'mf-btns' }, h('button', { class: 'btn sm', type: 'button', onclick: choose }, obj[f.key] ? 'Change…' : 'Choose / upload…'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: remove }, 'Remove')))),
    f.hint ? h('p', { class: 'hint' }, f.hint) : null);
}

function stringsField(f, obj, ctx) {
  const arr = obj[f.key] ||= [];
  const box = h('div', { class: 'strings' });
  const draw = (focusLast) => {
    box.replaceChildren(...arr.map((v, i) => h('div', { class: 'srow' },
      h('input', { type: 'text', value: v, 'aria-label': `${f.label} ${i + 1}`, oninput: e => { arr[i] = e.target.value; ctx.change(); },
        onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); arr.splice(i + 1, 0, ''); ctx.change(); draw(i + 1); }
          else if (e.key === 'Backspace' && !arr[i] && arr.length > 1) { e.preventDefault(); arr.splice(i, 1); ctx.change(); draw(Math.max(0, i - 1)); } } }),
      h('button', { class: 'ib', type: 'button', title: 'Move up', disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; ctx.change(); draw(); } }, '↑'),
      h('button', { class: 'ib', type: 'button', title: 'Move down', disabled: i === arr.length - 1, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; ctx.change(); draw(); } }, '↓'),
      h('button', { class: 'ib', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => { arr.splice(i, 1); ctx.change(); draw(); } }, '✕'))),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { arr.push(''); ctx.change(); draw(arr.length - 1); } }, '+ Add'));
    if (focusLast != null) box.querySelectorAll('.srow input')[focusLast]?.focus();
  };
  draw();
  return h('div', { class: 'field' }, h('label', {}, f.label), box);
}

function listField(f, obj, ctx, path) {
  const arr = obj[f.key] ||= [];
  const box = h('div', { class: 'list' });
  const labelOf = (item, i) => (f.itemLabel && String(item[f.itemLabel] ?? '').trim()) || `${f.label.replace(/s$/i, '')} ${i + 1}`;
  const draw = () => {
    box.replaceChildren(...arr.map((item, i) => {
      const key = `${ctx.sid}|${path}${f.key}.${i}`;
      const title = h('span', { class: 'ltitle' }, labelOf(item, i));
      const act = (txt, tip, fn, dis) => h('button', { class: 'ib', type: 'button', title: tip, 'aria-label': tip, disabled: dis, onclick: e => { e.preventDefault(); e.stopPropagation(); fn(); } }, txt);
      const d = h('details', { class: 'litem', open: ctx.open.has(key), ontoggle: e => { e.target.open ? ctx.open.add(key) : ctx.open.delete(key); } },
        h('summary', {}, h('span', { class: 'caret' }), title, h('span', { class: 'lacts' },
          act('↑', 'Move up', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; ctx.change(); draw(); }, i === 0),
          act('↓', 'Move down', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; ctx.change(); draw(); }, i === arr.length - 1),
          act('⧉', 'Duplicate', () => { if (!f.max || arr.length < f.max) { arr.splice(i + 1, 0, structuredClone(item)); ctx.change(); draw(); } }, f.max && arr.length >= f.max),
          act('✕', 'Delete', () => { arr.splice(i, 1); ctx.change(); draw(); }))),
        h('div', { class: 'lbody' }, renderFields(f.fields, item, { ...ctx, restructure: draw }, `${path}${f.key}.${i}.`)));
      d.addEventListener('input', () => { title.textContent = labelOf(item, i); });
      return d;
    }), f.max && arr.length >= f.max ? h('p', { class: 'hint' }, `Up to ${f.max} items.`)
      : h('button', { class: 'btn sm', type: 'button', onclick: () => { arr.push(blank(f.fields)); ctx.open.add(`${ctx.sid}|${path}${f.key}.${arr.length - 1}`); ctx.change(); draw(); } }, `+ Add ${f.label.replace(/s$/i, '').toLowerCase()}`));
  };
  draw();
  return h('div', { class: 'field' }, h('label', {}, f.label), box);
}
