// Validates/cleans a page document against the section schema. Unknown keys are dropped,
// wrong types are coerced or replaced by defaults, sizes are capped.
const crypto = require('node:crypto');
const { SECTION_TYPES, THEME_DEFAULTS, META_DEFAULTS } = require('./sections');
const { isHex } = require('./color');

const MAX_SECTIONS = 60;
const str = (v, max) => (typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : '').slice(0, max);
const sectionId = () => 's' + crypto.randomBytes(5).toString('hex');

function cleanFields(fields, src, defaults = {}) {
  const out = {};
  src = src && typeof src === 'object' ? src : {};
  for (const f of fields) {
    const v = src[f.key];
    switch (f.type) {
      case 'text': case 'url': out[f.key] = str(v, f.type === 'url' ? 2000 : 600); break;
      case 'textarea': out[f.key] = str(v, 4000); break;
      case 'markdown': out[f.key] = str(v, 20000); break;
      case 'image': case 'video': out[f.key] = str(v, 2000); break;
      case 'toggle': out[f.key] = v === true || v === 'true'; break;
      case 'number': { const n = Number(v); out[f.key] = Number.isFinite(n) ? Math.min(f.max ?? 1e9, Math.max(f.min ?? -1e9, n)) : (f.min ?? 0); break; }
      case 'select': {
        const vals = f.options.map(o => (typeof o === 'string' ? o : o.value));
        out[f.key] = vals.includes(v) ? v : (defaults[f.key] ?? vals[0]); break;
      }
      case 'strings': out[f.key] = (Array.isArray(v) ? v : []).slice(0, 60).map(x => str(x, 600)); break;
      case 'list': out[f.key] = (Array.isArray(v) ? v : []).slice(0, f.max || 60).map(item => cleanFields(f.fields, item)); break;
      default: break;
    }
  }
  return out;
}

function normalizeTheme(theme) {
  theme = theme && typeof theme === 'object' ? theme : {};
  const d = THEME_DEFAULTS;
  return {
    brandName: str(theme.brandName ?? d.brandName, 80),
    badge: str(theme.badge ?? d.badge, 40),
    primary: isHex(theme.primary) ? theme.primary : d.primary,
    accent: isHex(theme.accent) ? theme.accent : d.accent,
    pageBackground: theme.pageBackground === 'white' ? 'white' : 'tint',
    showNav: theme.showNav !== false,
    navCtaLabel: str(theme.navCtaLabel ?? d.navCtaLabel, 40),
    navCtaUrl: str(theme.navCtaUrl ?? d.navCtaUrl, 2000),
    logo: str(theme.logo ?? '', 2000),
    footerLeft: str(theme.footerLeft ?? d.footerLeft, 200),
    footerRight: str(theme.footerRight ?? d.footerRight, 200),
  };
}

function normalizeDoc(doc) {
  doc = doc && typeof doc === 'object' ? doc : {};
  const seen = new Set();
  const sections = (Array.isArray(doc.sections) ? doc.sections : []).slice(0, MAX_SECTIONS).flatMap(s => {
    const def = s && SECTION_TYPES[s.type];
    if (!def) return [];
    let id = /^s[a-z0-9]{4,20}$/.test(s.id || '') ? s.id : sectionId();
    while (seen.has(id)) id = sectionId();
    seen.add(id);
    const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
    return [{
      id, type: s.type, enabled: s.enabled !== false,
      settings: { bg: ['tint', 'white', 'dark'].includes(st.bg) ? st.bg : (def.settings?.bg || 'white'), navLabel: str(st.navLabel ?? '', 30) },
      props: cleanFields(def.fields, s.props, def.defaults),
    }];
  });
  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  return {
    meta: { title: str(meta.title ?? META_DEFAULTS.title, 160), description: str(meta.description ?? '', 300) },
    theme: normalizeTheme(doc.theme),
    sections,
  };
}

function newSection(type) {
  const def = SECTION_TYPES[type];
  if (!def) return null;
  return {
    id: sectionId(), type, enabled: true,
    settings: { bg: def.settings?.bg || 'white', navLabel: def.settings?.navLabel || '' },
    props: structuredClone(def.defaults),
  };
}

const SLUG_RESERVED = new Set(['admin', 'api', 'p', 'preview', 'uploads', 'assets', 'static', 'new']);
const slugify = s => str(s, 80).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const validSlug = s => /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(s) && !SLUG_RESERVED.has(s);

module.exports = { normalizeDoc, newSection, slugify, validSlug, str, sectionId };
