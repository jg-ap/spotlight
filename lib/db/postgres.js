// Postgres backend (Supabase or any Postgres). Tables live in their own `spotlight` schema, which Supabase does
// not expose through its public API, and have Row Level Security switched on with no policies as a second lock:
// only the server's direct database connection can read or write them.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const config = require('../config');

const uid = () => crypto.randomBytes(6).toString('hex');
const now = () => new Date().toISOString();
const S = 'spotlight';

const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS ${S};
CREATE TABLE IF NOT EXISTS ${S}.pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  doc JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ${S}.revisions (
  id SERIAL PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES ${S}.pages(id) ON DELETE CASCADE,
  doc JSONB NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS revisions_page_idx ON ${S}.revisions (page_id, id DESC);
CREATE TABLE IF NOT EXISTS ${S}.media (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  url TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
ALTER TABLE ${S}.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${S}.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${S}.media ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA ${S} FROM anon; REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM anon; REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${S} FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA ${S} FROM authenticated; REVOKE ALL ON ALL TABLES IN SCHEMA ${S} FROM authenticated; REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${S} FROM authenticated;
  END IF;
END $$;`;

// node-postgres lets a `sslmode` in the URL override the ssl option, so take it out and decide here.
function connection(urlString) {
  const u = new URL(urlString);
  const mode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  let ssl;
  if (mode === 'disable' || (local && !mode)) ssl = false;
  else if (config.databaseCa) ssl = { ca: config.databaseCa.includes('BEGIN CERTIFICATE') ? config.databaseCa : fs.readFileSync(config.databaseCa, 'utf8'), rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: false }; // encrypted, but the server certificate is not verified unless DATABASE_CA is set
  return { connectionString: u.toString(), ssl };
}

module.exports = urlString => {
  const pool = new Pool({ ...connection(urlString), max: 5, connectionTimeoutMillis: 10000 });
  pool.on('error', e => console.error('Postgres pool error:', e.message));

  async function tx(fn) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  const uniq = e => (e.code === '23505' ? Object.assign(new Error('UNIQUE constraint failed: slug'), { code: 'UNIQUE' }) : e);
  const toPage = r => r && { id: r.id, slug: r.slug, name: r.name, status: r.status, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, doc: r.doc };
  const q = (text, params) => pool.query(text, params);

  // Create tables on first run. The advisory lock keeps two starting instances from racing.
  const ready = tx(async c => { await c.query('SELECT pg_advisory_xact_lock(7318045)'); await c.query(MIGRATION); });

  return {
    kind: 'postgres', ready, close: () => pool.end(),

    async listPages() {
      const { rows } = await q(`SELECT id, slug, name, status, version, updated_at, jsonb_array_length(doc->'sections') AS sections,
        doc->'theme'->>'accent' AS accent, COALESCE(doc->'meta'->>'description', '') AS description FROM ${S}.pages ORDER BY updated_at DESC`);
      return rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, version: r.version, updatedAt: r.updated_at, sectionCount: r.sections, accent: r.accent, description: r.description }));
    },
    async getPage(id) { return toPage((await q(`SELECT * FROM ${S}.pages WHERE id = $1`, [id])).rows[0]); },
    async getPageBySlug(slug) { return toPage((await q(`SELECT * FROM ${S}.pages WHERE slug = $1`, [slug])).rows[0]); },

    async createPage({ name, slug, status = 'draft', doc }) {
      const id = uid(), t = now(), json = JSON.stringify(doc);
      try {
        await tx(async c => {
          await c.query(`INSERT INTO ${S}.pages (id, slug, name, status, doc, version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,1,$6,$6)`, [id, slug, name, status, json, t]);
          await c.query(`INSERT INTO ${S}.revisions (page_id, doc, note, created_at) VALUES ($1,$2::jsonb,'Created',$3)`, [id, json, t]);
        });
      } catch (e) { throw uniq(e); }
      return this.getPage(id);
    },

    // Returns {missing}, {conflict, current} or {page}. Row-locked so concurrent saves can't both pass the version check.
    async savePage(id, { name, slug, status, doc }, baseVersion, note) {
      const json = JSON.stringify(doc);
      try {
        return await tx(async c => {
          const cur = (await c.query(`SELECT *, (doc = $2::jsonb) AS same FROM ${S}.pages WHERE id = $1 FOR UPDATE`, [id, json])).rows[0];
          if (!cur) return { missing: true };
          if (baseVersion != null && cur.version !== baseVersion) return { conflict: true, current: toPage(cur) };
          await c.query(`UPDATE ${S}.pages SET slug=$1, name=$2, status=$3, doc=$4::jsonb, version=version+1, updated_at=$5 WHERE id=$6`, [slug, name, status, json, now(), id]);
          if (!cur.same) {
            await c.query(`INSERT INTO ${S}.revisions (page_id, doc, note, created_at) VALUES ($1,$2::jsonb,$3,$4)`, [id, json, note || null, now()]);
            await c.query(`DELETE FROM ${S}.revisions WHERE page_id = $1 AND id NOT IN (SELECT id FROM ${S}.revisions WHERE page_id = $1 ORDER BY id DESC LIMIT 40)`, [id]);
          }
          return { page: toPage((await c.query(`SELECT * FROM ${S}.pages WHERE id = $1`, [id])).rows[0]) };
        });
      } catch (e) { throw uniq(e); }
    },
    async deletePage(id) { await q(`DELETE FROM ${S}.pages WHERE id = $1`, [id]); },

    async revisions(id) {
      const { rows } = await q(`SELECT id, note, created_at, length(doc::text) AS size FROM ${S}.revisions WHERE page_id = $1 ORDER BY id DESC LIMIT 40`, [id]);
      return rows.map(r => ({ id: r.id, note: r.note, createdAt: r.created_at, size: r.size }));
    },
    async revision(id, rid) { const r = (await q(`SELECT id, doc FROM ${S}.revisions WHERE id = $1 AND page_id = $2`, [rid, id])).rows[0]; return r && { id: r.id, doc: r.doc }; },

    async allMedia() { return (await q(`SELECT * FROM ${S}.media ORDER BY created_at DESC`)).rows.map(r => ({ ...r, size: Number(r.size) })); },
    async getMedia(id) { const r = (await q(`SELECT * FROM ${S}.media WHERE id = $1`, [id])).rows[0]; return r && { ...r, size: Number(r.size) }; },
    async addMedia(m) {
      const id = uid();
      await q(`INSERT INTO ${S}.media (id, kind, name, mime, size, url, storage_key, alt, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, m.kind, m.name, m.mime, m.size, m.url, m.storageKey, m.alt || '', now()]);
      return this.getMedia(id);
    },
    async setMediaAlt(id, alt) { await q(`UPDATE ${S}.media SET alt = $1 WHERE id = $2`, [alt, id]); },
    async deleteMedia(id) { await q(`DELETE FROM ${S}.media WHERE id = $1`, [id]); },
    async mediaUsage(url) {
      const needle = JSON.stringify(url).slice(1, -1);
      const { rows } = await q(`SELECT id, name, doc::text AS t FROM ${S}.pages`);
      return rows.filter(p => p.t.includes(needle)).map(p => ({ id: p.id, name: p.name }));
    },
    async altMap() { const m = {}; for (const r of (await q(`SELECT url, alt FROM ${S}.media WHERE alt <> ''`)).rows) m[r.url] = r.alt; return m; },
    async count() { return Number((await q(`SELECT COUNT(*) AS c FROM ${S}.pages`)).rows[0].c); },
  };
};
