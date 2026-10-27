const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const db = new DatabaseSync(path.join(config.dataDir, 'spotlight.db'));
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  doc TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  doc TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  url TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);
db.exec('PRAGMA foreign_keys = ON');

const now = () => new Date().toISOString();
const uid = () => crypto.randomBytes(6).toString('hex');
const parseRow = r => r && { id: r.id, slug: r.slug, name: r.name, status: r.status, version: r.version,
  createdAt: r.created_at, updatedAt: r.updated_at, doc: JSON.parse(r.doc) };

const q = {
  list: db.prepare('SELECT id, slug, name, status, version, updated_at, doc FROM pages ORDER BY updated_at DESC'),
  byId: db.prepare('SELECT * FROM pages WHERE id = ?'),
  bySlug: db.prepare('SELECT * FROM pages WHERE slug = ?'),
  insert: db.prepare('INSERT INTO pages (id, slug, name, status, doc, version, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)'),
  update: db.prepare('UPDATE pages SET slug=?, name=?, status=?, doc=?, version=version+1, updated_at=? WHERE id=?'),
  del: db.prepare('DELETE FROM pages WHERE id = ?'),
  revInsert: db.prepare('INSERT INTO revisions (page_id, doc, note, created_at) VALUES (?,?,?,?)'),
  revList: db.prepare('SELECT id, note, created_at, length(doc) AS size FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 40'),
  revGet: db.prepare('SELECT * FROM revisions WHERE id = ? AND page_id = ?'),
  revPrune: db.prepare('DELETE FROM revisions WHERE page_id = ? AND id NOT IN (SELECT id FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 40)'),
  mediaList: db.prepare('SELECT * FROM media ORDER BY created_at DESC'),
  mediaGet: db.prepare('SELECT * FROM media WHERE id = ?'),
  mediaInsert: db.prepare('INSERT INTO media (id, kind, name, mime, size, url, storage_key, alt, created_at) VALUES (?,?,?,?,?,?,?,?,?)'),
  mediaAlt: db.prepare('UPDATE media SET alt = ? WHERE id = ?'),
  mediaDel: db.prepare('DELETE FROM media WHERE id = ?'),
  pagesDocs: db.prepare('SELECT id, name, doc FROM pages'),
};

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = {
  uid, now,
  listPages: () => q.list.all().map(r => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, version: r.version,
    updatedAt: r.updated_at, sectionCount: JSON.parse(r.doc).sections.length, accent: JSON.parse(r.doc).theme?.accent })),
  getPage: id => parseRow(q.byId.get(id)),
  getPageBySlug: slug => parseRow(q.bySlug.get(slug)),
  createPage({ name, slug, status = 'draft', doc }) {
    const id = uid(), t = now();
    q.insert.run(id, slug, name, status, JSON.stringify(doc), t, t);
    q.revInsert.run(id, JSON.stringify(doc), 'Created', t);
    return module.exports.getPage(id);
  },
  // Returns {conflict:true} when baseVersion is stale.
  savePage(id, { name, slug, status, doc }, baseVersion, note) {
    return tx(() => {
      const cur = q.byId.get(id);
      if (!cur) return { missing: true };
      if (baseVersion != null && cur.version !== baseVersion) return { conflict: true, current: parseRow(cur) };
      const json = JSON.stringify(doc);
      q.update.run(slug, name, status, json, now(), id);
      if (json !== cur.doc) {
        q.revInsert.run(id, json, note || null, now());
        q.revPrune.run(id, id);
      }
      return { page: module.exports.getPage(id) };
    });
  },
  deletePage: id => q.del.run(id),
  revisions: id => q.revList.all(id).map(r => ({ id: r.id, note: r.note, createdAt: r.created_at, size: r.size })),
  revision: (id, rid) => { const r = q.revGet.get(rid, id); return r && { id: r.id, doc: JSON.parse(r.doc) }; },
  allMedia: () => q.mediaList.all(),
  getMedia: id => q.mediaGet.get(id),
  addMedia(m) { const id = uid(); q.mediaInsert.run(id, m.kind, m.name, m.mime, m.size, m.url, m.storageKey, m.alt || '', now()); return q.mediaGet.get(id); },
  setMediaAlt: (id, alt) => q.mediaAlt.run(alt, id),
  deleteMedia: id => q.mediaDel.run(id),
  mediaUsage(url) { return q.pagesDocs.all().filter(p => p.doc.includes(JSON.stringify(url).slice(1, -1))).map(p => ({ id: p.id, name: p.name })); },
  altMap() { const m = {}; for (const r of q.mediaList.all()) if (r.alt) m[r.url] = r.alt; return m; },
  count: () => db.prepare('SELECT COUNT(*) c FROM pages').get().c,
};
