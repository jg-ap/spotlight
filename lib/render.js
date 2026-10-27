// Server-side renderer: page document -> HTML. Everything user-supplied goes through esc()/safeUrl().
const config = require('./config');
const { PALETTE, SECTION_TYPES } = require('./sections');
const C = require('./color');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeUrl(u) {
  u = String(u ?? '').trim();
  if (!u) return '';
  if (u.startsWith('#') || (u.startsWith('/') && !u.startsWith('//'))) return u;
  try { const p = new URL(u); if (['http:', 'https:', 'mailto:'].includes(p.protocol)) return u; } catch {}
  return '';
}
const isExternal = u => /^https?:/i.test(u);

// ---- markdown-lite: paragraphs, bullets, **bold**, *italic*, [links](url) ----
function inline(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, u) => {
      const href = safeUrl(u.replace(/&amp;/g, '&'));
      return href ? `<a href="${esc(href)}"${isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>` : text;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
}
function md(text) {
  return String(text ?? '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(esc(l.replace(/^\s*[-*] /, '')))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(l => inline(esc(l))).join('<br>')}</p>`;
  }).join('');
}

// ---- media ----
function embedSrc(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  const h = u.hostname.toLowerCase();
  let m;
  if (h === 'youtu.be') { m = u.pathname.slice(1); }
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) {
    m = u.searchParams.get('v') || (/^\/(embed|shorts|live)\/([\w-]{6,})/.exec(u.pathname) || [])[2];
  }
  if (m && /^[\w-]{6,}$/.test(m)) return `https://www.youtube-nocookie.com/embed/${m}?rel=0`;
  if (/(^|\.)vimeo\.com$/.test(h)) {
    const id = /(\d{5,})/.exec(u.pathname)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : '';
  }
  if (/(^|\.)loom\.com$/.test(h)) {
    const id = /\/(?:share|embed)\/([\w]+)/.exec(u.pathname)?.[1];
    return id ? `https://www.loom.com/embed/${id}` : '';
  }
  return config.embedHosts.some(allowed => h === allowed || h.endsWith('.' + allowed)) ? u.toString() : '';
}

function media(p, ctx, o = {}) {
  const kind = p.mediaType;
  const hint = t => ctx.preview ? `<div class="ph">${esc(t)}</div>` : '';
  if (kind === 'image') {
    const src = safeUrl(p.image);
    return src ? `<img src="${esc(src)}" alt="${esc(ctx.alt[p.image] || o.alt || '')}" loading="${o.eager ? 'eager' : 'lazy'}">` : hint('Add an image in the editor');
  }
  if (kind === 'video') {
    const src = safeUrl(p.video);
    if (!src) return hint('Upload a video in the editor');
    const poster = safeUrl(p.poster);
    const auto = o.autoplay ? ' autoplay muted loop controls' : ' controls';
    return `<video${auto} playsinline preload="metadata"${poster ? ` poster="${esc(poster)}"` : ''}><source src="${esc(src)}"></video>`;
  }
  if (kind === 'embed') {
    const src = embedSrc(p.embedUrl);
    if (!src) return p.embedUrl ? hint('That video link isn’t supported. Use YouTube, Vimeo, Loom or Stream.') : hint('Paste a video link in the editor');
    return `<iframe src="${esc(src)}" title="${esc(o.alt || 'Video')}" loading="lazy" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }
  return '';
}
const hasMedia = (p, ctx) => !!p.mediaType && p.mediaType !== 'none' && media(p, { ...ctx, preview: false }).length > 0;
const frame = inner => `<div class="frame"><div class="bar"><i></i><i></i><i></i></div><div class="screen">${inner}</div></div>`;

// ---- shared bits ----
const head = (p, extra = '') => (p.eyebrow || p.heading || p.lead) ? `<header class="shead${extra}">${
  p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''}${
  p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}${
  p.lead ? `<p class="lead">${esc(p.lead)}</p>` : ''}</header>` : '';
const btn = (label, url, cls) => {
  const href = safeUrl(url);
  return label && href ? `<a class="btn ${cls}" href="${esc(href)}"${isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(label)}</a>` : '';
};
const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const avatar = (name, photo) => safeUrl(photo) ? `<img class="av" src="${esc(safeUrl(photo))}" alt="">` : `<div class="av">${esc(initials(name))}</div>`;

// ---- section renderers: (props, ctx) -> inner HTML ----
const R = {
  hero(p, ctx) {
    const m = p.mediaType !== 'none' && (ctx.preview || hasMedia(p, ctx))
      ? `<div class="hmedia">${frame(media(p, ctx, { autoplay: p.autoplay, alt: p.videoCaption || p.headline, eager: true }))}${
          p.videoCaption && p.mediaType === 'video' ? `<div class="vcap">${esc(p.videoCaption)}</div>` : ''}${
          p.chipValue ? `<div class="chip"><b>${esc(p.chipValue)}</b>${esc(p.chipLabel)}</div>` : ''}</div>` : '';
    const stats = (p.stats || []).filter(s => s.value || s.label);
    const aud = (p.audience || []).filter(Boolean);
    return `<div class="hgrid${m ? '' : ' solo'}"><div class="htext">
      ${p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''}
      <h1>${esc(p.headline)}</h1>
      ${p.subhead ? `<p class="lead">${esc(p.subhead)}</p>` : ''}
      ${stats.length ? `<div class="stats">${stats.map(s => `<div><b>${esc(s.value)}</b><small>${esc(s.label)}</small></div>`).join('')}</div>` : ''}
      ${(p.primaryLabel || p.secondaryLabel) ? `<div class="cta">${btn(p.primaryLabel, p.primaryUrl, 'p')}${btn(p.secondaryLabel, p.secondaryUrl, 's')}</div>` : ''}
      </div>${m}</div>
      ${aud.length ? `<div class="audience">${p.audienceLabel ? `<span>${esc(p.audienceLabel)}</span>` : ''}${aud.map(a => `<span class="tagchip">${esc(a)}</span>`).join('')}</div>` : ''}`;
  },

  problem(p) {
    const col = (title, items, cls) => `<div class="panel ${cls}"><h3>${esc(title)}</h3><ul>${(items || []).filter(Boolean).map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
    return `${head(p)}<div class="ba">${col(p.beforeTitle, p.beforeItems, 'before')}${col(p.afterTitle, p.afterItems, 'after')}</div>`;
  },

  features(p) {
    const cols = ['2', '3', '4'].includes(p.columns) ? p.columns : '3';
    return `${head(p)}<div class="fgrid cols-${cols}">${(p.items || []).map(i =>
      `<div class="card"><div class="ico" aria-hidden="true">${esc(i.icon)}</div><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}</div>`;
  },

  steps(p) {
    return `${head(p)}<ol class="steps" style="--n:${Math.max(1, (p.steps || []).length)}">${(p.steps || []).map((s, i) =>
      `<li class="step"><div class="num">${i + 1}</div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>`;
  },

  showcase(p, ctx) {
    const items = p.items || [];
    if (!items.length) return head(p);
    return `${head(p)}<div class="showcase" data-tabs>
      <div class="tablist" role="tablist" aria-label="${esc(p.heading || 'Workflows')}">${items.map((it, i) =>
        `<button class="tab" role="tab" type="button" id="${ctx.sid}-t${i}" aria-controls="${ctx.sid}-p${i}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><b>${esc(it.title)}</b><span>${esc(it.text)}</span></button>`).join('')}</div>
      <div class="tabpanels">${items.map((it, i) =>
        `<div class="tabpanel" role="tabpanel" id="${ctx.sid}-p${i}" aria-labelledby="${ctx.sid}-t${i}"${i ? ' hidden' : ''}>${frame(media(it, ctx, { alt: it.title }) || '<div class="ph">No media</div>')}</div>`).join('')}</div></div>`;
  },

  gallery(p, ctx) {
    const items = (p.items || []).filter(i => ctx.preview || hasMedia(i, ctx));
    if (!items.length) return ctx.preview ? head(p) : ''; // nothing to show yet: leave it off the live page
    return `${head(p)}<div class="carousel" data-carousel aria-roledescription="carousel">
      <div class="track" tabindex="0">${items.map(i => `<figure class="slide"><div class="shot">${media(i, ctx, { alt: i.caption, eager: true })}</div>${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div>
      <div class="cnav"><button type="button" class="cbtn" data-dir="-1" aria-label="Previous">←</button><button type="button" class="cbtn" data-dir="1" aria-label="Next">→</button></div></div>`;
  },

  richtext(p, ctx) {
    const layout = p.layout || 'media-right';
    const m = layout !== 'text-only' && (ctx.preview || hasMedia(p, ctx)) ? `<div class="rmedia">${p.mediaType === 'image' ? `<div class="shot">${media(p, ctx, { alt: p.heading })}</div>` : frame(media(p, ctx, { alt: p.heading }))}</div>` : '';
    const text = `<div class="rtext">${p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''}${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}<div class="prose">${md(p.body)}</div></div>`;
    return `<div class="rich ${m ? layout : 'text-only'}">${layout === 'media-left' ? m + text : text + m}</div>`;
  },

  results(p) {
    return `${head(p)}
      ${(p.metrics || []).length ? `<div class="mband" style="--n:${Math.min(4, p.metrics.length)}">${p.metrics.map(m => `<div><b>${esc(m.value)}</b><small>${esc(m.label)}</small></div>`).join('')}</div>` : ''}
      ${(p.quotes || []).length ? `<div class="quotes">${p.quotes.map(q => `<figure class="q"><blockquote>“${esc(q.text)}”</blockquote><figcaption class="who">${avatar(q.name, q.photo)}<div><b>${esc(q.name)}</b>${esc(q.role)}</div></figcaption></figure>`).join('')}</div>` : ''}`;
  },

  adoption(p) {
    return `<div class="adg"><div>${head(p)}${p.ctaLabel && safeUrl(p.ctaUrl) ? `<div class="cta">${btn(p.ctaLabel, p.ctaUrl, 's')}</div>` : ''}</div>
      <div class="bars">${(p.bars || []).map(b => { const v = Math.round(Number(b.value) || 0);
        return `<div class="row"><span>${esc(b.label)}</span><div class="track" role="img" aria-label="${esc(b.label)}: ${v}%"><i style="width:${v}%"></i></div><b>${v}%</b></div>`; }).join('')}</div></div>`;
  },

  whatsnew(p) {
    const entries = [...(p.entries || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return `${head(p)}<ol class="feed">${entries.map(e =>
      `<li><time>${esc(e.date)}</time><div>${e.tag ? `<span class="tagchip solid">${esc(e.tag)}</span>` : ''}<h3>${esc(e.title)}</h3>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div></li>`).join('')}</ol>`;
  },

  roadmap(p) {
    const col = (title, items, cls) => `<div class="rcol ${cls}"><h3>${esc(title)}</h3>${(items || []).map(i => `<div class="card"><b>${esc(i.title)}</b>${i.text ? `<p>${esc(i.text)}</p>` : ''}</div>`).join('')}</div>`;
    return `${head(p)}<div class="roadmap">${col(p.nowTitle, p.now, 'now')}${col(p.nextTitle, p.next, 'next')}${col(p.laterTitle, p.later, 'later')}</div>`;
  },

  getStarted(p) {
    return `${head(p)}<div class="sgrid">${(p.steps || []).map(s => {
      const href = safeUrl(s.linkUrl);
      return `<div class="sc">${s.label ? `<div class="n">${esc(s.label)}</div>` : ''}<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.linkLabel ? (href ? `<a href="${esc(href)}"${isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(s.linkLabel)}</a>` : `<span class="soon">${esc(s.linkLabel)}</span>`) : ''}</div>`; }).join('')}</div>
      ${(p.resources || []).length ? `<div class="res">${p.resources.map(r => { const href = safeUrl(r.url);
        return `<${href ? `a href="${esc(href)}"${isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}` : 'div'} class="rescard"><b>${esc(r.title)}</b><span>${esc(r.text)}</span></${href ? 'a' : 'div'}>`; }).join('')}</div>` : ''}`;
  },

  faq(p) {
    return `${head(p)}<div class="faq">${(p.items || []).map(i => `<details class="qa"><summary>${esc(i.q)}</summary><div class="ans prose">${md(i.a)}</div></details>`).join('')}</div>`;
  },

  contact(p) {
    return `<div class="cbox"><div><h2>${esc(p.heading)}</h2>${p.text ? `<p>${esc(p.text)}</p>` : ''}${btn(p.buttonLabel, p.buttonUrl, 'p')}</div>
      ${(p.people || []).length ? `<div class="team">${p.people.map(x => `<div class="person">${avatar(x.name, x.photo)}<b>${esc(x.name)}</b><small>${esc(x.role)}</small>${
        x.email && safeUrl('mailto:' + x.email) ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : ''}</div>`).join('')}</div>` : ''}</div>`;
  },
};

const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

function themeVars(theme) {
  const tint = theme.pageBackground === 'white' ? '#f5f7f4' : PALETTE.tint;
  const bg = theme.pageBackground === 'white' ? '#ffffff' : PALETTE.tint;
  const ink = PALETTE.ink;
  const muted = C.ensureContrast(C.mix(ink, '#ffffff', 0.38), tint, 5);
  const onAccent = C.onColor(theme.accent);
  const vars = {
    '--primary': theme.primary,
    '--primary-ink': C.onColor(theme.primary),
    '--primary-text': C.ensureContrast(theme.primary, tint, 4.8),
    '--primary-soft': C.mix(theme.primary, '#ffffff', 0.84),
    '--accent': theme.accent,
    '--on-accent': onAccent,
    '--eyebrow-d': C.ensureContrast(theme.primary, theme.accent, 4.5),
    '--bg': bg, '--tint': tint, '--fg': ink, '--muted': muted, '--line': '#dde5d8',
  };
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}

function renderPage(page, { preview = false, altMap = {} } = {}) {
  const { doc } = page, theme = doc.theme;
  const seen = new Set();
  const live = doc.sections.filter(s => s.enabled);
  const anchors = new Map();
  for (const s of live) { const a = kebab(s.type); if (!anchors.has(a)) anchors.set(a, s.id); }

  const navLinks = live.filter(s => s.settings.navLabel).map(s => `<a href="#${esc(s.id)}">${esc(s.settings.navLabel)}</a>`).join('');
  const navCta = theme.navCtaLabel && safeUrl(theme.navCtaUrl)
    ? `<a class="btn p" href="${esc(safeUrl(theme.navCtaUrl))}">${esc(theme.navCtaLabel)}</a>` : '';
  const logo = safeUrl(theme.logo) ? `<img class="logo" src="${esc(safeUrl(theme.logo))}" alt="${esc(theme.brandName)}">` : esc(theme.brandName);

  const body = live.map(s => {
    const ctx = { preview, alt: altMap, sid: s.id };
    const def = SECTION_TYPES[s.type];
    const inner = R[s.type](s.props, ctx);
    if (!inner && !preview) return '';
    const anchorHere = [...anchors].filter(([, id]) => id === s.id).map(([a]) => `<span class="anchor" id="${esc(a)}"></span>`).join('');
    return `<section id="${esc(s.id)}" class="sec sec-${esc(s.type)} bg-${esc(s.settings.bg)}" data-section="${esc(s.id)}">${anchorHere}<div class="wrap">${inner}</div></section>`;
  }).join('\n');

  const title = doc.meta.title || `${theme.brandName} · Product spotlight`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${doc.meta.description ? `<meta name="description" content="${esc(doc.meta.description)}">` : ''}
<meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light">
<link rel="stylesheet" href="/assets/site.css">
<style>:root{${themeVars(theme)}}</style></head>
<body${preview ? ' class="is-preview"' : ''}>
<a class="skip" href="#main">Skip to content</a>
${theme.showNav ? `<header class="nav"><div class="wrap navrow"><div class="brand">${logo}${theme.badge ? `<small>${esc(theme.badge)}</small>` : ''}</div><nav class="links" aria-label="Page sections">${navLinks}</nav>${navCta}</div></header>` : ''}
<main id="main">
${body || '<section class="sec bg-white"><div class="wrap"><p class="lead">This page has no sections yet.</p></div></section>'}
</main>
<footer class="foot"><div class="wrap"><span>${esc(theme.footerLeft)}</span><span>${esc(theme.footerRight)}</span></div></footer>
<script src="/assets/site.js" defer></script>
</body></html>`;
}

function renderIndex(pages) {
  const cards = pages.map(p => `<a class="icard" href="/p/${esc(p.slug)}" style="--a:${esc(p.accent || PALETTE.accents[0].hex)}"><span class="stripe"></span><b>${esc(p.name)}</b><span>${esc(p.description || '')}</span><em>View spotlight →</em></a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(config.siteTitle)}</title>
<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/assets/site.css"><style>:root{${themeVars({ primary: PALETTE.primary.hex, accent: PALETTE.accents[0].hex, pageBackground: 'tint' })}}</style></head>
<body class="index"><main><div class="wrap"><header class="shead"><div class="eyebrow">Internal products</div><h1>${esc(config.siteTitle)}</h1><p class="lead">Learn what each product does, see it in action, and find out how to get started.</p></header>
${cards ? `<div class="igrid">${cards}</div>` : '<p class="lead">No spotlights have been published yet.</p>'}</div></main></body></html>`;
}

module.exports = { renderPage, renderIndex, esc, safeUrl, md, embedSrc };
