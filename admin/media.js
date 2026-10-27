// Media library: browse, upload (images + video), edit alt text, delete. Also used as a picker.
import { h, api, upload, modal, toast, confirmDialog, fmtSize } from './ui.js';

export function openLibrary({ kind = 'all', pick = false, maxMb = 200, storage = 'local' } = {}) {
  return new Promise(resolve => {
    let items = [], filter = kind, selected = null, settled = false;
    const settle = v => { if (!settled) { settled = true; resolve(v); } };
    const grid = h('div', { class: 'mgrid' });
    const status = h('div', { class: 'mstatus', role: 'status' });
    const progress = h('div', { class: 'progress', hidden: true }, h('i'));
    const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime', hidden: true, onchange: e => doUpload([...e.target.files]) });
    const useBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => { settle(selected.url); m.close(); } }, 'Use selected');

    const tabs = (kind === 'all' ? ['all', 'image', 'video'] : [])
      .map(t => h('button', { class: 'tabbtn', type: 'button', 'aria-pressed': String(filter === t), onclick: e => { filter = t; tabs.forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget))); draw(); } }, { all: 'All', image: 'Images', video: 'Videos' }[t]));

    function card(it) {
      const sel = selected?.id === it.id;
      const thumb = it.kind === 'image' ? h('img', { src: it.url, alt: it.alt || '', loading: 'lazy' }) : h('video', { src: it.url + '#t=0.5', preload: 'metadata', muted: true });
      return h('div', { class: `mcard${sel ? ' sel' : ''}`, tabindex: pick ? 0 : -1, onclick: () => { if (pick) { selected = it; useBtn.disabled = false; draw(); } },
        ondblclick: () => { if (pick) { settle(it.url); m.close(); } },
        onkeydown: e => { if (pick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selected = it; useBtn.disabled = false; draw(); } } },
        h('div', { class: 'mthumb' }, thumb, it.kind === 'video' ? h('span', { class: 'vbadge' }, '▶') : null),
        h('div', { class: 'minfo' }, h('b', { title: it.name }, it.name), h('small', {}, `${fmtSize(it.size)}${it.usedIn.length ? ` · used on ${it.usedIn.length} page${it.usedIn.length > 1 ? 's' : ''}` : ''}`)),
        it.kind === 'image' ? h('input', { class: 'alt', type: 'text', placeholder: 'Alt text (describe the image)', value: it.alt || '', 'aria-label': `Alt text for ${it.name}`,
          onclick: e => e.stopPropagation(), onkeydown: e => e.stopPropagation(),
          onchange: async e => { try { await api('PATCH', `/api/media/${it.id}`, { alt: e.target.value }); it.alt = e.target.value; toast('Alt text saved'); } catch (err) { toast(err.message, 'err'); } } }) : null,
        h('button', { class: 'del', type: 'button', title: 'Delete', 'aria-label': `Delete ${it.name}`, onclick: async e => { e.stopPropagation(); await remove(it); } }, '✕'));
    }
    function draw() {
      const list = items.filter(i => filter === 'all' || i.kind === filter);
      grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, 'Nothing here yet. Upload files or drop them anywhere in this window.')]));
    }
    async function load() { try { items = await api('GET', '/api/media'); draw(); } catch (e) { status.textContent = e.message; } }
    async function remove(it) {
      try { await api('DELETE', `/api/media/${it.id}`); }
      catch (e) {
        if (e.status !== 409) return toast(e.message, 'err');
        const names = e.data.usedIn.map(u => u.name).join(', ');
        if (!await confirmDialog(`“${it.name}” is used on: ${names}. Deleting it leaves a broken ${it.kind} there.`, { ok: 'Delete anyway', danger: true, title: 'File is in use' })) return;
        try { await api('DELETE', `/api/media/${it.id}?force=1`); } catch (e2) { return toast(e2.message, 'err'); }
      }
      if (selected?.id === it.id) { selected = null; useBtn.disabled = true; }
      items = items.filter(i => i.id !== it.id); draw();
    }
    async function doUpload(files) {
      if (!files.length) return;
      const tooBig = files.filter(f => f.size > maxMb * 1048576);
      if (tooBig.length) toast(`${tooBig.map(f => f.name).join(', ')} is over the ${maxMb} MB limit`, 'err');
      files = files.filter(f => f.size <= maxMb * 1048576);
      if (!files.length) return;
      progress.hidden = false; status.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;
      try {
        const r = await upload(files, p => { progress.firstChild.style.width = `${Math.round(p * 100)}%`; });
        (r.errors || []).forEach(e => toast(e, 'err'));
        await load();
        if (pick && r.media?.length) { selected = items.find(i => i.id === r.media[0].id); useBtn.disabled = false; draw(); }
        status.textContent = `Uploaded ${r.media.length} file${r.media.length === 1 ? '' : 's'}.`;
      } catch (e) { status.textContent = ''; toast(e.message, 'err'); }
      progress.hidden = true; progress.firstChild.style.width = '0';
      fileInput.value = '';
    }

    const body = h('div', { class: 'lib',
      ondragover: e => { e.preventDefault(); body.classList.add('drop'); },
      ondragleave: e => { if (e.target === body) body.classList.remove('drop'); },
      ondrop: e => { e.preventDefault(); body.classList.remove('drop'); doUpload([...e.dataTransfer.files]); } },
      h('div', { class: 'ltools' }, tabs.length ? h('div', { class: 'tabsrow' }, tabs) : h('span'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => fileInput.click() }, '⬆ Upload files'), fileInput),
      h('p', { class: 'hint' }, `PNG, JPG, GIF, WebP images and MP4, MOV, WebM video up to ${maxMb} MB each. Stored in ${storage === 'supabase' ? 'Supabase Storage' : 'local disk'}.`),
      progress, status, grid);
    const m = modal({ title: pick ? `Choose ${kind === 'video' ? 'a video' : kind === 'image' ? 'an image' : 'media'}` : 'Media library', body, wide: true,
      footer: pick ? [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancel'), useBtn] : [h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Done')],
      onClose: () => settle(null) });
    load();
  });
}
