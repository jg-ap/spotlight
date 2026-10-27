const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const config = require('./lib/config');
const db = require('./lib/db');
const auth = require('./lib/auth');
const storage = require('./lib/storage');
const { SECTION_TYPES, GROUP_ORDER, PALETTE, THEME_DEFAULTS } = require('./lib/sections');
const { normalizeDoc, newSection, slugify, validSlug, str } = require('./lib/normalize');
const { starterDoc } = require('./lib/starter');
const { renderPage, renderIndex } = require('./lib/render');

// Identify the real file type from its first bytes rather than trusting the browser-supplied mime/extension.
function sniff(buf) {
  const hex = buf.subarray(0, 16).toString('hex');
  if (hex.startsWith('89504e47')) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (hex.startsWith('ffd8ff')) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (hex.startsWith('47494638')) return { mime: 'image/gif', ext: 'gif', kind: 'image' };
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (buf.subarray(4, 8).toString() === 'ftyp') {
    const brand = buf.subarray(8, 12).toString();
    return brand.startsWith('qt') ? { mime: 'video/quicktime', ext: 'mov', kind: 'video' } : { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  }
  if (hex.startsWith('1a45dfa3')) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}

function frameSrc() {
  // 'self' lets the admin embed its own /preview page. Embed hosts also match their subdomains.
  const hosts = new Set(["'self'"]);
  for (const h of config.embedHosts) { hosts.add(`https://${h}`); if (!h.startsWith('www.')) hosts.add(`https://*.${h}`); }
  return [...hosts].join(' ');
}
const CSP = [
  "default-src 'self'", "img-src 'self' data: https:", "media-src 'self' https:", `frame-src ${frameSrc()}`,
  "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self'", "object-src 'none'",
  "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ');

// Express 4 doesn't catch rejected promises from async handlers, so route them to the error handler.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ seed = true } = {}) {
  const app = express();
  const store = storage.create();
  const tmpDir = path.join(config.dataDir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const upload = multer({ dest: tmpDir, limits: { fileSize: config.maxUploadBytes, files: 10 } });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  // Nothing is served until the database is reachable and migrated.
  app.use((req, res, next) => db.ready.then(() => next(), next));

  // ---- static ----
  app.use('/assets', express.static(path.join(config.root, 'public'), { maxAge: config.production ? '1h' : 0 }));
  app.use('/admin', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); },
    express.static(path.join(config.root, 'admin'), { index: 'index.html' }));
  if (store.dir) app.use('/uploads', express.static(store.dir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  app.get('/healthz', (req, res) => res.json({ ok: true, storage: store.name, database: db.kind }));

  // ---- public pages ----
  app.get('/', ah(async (req, res) => {
    res.type('html').send(renderIndex((await db.listPages()).filter(p => p.status === 'published')));
  }));
  app.get('/p/:slug', ah(async (req, res) => {
    const page = await db.getPageBySlug(req.params.slug);
    if (!page || (page.status !== 'published' && !auth.isAdmin(req))) return res.status(404).type('html').send(notFound());
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderPage(page, { altMap: await db.altMap() }));
  }));
  app.get('/preview/:id', ah(async (req, res) => {
    if (!auth.isAdmin(req)) return res.status(401).send('Sign in to the admin first.');
    const page = await db.getPage(req.params.id);
    if (!page) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderPage(page, { preview: true, altMap: await db.altMap() }));
  }));

  // ---- auth ----
  app.post('/api/login', (req, res) => {
    if (auth.rateLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (!auth.checkPassword(req.body?.password)) { auth.noteFailure(req.ip); return res.status(401).json({ error: 'Incorrect password' }); }
    auth.issue(res); res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => { auth.clear(res); res.json({ ok: true }); });
  app.get('/api/me', (req, res) => res.json({ admin: auth.isAdmin(req), storage: store.name }));

  const api = express.Router();
  api.use(auth.require);
  app.use('/api', api);

  api.get('/schema', (req, res) => res.json({ sections: SECTION_TYPES, groups: GROUP_ORDER, palette: PALETTE, themeDefaults: THEME_DEFAULTS, maxUploadMb: Math.round(config.maxUploadBytes / 1048576), storage: store.name }));

  // ---- pages ----
  const summary = p => ({ id: p.id, slug: p.slug, name: p.name, status: p.status, version: p.version, updatedAt: p.updatedAt, doc: p.doc });
  const uniqueSlug = async base => { let s = base || 'page', i = 2; while (!validSlug(s) || await db.getPageBySlug(s)) s = `${base || 'page'}-${i++}`.slice(0, 60); return s; };

  api.get('/pages', ah(async (req, res) => res.json(await db.listPages())));
  api.post('/pages', ah(async (req, res) => {
    const name = str(req.body?.name, 120).trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const doc = req.body?.doc ? normalizeDoc(req.body.doc) : starterDoc(name);
    if (req.body?.doc) doc.theme.brandName = doc.theme.brandName || name;
    const page = await db.createPage({ name, slug: await uniqueSlug(slugify(req.body?.slug || name)), doc });
    res.status(201).json(summary(page));
  }));
  api.post('/pages/import', ah(async (req, res) => {
    const src = req.body?.page;
    if (!src || src.format !== 'spotlight-page' || !src.doc) return res.status(400).json({ error: 'Not a Spotlight page export' });
    const name = str(src.name || 'Imported page', 120);
    res.status(201).json(summary(await db.createPage({ name, slug: await uniqueSlug(slugify(name)), doc: normalizeDoc(src.doc) })));
  }));
  api.get('/pages/:id', ah(async (req, res) => { const p = await db.getPage(req.params.id); p ? res.json(summary(p)) : res.status(404).json({ error: 'Not found' }); }));
  api.put('/pages/:id', ah(async (req, res) => {
    const { name, slug, status, doc, baseVersion, note } = req.body || {};
    const cleanName = str(name, 120).trim();
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });
    if (!validSlug(slug)) return res.status(400).json({ error: 'URL name must be lowercase letters, numbers and dashes' });
    if (!['draft', 'published'].includes(status)) return res.status(400).json({ error: 'Bad status' });
    try {
      const r = await db.savePage(req.params.id, { name: cleanName, slug, status, doc: normalizeDoc(doc) }, baseVersion, str(note, 100));
      if (r.missing) return res.status(404).json({ error: 'Not found' });
      if (r.conflict) return res.status(409).json({ error: 'This page was changed somewhere else. Reload to get the latest version.', current: summary(r.current) });
      res.json(summary(r.page));
    } catch (e) {
      if (e.code === 'UNIQUE' || /UNIQUE/i.test(e.message)) return res.status(409).json({ error: `The URL name “${slug}” is already used by another page.` });
      throw e;
    }
  }));
  api.delete('/pages/:id', ah(async (req, res) => { await db.deletePage(req.params.id); res.json({ ok: true }); }));
  api.post('/pages/:id/duplicate', ah(async (req, res) => {
    const src = await db.getPage(req.params.id);
    if (!src) return res.status(404).json({ error: 'Not found' });
    const name = str(req.body?.name || `${src.name} (copy)`, 120);
    const doc = structuredClone(src.doc);
    doc.theme.brandName = req.body?.name ? str(req.body.name, 80) : doc.theme.brandName;
    res.status(201).json(summary(await db.createPage({ name, slug: await uniqueSlug(slugify(req.body?.name || `${src.slug}-copy`)), doc })));
  }));
  api.get('/pages/:id/export', ah(async (req, res) => {
    const p = await db.getPage(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${p.slug}.spotlight.json"`);
    res.json({ format: 'spotlight-page', version: 1, name: p.name, exportedAt: new Date().toISOString(), doc: p.doc });
  }));
  api.get('/pages/:id/revisions', ah(async (req, res) => res.json(await db.revisions(req.params.id))));
  api.post('/pages/:id/revisions/:rid/restore', ah(async (req, res) => {
    const page = await db.getPage(req.params.id), rev = await db.revision(req.params.id, Number(req.params.rid));
    if (!page || !rev) return res.status(404).json({ error: 'Not found' });
    const r = await db.savePage(page.id, { name: page.name, slug: page.slug, status: page.status, doc: normalizeDoc(rev.doc) }, null, 'Restored earlier version');
    res.json(summary(r.page));
  }));
  api.post('/sections/new', (req, res) => { const s = newSection(req.body?.type); s ? res.json(s) : res.status(400).json({ error: 'Unknown section type' }); });

  // ---- media ----
  api.get('/media', ah(async (req, res) => res.json(await Promise.all((await db.allMedia()).map(async m => ({ ...m, usedIn: await db.mediaUsage(m.url) }))))));
  api.post('/media', upload.array('files', 10), async (req, res) => {
    const out = [], errors = [];
    for (const f of req.files || []) {
      try {
        const fd = await fs.promises.open(f.path, 'r');
        const buf = Buffer.alloc(16); await fd.read(buf, 0, 16, 0); await fd.close();
        const type = sniff(buf);
        if (!type) { errors.push(`${f.originalname}: unsupported file type (use PNG, JPG, GIF, WebP, MP4, MOV or WebM)`); continue; }
        const stored = `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}.${type.ext}`;
        const saved = await store.save({ path: f.path, name: stored, mime: type.mime, size: f.size });
        out.push(await db.addMedia({ kind: type.kind, name: path.basename(f.originalname).slice(0, 120), mime: type.mime, size: f.size, url: saved.url, storageKey: saved.key }));
      } catch (e) {
        errors.push(`${f.originalname}: ${e.message}`);
      } finally { fs.promises.rm(f.path, { force: true }).catch(() => {}); }
    }
    res.status(out.length ? 201 : 400).json({ media: out, errors });
  });
  api.patch('/media/:id', ah(async (req, res) => { if (!await db.getMedia(req.params.id)) return res.status(404).json({ error: 'Not found' }); await db.setMediaAlt(req.params.id, str(req.body?.alt, 300)); res.json({ ok: true }); }));
  api.delete('/media/:id', ah(async (req, res) => {
    const m = await db.getMedia(req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    const usedIn = await db.mediaUsage(m.url);
    if (usedIn.length && req.query.force !== '1') return res.status(409).json({ error: 'In use', usedIn });
    await store.remove(m.storage_key).catch(e => console.error('storage remove failed:', e.message));
    await db.deleteMedia(m.id); res.json({ ok: true });
  }));

  // ---- errors ----
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof multer.MulterError) return res.status(413).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `File is larger than the ${Math.round(config.maxUploadBytes / 1048576)} MB limit` : err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Page is too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  app.use((req, res) => res.status(404).type('html').send(notFound()));

  // Resolves once the database is ready (and seeded, if empty). Callers that start listening should await it.
  app.locals.storage = store.name;
  app.locals.ready = db.ready.then(async () => {
    if (seed && await db.count() === 0) await db.createPage({ name: 'Acme Insights (sample)', slug: 'acme-insights', doc: starterDoc('Acme Insights') });
  });
  return app;
}

const notFound = () => `<!doctype html><meta charset=utf-8><title>Not found</title><link rel=stylesheet href=/assets/site.css><body class=index><main><div class=wrap><h1>Page not found</h1><p class=lead>It may be unpublished or the link may have changed. <a href="/">See all spotlights</a>.</p></div></main>`;

if (require.main === module) {
  const app = createApp();
  app.locals.ready.then(() => app.listen(config.port, () => {
    console.log(`Spotlight running on http://localhost:${config.port}  (admin: /admin, database: ${db.kind}, media: ${config.supabase.url ? 'supabase' : 'local disk'})`);
    if (db.kind === 'postgres' && app.locals.storage === 'local') console.warn('Note: pages are in Postgres but uploads are on local disk. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so media is stored off-box too.');
    if (config.generatedPassword) console.log(`ADMIN_PASSWORD not set. Temporary admin password for this run: ${config.adminPassword}`);
  })).catch(e => { console.error(`Could not start: ${e.message}`); process.exit(1); });
}
module.exports = { createApp, sniff, db };
