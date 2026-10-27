import { h, api, toast, modal, confirmDialog, promptDialog, fmtTime } from './ui.js';
import { openLibrary } from './media.js';

export async function mountPages(root, schema, navigate, signOut) {
  let pages = [];
  const grid = h('div', { class: 'pgrid' });
  const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const page = JSON.parse(await f.text()); const p = await api('POST', '/api/pages/import', { page }); toast(`Imported “${p.name}”`); navigate(`#/edit/${p.id}`); }
    catch (err) { toast(err.message.includes('JSON') ? 'That file isn’t valid JSON' : err.message, 'err'); }
    e.target.value = '';
  } });

  async function load() { pages = await api('GET', '/api/pages'); draw(); }
  function draw() {
    grid.replaceChildren(...(pages.length ? pages.map(card) : [h('div', { class: 'blank' }, h('h3', {}, 'No pages yet'), h('p', {}, 'Create your first product spotlight from the template.'), h('button', { class: 'btn primary', type: 'button', onclick: newPage }, '+ New page'))]));
  }
  const card = p => h('article', { class: 'pcard' },
    h('div', { class: 'pstripe', style: `--a:${p.accent || '#654F6F'}` }),
    h('div', { class: 'pmain' },
      h('div', { class: 'prow' }, h('h3', {}, h('a', { href: `#/edit/${p.id}` }, p.name)), h('span', { class: `chip ${p.status === 'published' ? 'live' : ''}` }, p.status === 'published' ? 'Published' : 'Draft')),
      h('p', { class: 'hint' }, `/p/${p.slug} · ${p.sectionCount} sections · edited ${fmtTime(p.updatedAt)}`),
      h('div', { class: 'pacts' },
        h('a', { class: 'btn sm primary', href: `#/edit/${p.id}` }, 'Edit'),
        h('a', { class: 'btn sm', href: `/p/${p.slug}`, target: '_blank', rel: 'noopener' }, 'View ↗'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => duplicate(p) }, 'Duplicate for another product'),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => remove(p) }, 'Delete'))));

  async function duplicate(p) {
    const name = await promptDialog('Duplicate page', { label: 'Name of the new product', value: '', placeholder: 'e.g. Orion Planner', ok: 'Duplicate' });
    if (!name) return;
    try { const c = await api('POST', `/api/pages/${p.id}/duplicate`, { name }); toast(`Created “${c.name}” as a draft`); navigate(`#/edit/${c.id}`); } catch (e) { toast(e.message, 'err'); }
  }
  async function remove(p) {
    if (!await confirmDialog(`Delete “${p.name}” and its history? This can’t be undone.`, { ok: 'Delete page', danger: true })) return;
    try { await api('DELETE', `/api/pages/${p.id}`); await load(); toast('Page deleted'); } catch (e) { toast(e.message, 'err'); }
  }
  function newPage() {
    const nameIn = h('input', { type: 'text', placeholder: 'e.g. Acme Insights', onkeydown: e => { if (e.key === 'Enter') go(); } });
    const from = h('select', {}, h('option', { value: '' }, 'The standard template (recommended layout)'), ...pages.map(p => h('option', { value: p.id }, `A copy of “${p.name}”`)));
    const go = async () => {
      const name = nameIn.value.trim(); if (!name) { nameIn.focus(); return; }
      try { const p = from.value ? await api('POST', `/api/pages/${from.value}/duplicate`, { name }) : await api('POST', '/api/pages', { name }); m.close(); navigate(`#/edit/${p.id}`); } catch (e) { toast(e.message, 'err'); }
    };
    const m = modal({ title: 'New product page', body: h('div', {}, h('div', { class: 'field' }, h('label', {}, 'Product name'), nameIn), h('div', { class: 'field' }, h('label', {}, 'Start from'), from)),
      footer: [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Create page')] });
  }

  root.replaceChildren(
    h('header', { class: 'topbar' }, h('div', { class: 'logo' }, h('span', { class: 'dot' }), 'Spotlight Studio'), h('span', { class: 'grow' }),
      h('a', { class: 'btn', href: '/', target: '_blank', rel: 'noopener' }, 'Public index ↗'),
      h('button', { class: 'btn', type: 'button', onclick: () => openLibrary({ kind: 'all', maxMb: schema.maxUploadMb, storage: schema.storage }) }, 'Media library'),
      h('button', { class: 'btn', type: 'button', onclick: () => importInput.click() }, 'Import'), importInput,
      h('button', { class: 'btn ghost', type: 'button', onclick: signOut }, 'Sign out')),
    h('main', { class: 'pagesview' }, h('div', { class: 'phead' }, h('div', {}, h('h1', {}, 'Product pages'), h('p', { class: 'hint' }, 'One page per product. Duplicate an existing page to start the next one.')),
      h('button', { class: 'btn primary', type: 'button', onclick: newPage }, '+ New page')), grid));
  await load();
}
