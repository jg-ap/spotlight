// Storage adapters for uploaded media. Both implement: save(file) -> {url, key}, remove(key).
// `file` = { path (temp file on disk), name (stored name), mime, size }.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const config = require('./config');

function local() {
  const dir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return {
    name: 'local',
    dir,
    async save(file) {
      await fs.promises.copyFile(file.path, path.join(dir, file.name));
      return { url: `/uploads/${file.name}`, key: file.name };
    },
    async remove(key) { await fs.promises.rm(path.join(dir, path.basename(key)), { force: true }); },
  };
}

function supabase({ url, key, bucket }) {
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  const enc = k => k.split('/').map(encodeURIComponent).join('/');
  let ready;
  const ensureBucket = () => ready ||= (async () => {
    const r = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    });
    // 200 = created; 400/409 = already exists
    if (!r.ok && ![400, 409].includes(r.status)) {
      ready = null;
      throw new Error(`Supabase bucket check failed (${r.status}): ${await r.text()}`);
    }
  })();
  return {
    name: 'supabase',
    async save(file) {
      await ensureBucket();
      const r = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${enc(file.name)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': file.mime, 'Content-Length': String(file.size), 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
        body: Readable.toWeb(fs.createReadStream(file.path)),
        duplex: 'half',
      });
      if (!r.ok) throw new Error(`Supabase upload failed (${r.status}): ${await r.text()}`);
      return { url: `${url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${enc(file.name)}`, key: file.name };
    },
    async remove(k) {
      const r = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${enc(k)}`, { method: 'DELETE', headers });
      if (!r.ok && r.status !== 404) throw new Error(`Supabase delete failed (${r.status})`);
    },
  };
}

module.exports = {
  local, supabase,
  create: () => (config.supabase.url && config.supabase.key) ? supabase(config.supabase) : local(),
};
