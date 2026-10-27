import { h, api, toast, modal, confirmDialog, fmtTime, debounce } from './ui.js';
import { renderFields } from './fields.js';
import { openLibrary } from './media.js';

const rid = () => 's' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');
const summaryOf = p => String(p.headline || p.heading || p.title || p.caption || p.eyebrow || '').replace(/\s+/g, ' ').slice(0, 60);
const DEVICES = { desktop: ['Desktop', '100%'], tablet: ['Tablet', '820px'], mobile: ['Mobile', '390px'] };

export async function mountEditor(root, id, schema, navigate) {
  const S = { page: await api('GET', `/api/pages/${id}`), selected: 'page', open: new Set(), dirty: false, saving: false, again: false, failed: false, conflict: false, device: 'desktop' };
  const doc = () => S.page.doc;
  const mediaOpts = { maxMb: schema.maxUploadMb, storage: schema.storage };

  // ---------- elements ----------
  const status = h('span', { class: 'savestate', role: 'status' }, 'All changes saved');
  const pubBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => setStatus(S.page.status === 'published' ? 'draft' : 'published') });
  const statusChip = h('span', { class: 'chip' });
  const nameInput = h('input', { class: 'pagename', type: 'text', value: S.page.name, 'aria-label': 'Page name', oninput: e => { S.page.name = e.target.value; touch(); } });
  const banner = h('div', { class: 'banner', hidden: true });
  const structureEl = h('aside', { class: 'structure', 'aria-label': 'Page structure' });
  const formEl = h('section', { class: 'formpane', 'aria-label': 'Editor' });
  const pv = h('iframe', { class: 'pv', title: 'Page preview', src: `/preview/${id}` });
  const pvWrap = h('div', { class: 'pvwrap' }, pv);
  const deviceBtns = Object.entries(DEVICES).map(([k, [label]]) => h('button', { class: 'tabbtn', type: 'button', 'aria-pressed': String(k === 'desktop'), onclick: () => { S.device = k; pvWrap.style.setProperty('--w', DEVICES[k][1]); deviceBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k))); } , dataset: { k } }, label));
  pvWrap.style.setProperty('--w', '100%');
  const viewLink = h('a', { class: 'btn sm', target: '_blank', rel: 'noopener' }, 'Open ↗');

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'btn ghost', type: 'button', onclick: async () => { await flush(); navigate('#/'); } }, '← Pages'),
      nameInput, statusChip, status, h('span', { class: 'grow' }),
      h('button', { class: 'btn', type: 'button', onclick: () => openLibrary({ kind: 'all', ...mediaOpts }) }, 'Media'),
      h('button', { class: 'btn', type: 'button', onclick: openHistory }, 'History'),
      h('button', { class: 'btn', type: 'button', onclick: exportPage }, 'Export'),
      pubBtn),
    banner,
    h('div', { class: 'editor' }, structureEl, formEl,
      h('section', { class: 'previewpane', 'aria-label': 'Live preview' },
        h('div', { class: 'pvbar' }, h('span', { class: 'tabsrow' }, deviceBtns), h('span', { class: 'hint' }, 'Preview refreshes after each save'), viewLink), pvWrap)));

  // ---------- state helpers ----------
  const paintStatus = () => {
    const pub = S.page.status === 'published';
    statusChip.textContent = pub ? 'Published' : 'Draft'; statusChip.className = `chip ${pub ? 'live' : ''}`;
    pubBtn.textContent = pub ? 'Unpublish' : 'Publish'; pubBtn.className = `btn ${pub ? '' : 'primary'}`;
    viewLink.href = `/p/${S.page.slug}`;
  };
  const setSave = (txt, err) => { status.textContent = txt; status.classList.toggle('err', !!err); };
  const schedule = debounce(() => save(), 900);
  function touch() { S.dirty = true; S.failed = false; setSave('Unsaved changes…'); schedule(); refreshSummaries(); }
  async function flush() { schedule.cancel(); if (S.dirty && !S.conflict) await save(); }

  async function save() {
    schedule.cancel();
    if (S.saving) { S.again = true; return; }
    if (!S.dirty || S.conflict) return;
    S.saving = true; S.dirty = false; setSave('Saving…');
    try {
      const r = await api('PUT', `/api/pages/${S.page.id}`, { name: S.page.name, slug: S.page.slug, status: S.page.status, doc: doc(), baseVersion: S.page.version });
      S.page.version = r.version; S.page.updatedAt = r.updatedAt;
      setSave(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`); S.failed = false;
      reloadPreview();
    } catch (e) {
      S.dirty = true; S.failed = true;
      if (e.status === 409 && e.data?.current) { S.conflict = true; showBanner('This page was changed somewhere else (another tab or person). Reload to get the latest version. Your unsaved edits here will be lost.', 'Reload', () => navigate(`#/edit/${id}`, true)); setSave('Not saved: conflict', true); }
      else if (e.status === 401) setSave('Signed out. Sign in again to save.', true);
      else { setSave(`Couldn’t save: ${e.message}`, true); toast(e.message, 'err'); }
    } finally {
      S.saving = false;
      if (S.again && !S.failed) { S.again = false; save(); }
    }
  }
  function showBanner(text, label, fn) { banner.hidden = false; banner.replaceChildren(h('span', {}, text), h('button', { class: 'btn sm', type: 'button', onclick: fn }, label)); }

  async function setStatus(next) {
    if (next === 'published' && !await confirmDialog('Anyone who can reach this site will be able to open the page.', { ok: 'Publish', title: 'Publish this page?' })) return;
    S.page.status = next; S.dirty = true; paintStatus(); await save();
    if (!S.failed) toast(next === 'published' ? 'Published. The page is live.' : 'Unpublished. The page is now a draft.');
  }

  // ---------- preview ----------
  const pdoc = () => { try { return pv.contentDocument; } catch { return null; } };
  function reloadPreview() {
    let y = 0; try { y = pv.contentWindow.scrollY; } catch { /* not ready */ }
    pv.addEventListener('load', () => { try { pv.contentWindow.scrollTo({ top: y, behavior: 'instant' }); } catch { /* ignore */ } }, { once: true });
    try { pv.contentWindow.location.reload(); } catch { pv.src = `/preview/${id}?t=${Date.now()}`; }
  }
  pv.addEventListener('load', () => {
    const d = pdoc(); if (!d) return;
    const st = d.createElement('style');
    st.textContent = '[data-section]{cursor:pointer} [data-selected]{outline:3px solid #55AA31;outline-offset:-3px} html{scroll-behavior:auto!important}';
    d.head.append(st);
    d.addEventListener('click', e => {
      if (e.target.closest('a[href^="http"],a[href^="mailto"]')) return;
      const sec = e.target.closest('[data-section]');
      if (sec) { e.preventDefault(); select(sec.dataset.section, false); }
    });
    markSelected();
  });
  function markSelected() { const d = pdoc(); if (!d) return; d.querySelectorAll('[data-selected]').forEach(n => n.removeAttribute('data-selected')); if (S.selected !== 'page') d.getElementById(S.selected)?.setAttribute('data-selected', ''); }
  function scrollPreview(sid) { const d = pdoc(); const el = d?.getElementById(sid); if (el) pv.contentWindow.scrollTo({ top: el.getBoundingClientRect().top + pv.contentWindow.scrollY - 8, behavior: 'smooth' }); }

  // ---------- structure panel ----------
  let dragId = null;
  const find = sid => doc().sections.findIndex(s => s.id === sid);
  function move(sid, to) {
    const arr = doc().sections, i = find(sid);
    if (i < 0 || to < 0 || to >= arr.length || to === i) return;
    arr.splice(to, 0, arr.splice(i, 1)[0]); touch(); drawStructure();
    structureEl.querySelector(`[data-id="${sid}"] .smain`)?.focus();
  }
  function dropOn(targetId, after) {
    if (!dragId || dragId === targetId) return;
    const arr = doc().sections, item = arr.splice(find(dragId), 1)[0];
    arr.splice(find(targetId) + (after ? 1 : 0), 0, item); touch(); drawStructure();
  }
  const refreshSummaries = debounce(() => structureEl.querySelectorAll('.sitem .ssum').forEach(el => {
    const s = doc().sections[find(el.closest('[data-id]').dataset.id)]; if (s) el.textContent = summaryOf(s.props);
  }), 200);

  function sectionItem(s, i) {
    const def = schema.sections[s.type], arr = doc().sections;
    const ib = (txt, tip, fn, dis) => h('button', { class: 'ib', type: 'button', title: tip, 'aria-label': `${tip}: ${def.label}`, disabled: dis, onclick: e => { e.stopPropagation(); fn(); } }, txt);
    const li = h('li', { class: `sitem${s.enabled ? '' : ' off'}${S.selected === s.id ? ' sel' : ''}`, dataset: { id: s.id }, draggable: true,
      ondragstart: e => { dragId = s.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); setTimeout(() => li.classList.add('dragging'), 0); },
      ondragend: () => { dragId = null; structureEl.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(n => n.classList.remove('dragging', 'drop-before', 'drop-after')); },
      ondragover: e => { if (!dragId) return; e.preventDefault(); const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        structureEl.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after')); li.classList.add(after ? 'drop-after' : 'drop-before'); li.dataset.after = after; },
      ondrop: e => { e.preventDefault(); dropOn(s.id, li.dataset.after === 'true'); } },
      h('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
      h('button', { class: 'smain', type: 'button', 'aria-current': S.selected === s.id ? 'true' : null, onclick: () => select(s.id),
        onkeydown: e => { if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(s.id, i - 1); } if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(s.id, i + 1); } } },
        h('span', { class: 'sico' }, def.icon), h('span', { class: 'stxt' }, h('b', {}, def.label, s.enabled ? '' : h('em', {}, ' · hidden')), h('span', { class: 'ssum' }, summaryOf(s.props)))),
      h('span', { class: 'sacts' },
        ib(s.enabled ? '👁' : '⊘', s.enabled ? 'Hide section' : 'Show section', () => { s.enabled = !s.enabled; touch(); drawStructure(); }),
        ib('↑', 'Move up', () => move(s.id, i - 1), i === 0), ib('↓', 'Move down', () => move(s.id, i + 1), i === arr.length - 1),
        ib('⧉', 'Duplicate', () => { const c = structuredClone(s); c.id = rid(); arr.splice(i + 1, 0, c); touch(); select(c.id); }),
        ib('✕', 'Delete', async () => { if (await confirmDialog(`Delete the “${def.label}” section? You can get it back from History.`, { ok: 'Delete', danger: true })) { arr.splice(i, 1); touch(); select(arr[Math.min(i, arr.length - 1)]?.id || 'page'); } })));
    return li;
  }
  function drawStructure() {
    const arr = doc().sections;
    structureEl.replaceChildren(
      h('button', { class: `pageitem${S.selected === 'page' ? ' sel' : ''}`, type: 'button', onclick: () => select('page') }, h('span', { class: 'sico' }, '⚙'), h('span', { class: 'stxt' }, h('b', {}, 'Page settings'), h('span', { class: 'ssum' }, 'Brand, colors, menu, footer, URL'))),
      h('div', { class: 'shead' }, h('h3', {}, `Sections (${arr.length})`), h('span', { class: 'hint' }, 'Drag to reorder')),
      arr.length ? h('ol', { class: 'slist' }, arr.map(sectionItem)) : h('p', { class: 'empty' }, 'No sections yet. Add your first one.'),
      h('button', { class: 'btn primary add', type: 'button', onclick: openLibraryOfSections }, '+ Add section'));
  }

  function openLibraryOfSections() {
    const m = modal({ title: 'Add a section', wide: true, body: h('div', { class: 'sgroups' }, schema.groups.map(g => {
      const types = Object.entries(schema.sections).filter(([, d]) => d.group === g);
      return types.length ? h('div', { class: 'sgroup' }, h('h3', {}, g), h('div', { class: 'tgrid' }, types.map(([type, d]) =>
        h('button', { class: 'tcard', type: 'button', onclick: () => { const at = S.selected === 'page' ? doc().sections.length : find(S.selected) + 1;
          const sec = { id: rid(), type, enabled: true, settings: { bg: d.settings?.bg || 'white', navLabel: d.settings?.navLabel || '' }, props: structuredClone(d.defaults) };
          doc().sections.splice(at, 0, sec); m.close(); touch(); select(sec.id); } },
          h('span', { class: 'sico big' }, d.icon), h('b', {}, d.label), h('span', {}, d.description))))) : null;
    })) });
  }

  // ---------- form panel ----------
  const ctx = () => ({ sid: S.selected, change: touch, restructure: drawForm, open: S.open, mediaOpts });
  function drawForm() {
    const top = formEl.scrollTop;
    if (S.selected === 'page') formEl.replaceChildren(pageForm());
    else {
      const s = doc().sections[find(S.selected)];
      if (!s) { S.selected = 'page'; return drawForm(); }
      const def = schema.sections[s.type];
      formEl.replaceChildren(h('div', { class: 'fhead' }, h('span', { class: 'sico big' }, def.icon), h('div', {}, h('h2', {}, def.label), h('p', { class: 'hint' }, def.description))),
        h('div', { class: 'fgroup' }, h('h3', {}, 'Content'), renderFields(def.fields, s.props, ctx())),
        h('details', { class: 'fgroup adv', open: true }, h('summary', {}, h('h3', {}, 'Appearance & menu')),
          renderFields([
            { key: 'bg', label: 'Background', type: 'select', options: [{ value: 'tint', label: 'Light tint' }, { value: 'white', label: 'White' }, { value: 'dark', label: 'Dark (uses your accent color)' }] },
            { key: 'navLabel', label: 'Menu label', type: 'text', hint: 'Shows this section in the top menu. Leave empty to leave it out.' }], s.settings, { ...ctx(), restructure: () => {} })));
    }
    formEl.scrollTop = top;
  }

  function colorField(label, theme, key, swatches, hint) {
    const box = h('div', { class: 'field' }, h('label', {}, label));
    const draw = () => {
      const cur = String(theme[key]).toLowerCase();
      const known = swatches.some(s => s.hex.toLowerCase() === cur);
      const hex = h('input', { class: 'hex', type: 'text', value: theme[key], maxlength: 7, 'aria-label': `${label} hex value`, oninput: e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) { theme[key] = e.target.value; picker.value = e.target.value; touch(); sw.forEach(b => b.setAttribute('aria-pressed', 'false')); } } });
      const picker = h('input', { type: 'color', value: theme[key], 'aria-label': `Custom ${label}`, oninput: e => { theme[key] = e.target.value; hex.value = e.target.value; touch(); } });
      picker.addEventListener('change', draw);
      const sw = swatches.map(s => h('button', { class: 'swatch', type: 'button', title: `${s.name} ${s.hex}`, 'aria-label': `${s.name} ${s.hex}`, 'aria-pressed': String(s.hex.toLowerCase() === cur), style: `--c:${s.hex}`, onclick: () => { theme[key] = s.hex; touch(); draw(); } }, h('span', {}, s.name)));
      box.replaceChildren(h('label', {}, label), h('div', { class: 'swatches' }, sw), h('div', { class: 'customcolor' }, h('span', {}, known ? 'Custom' : 'Custom (in use)'), picker, hex), hint ? h('p', { class: 'hint' }, hint) : null);
    };
    draw(); return box;
  }

  function pageForm() {
    const t = doc().theme, c = ctx();
    const slugIn = h('input', { type: 'text', value: S.page.slug, 'aria-label': 'URL name', oninput: e => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'); S.page.slug = v; if (e.target.value !== v) e.target.value = v; paintStatus(); touch(); } });
    const T = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
    return h('div', {},
      h('div', { class: 'fhead' }, h('span', { class: 'sico big' }, '⚙'), h('div', {}, h('h2', {}, 'Page settings'), h('p', { class: 'hint' }, 'These apply to the whole page.'))),
      h('div', { class: 'fgroup' }, h('h3', {}, 'Address'),
        h('div', { class: 'field' }, h('label', {}, 'URL name'), h('div', { class: 'urlrow' }, h('span', {}, `${location.origin}/p/`), slugIn),
          h('p', { class: 'hint' }, 'Lowercase letters, numbers and dashes. Changing it breaks links already shared.'),
          h('button', { class: 'btn sm', type: 'button', onclick: () => navigator.clipboard?.writeText(`${location.origin}/p/${S.page.slug}`).then(() => toast('Link copied')) }, 'Copy link'))),
      h('div', { class: 'fgroup' }, h('h3', {}, 'Colors'),
        colorField('Primary color', t, 'primary', [schema.palette.primary], 'Buttons, highlights and progress bars. Text on it switches between dark and white automatically.'),
        colorField('Accent color', t, 'accent', schema.palette.accents, 'Dark bands, the contact block and the “after” panel.'),
        renderFields([T('pageBackground', 'Page background', 'select', { options: [{ value: 'tint', label: 'Honeydew tint' }, { value: 'white', label: 'Clean white' }] })], t, c)),
      h('div', { class: 'fgroup' }, h('h3', {}, 'Top bar'),
        renderFields([T('brandName', 'Product name'), T('badge', 'Badge next to the name'), T('logo', 'Logo (replaces the name)', 'image'), T('showNav', 'Show the top bar', 'toggle'),
          T('navCtaLabel', 'Top bar button label'), T('navCtaUrl', 'Top bar button link', 'url')], t, c)),
      h('div', { class: 'fgroup' }, h('h3', {}, 'Search & sharing'),
        renderFields([T('title', 'Browser tab title'), T('description', 'Short description (also shown on the index page)', 'textarea', { rows: 3 })], doc().meta, c)),
      h('div', { class: 'fgroup' }, h('h3', {}, 'Footer'), renderFields([T('footerLeft', 'Left text'), T('footerRight', 'Right text')], t, c)),
      h('div', { class: 'fgroup danger' }, h('h3', {}, 'Danger zone'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog(`Delete “${S.page.name}” and all its history? This can’t be undone.`, { ok: 'Delete page', danger: true })) { await api('DELETE', `/api/pages/${S.page.id}`); S.dirty = false; navigate('#/'); } } }, 'Delete this page')));
  }

  function select(sid, scroll = true) {
    S.selected = sid; drawStructure(); drawForm(); markSelected();
    if (scroll && sid !== 'page') scrollPreview(sid);
  }

  // ---------- history / export ----------
  async function openHistory() {
    await flush();
    const revs = await api('GET', `/api/pages/${id}/revisions`);
    const m = modal({ title: 'Version history', body: h('div', { class: 'revs' }, revs.map((r, i) => h('div', { class: 'rev' },
      h('div', {}, h('b', {}, fmtTime(r.createdAt)), h('small', {}, `${r.note || (i === 0 ? 'Latest' : 'Edit')} · ${Math.round(r.size / 1024)} KB`)),
      i === 0 ? h('span', { class: 'hint' }, 'Current') : h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        if (!await confirmDialog('Replace the current content with this version? The current version stays in history.', { ok: 'Restore' })) return;
        try { await api('POST', `/api/pages/${id}/revisions/${r.id}/restore`); m.close(); toast('Version restored'); navigate(`#/edit/${id}`, true); } catch (e) { toast(e.message, 'err'); } } }, 'Restore')))) });
  }
  async function exportPage() {
    await flush();
    const data = await api('GET', `/api/pages/${id}/export`);
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `${S.page.slug}.spotlight.json` });
    document.body.append(a); a.click(); a.remove(); toast('Exported. Media files stay in the library; the export links to them.');
  }

  // ---------- lifecycle ----------
  const beforeUnload = e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);

  paintStatus(); drawStructure(); drawForm();
  return () => { schedule.cancel(); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('keydown', onKey); };
}
