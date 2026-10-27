const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spotlight-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'correct horse battery';
process.env.SUPABASE_URL = '';

const PG = !!process.env.DATABASE_URL; // run `npm run test:pg` to exercise the Postgres backend
let createApp, db, server, base, cookie;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const call = (p, { method = 'GET', body, headers = {}, raw } = {}) => fetch(base + p, {
  method, redirect: 'manual',
  headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'x-spotlight': '1' } : {}), ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
  body: raw ? body : body ? JSON.stringify(body) : undefined,
});
const json = async r => r.json();

before(async () => {
  if (PG) { // start from an empty schema
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    await c.query('DROP SCHEMA IF EXISTS spotlight CASCADE'); await c.end();
  }
  ({ createApp, db } = require('../server'));
  const app = createApp({ seed: false });
  await app.locals.ready;
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test(`backend is ${PG ? 'postgres' : 'sqlite'}`, async () => {
  assert.equal((await (await fetch(base + '/healthz')).json()).database, PG ? 'postgres' : 'sqlite');
});

test('auth: gate, wrong password, login, header requirement', async () => {
  assert.equal((await call('/api/pages')).status, 401);
  assert.equal((await call('/preview/x')).status, 401);
  const bad = await call('/api/login', { method: 'POST', body: { password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await call('/api/login', { method: 'POST', body: { password: 'correct horse battery' } });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await call('/api/pages')).status, 200);
  // mutation without the custom header is refused (cross-site form posts can't send it)
  const r = await fetch(base + '/api/pages', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(r.status, 403);
});

let page;
test('create from starter, publish, serve publicly; drafts are hidden', async () => {
  const r = await call('/api/pages', { method: 'POST', body: { name: 'Atlas' } });
  assert.equal(r.status, 201);
  page = await json(r);
  assert.equal(page.slug, 'atlas');
  assert.equal(page.status, 'draft');
  assert.equal(page.doc.sections.length, 10);

  const anon = await fetch(`${base}/p/atlas`);
  assert.equal(anon.status, 404, 'draft hidden from the public');
  assert.equal((await call('/p/atlas')).status, 200, 'draft visible to admin');

  const put = await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, status: 'published', baseVersion: page.version } });
  assert.equal(put.status, 200);
  page = await json(put);
  const pub = await fetch(`${base}/p/atlas`);
  assert.equal(pub.status, 200);
  const html = await pub.text();
  assert.match(html, /<h1>/);
  assert.match(pub.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await (await fetch(base + '/')).text(), /Atlas/);
});

test('optimistic concurrency and slug uniqueness', async () => {
  const stale = await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, baseVersion: page.version - 1 } });
  assert.equal(stale.status, 409);
  const dup = await json(await call(`/api/pages/${page.id}/duplicate`, { method: 'POST', body: {} }));
  assert.equal(dup.status, 'draft');
  assert.notEqual(dup.slug, page.slug);
  const clash = await call(`/api/pages/${dup.id}`, { method: 'PUT', body: { ...dup, slug: 'atlas', baseVersion: dup.version } });
  assert.equal(clash.status, 409);
  const reserved = await call(`/api/pages/${dup.id}`, { method: 'PUT', body: { ...dup, slug: 'admin', baseVersion: dup.version } });
  assert.equal(reserved.status, 400);
  await call(`/api/pages/${dup.id}`, { method: 'DELETE' });
});

test('rendering: escapes HTML, drops unsafe URLs, honours order and enabled flag', async () => {
  const doc = structuredClone(page.doc);
  const [hero, ...rest] = doc.sections;
  hero.props.headline = '<script>alert(1)</script> & "quotes"';
  hero.props.primaryUrl = 'javascript:alert(1)';
  hero.props.mediaType = 'embed'; hero.props.embedUrl = 'https://evil.example/x';
  const faq = rest.find(s => s.type === 'faq'); faq.props.items = [{ q: 'Q?', a: 'ok [bad](javascript:alert(1)) **bold**' }];
  const features = rest.find(s => s.type === 'features'); features.enabled = false;
  doc.sections = [rest.find(s => s.type === 'faq'), hero, ...rest.filter(s => !['faq'].includes(s.type))];
  const saved = await json(await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, doc, baseVersion: page.version } }));
  page = saved;
  const html = await (await fetch(`${base}/p/atlas`)).text();
  assert.ok(!html.includes('<script>alert(1)'), 'script escaped');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link dropped');
  assert.ok(!html.includes('evil.example'), 'unlisted embed host dropped');
  assert.ok(!html.includes('id="' + features.id + '"'), 'disabled section not rendered');
  assert.ok(html.indexOf('class="sec sec-faq') < html.indexOf('class="sec sec-hero'), 'faq now before hero');
});

test('uploads: accepts real images, rejects disguised files, blocks delete while in use', async () => {
  const fd = new FormData();
  fd.append('files', new Blob([PNG], { type: 'image/png' }), 'shot.png');
  fd.append('files', new Blob([Buffer.from('MZ\x90\x00 not an image at all')], { type: 'image/png' }), 'evil.png');
  const r = await call('/api/media', { method: 'POST', body: fd, raw: true });
  const out = await json(r);
  assert.equal(r.status, 201);
  assert.equal(out.media.length, 1);
  assert.equal(out.errors.length, 1);
  const m = out.media[0];
  assert.equal(m.kind, 'image');
  assert.match(m.url, /^\/uploads\/.+\.png$/);
  const file = await fetch(base + m.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');

  const doc = structuredClone(page.doc);
  const richtext = { id: 'sabcdef1', type: 'richtext', enabled: true, settings: { bg: 'white', navLabel: '' }, props: { heading: 'Pic', body: 'x', layout: 'media-right', mediaType: 'image', image: m.url } };
  doc.sections.push(richtext);
  page = await json(await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, doc, baseVersion: page.version } }));
  await call(`/api/media/${m.id}`, { method: 'PATCH', body: { alt: 'A tiny test pixel' } });
  assert.match(await (await fetch(`${base}/p/atlas`)).text(), /alt="A tiny test pixel"/);

  const del = await call(`/api/media/${m.id}`, { method: 'DELETE' });
  assert.equal(del.status, 409);
  assert.equal((await json(del)).usedIn[0].id, page.id);
  assert.equal((await call(`/api/media/${m.id}?force=1`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(base + m.url)).status, 404);
});

test('normalizer strips unknown fields and bad colours', async () => {
  const r = await json(await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, baseVersion: page.version,
    doc: { theme: { primary: 'red', accent: '#5C5D8D', evil: 1 }, sections: [{ type: 'nope' }, { type: 'faq', props: { items: 'x', bogus: 1 } }] } } }));
  assert.equal(r.doc.theme.primary, '#55AA31');
  assert.equal(r.doc.theme.accent, '#5C5D8D');
  assert.equal(r.doc.theme.evil, undefined);
  assert.equal(r.doc.sections.length, 1);
  assert.equal(r.doc.sections[0].props.bogus, undefined);
  page = r;
});

test('revisions list and restore', async () => {
  const revs = await json(await call(`/api/pages/${page.id}/revisions`));
  assert.ok(revs.length >= 3);
  const oldest = revs[revs.length - 1];
  const restored = await json(await call(`/api/pages/${page.id}/revisions/${oldest.id}/restore`, { method: 'POST' }));
  assert.equal(restored.doc.sections.length, 10);
});

test('export / import round trip', async () => {
  const exp = await json(await call(`/api/pages/${page.id}/export`));
  assert.equal(exp.format, 'spotlight-page');
  const imp = await call('/api/pages/import', { method: 'POST', body: { page: exp } });
  assert.equal(imp.status, 201);
  assert.equal((await call('/api/pages/import', { method: 'POST', body: { page: { format: 'other' } } })).status, 400);
});

test('contrast helper keeps Bright Fern text readable on light backgrounds', () => {
  const C = require('../lib/color');
  assert.ok(C.contrast('#55AA31', '#F0FFF1') < 3, 'raw fern is too light for body-size text');
  assert.ok(C.contrast(C.ensureContrast('#55AA31', '#F0FFF1', 4.8), '#F0FFF1') >= 4.8);
  assert.equal(C.onColor('#55AA31'), '#14200f', 'dark text on fern buttons');
  assert.equal(C.onColor('#654F6F'), '#ffffff', 'white text on Vintage Grape');
  assert.equal(C.onColor('#99A1A6'), '#14200f', 'dark text on Cool Steel');
});

test('supabase adapter talks to Storage API correctly (mock server)', async () => {
  const seen = [];
  const mock = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], len: Buffer.concat(chunks).length });
      res.writeHead(req.url.endsWith('/bucket') && seen.filter(s => s.url.endsWith('/bucket')).length > 1 ? 409 : 200, { 'content-type': 'application/json' }); res.end('{}'); });
  }).listen(0);
  await new Promise(r => mock.once('listening', r));
  const { supabase } = require('../lib/storage');
  const s = supabase({ url: `http://127.0.0.1:${mock.address().port}`, key: 'service-key', bucket: 'media' });
  const f = path.join(tmp, 'up.png'); fs.writeFileSync(f, PNG);
  const out = await s.save({ path: f, name: 'a b.png', mime: 'image/png', size: PNG.length });
  assert.match(out.url, /\/storage\/v1\/object\/public\/media\/a%20b\.png$/);
  const up = seen.find(x => x.url.includes('/object/media/'));
  assert.equal(up.method, 'POST'); assert.equal(up.auth, 'Bearer service-key'); assert.equal(up.type, 'image/png'); assert.equal(up.len, PNG.length);
  assert.ok(seen.some(x => x.url === '/storage/v1/bucket'), 'bucket ensured');
  await s.remove(out.key);
  assert.equal(seen.at(-1).method, 'DELETE');
  mock.close();
});

test('a gallery with no media is left off the live page but shown in preview', async () => {
  page = await json(await call(`/api/pages/${page.id}`)); // earlier tests bumped the version
  const doc = structuredClone(page.doc);
  doc.sections = [{ id: 'sgal00001', type: 'gallery', enabled: true, settings: { bg: 'white', navLabel: '' }, props: { heading: 'Gallery heading', items: [{ caption: 'Empty', mediaType: 'image', image: '' }] } }];
  const put = await call(`/api/pages/${page.id}`, { method: 'PUT', body: { ...page, status: 'published', doc, baseVersion: page.version } });
  assert.equal(put.status, 200);
  page = await json(put);
  const liveRes = await fetch(`${base}/p/${page.slug}`);
  assert.equal(liveRes.status, 200);
  const live = await liveRes.text();
  assert.ok(!live.includes('Gallery heading'), 'empty gallery hidden from the public');
  const pv = await (await call(`/preview/${page.id}`)).text();
  assert.ok(pv.includes('Gallery heading'), 'still visible in the editor preview');
});

test('concurrent saves with the same base version: exactly one wins', async () => {
  const p = await json(await call('/api/pages', { method: 'POST', body: { name: 'Race' } }));
  const put = n => call(`/api/pages/${p.id}`, { method: 'PUT', body: { ...p, name: `Race ${n}`, baseVersion: p.version } });
  const codes = (await Promise.all([put(1), put(2), put(3)])).map(r => r.status).sort();
  assert.deepEqual(codes, [200, 409, 409]);
});

test('pages can be read straight back out of the database', async () => {
  const list = await json(await call('/api/pages'));
  assert.ok(list.length >= 2);
  const first = await db.getPage(list[0].id);
  assert.ok(first.doc.sections && first.version >= 1);
});

test('index page lists published pages with their description', async () => {
  const p = await json(await call('/api/pages', { method: 'POST', body: { name: 'Listed Page' } }));
  const doc = structuredClone(p.doc); doc.meta.description = 'Shown on the index card';
  await call(`/api/pages/${p.id}`, { method: 'PUT', body: { ...p, status: 'published', doc, baseVersion: p.version } });
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /Listed Page/);
  assert.match(html, /Shown on the index card/);
});

test('postgres: private schema, RLS on, anon has no access, migration is idempotent and race-safe', { skip: !PG }, async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  try {
    const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'spotlight'::regnamespace AND relkind = 'r' ORDER BY 1`)).rows;
    assert.deepEqual(rls.map(r => r.relname), ['media', 'pages', 'revisions']);
    assert.ok(rls.every(r => r.relrowsecurity), 'row level security is enabled on every table');
    await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$`);
    const mk = require('../lib/db/postgres');
    await Promise.all([mk(process.env.DATABASE_URL), mk(process.env.DATABASE_URL), mk(process.env.DATABASE_URL)].map(async d => { await d.ready; await d.close(); }));
    const priv = (await c.query(`SELECT has_schema_privilege('anon','spotlight','USAGE') AS usage, has_table_privilege('anon','spotlight.pages','SELECT') AS sel`)).rows[0];
    assert.equal(priv.usage, false); assert.equal(priv.sel, false);
    const exposed = (await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('pages','revisions','media')`)).rows[0].n;
    assert.equal(exposed, 0, 'nothing is created in the public schema that Supabase exposes');
  } finally { await c.end(); }
});
