const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(dataDir, '.session-secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const production = process.env.NODE_ENV === 'production';
let adminPassword = process.env.ADMIN_PASSWORD || '';
let generatedPassword = false;
if (!adminPassword) {
  if (production) throw new Error('ADMIN_PASSWORD must be set in production');
  adminPassword = crypto.randomBytes(9).toString('base64url');
  generatedPassword = true;
}

const embedHosts = [
  'www.youtube.com', 'youtube.com', 'youtu.be', 'www.youtube-nocookie.com',
  'player.vimeo.com', 'vimeo.com', 'www.loom.com', 'loom.com',
  'web.microsoftstream.com', 'sharepoint.com', 'microsoftstream.com',
  ...(process.env.EMBED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
];

module.exports = {
  root, dataDir, production,
  port: Number(process.env.PORT) || 3000,
  siteTitle: process.env.SITE_TITLE || 'Product Spotlights',
  adminPassword, generatedPassword,
  sessionSecret: secret(),
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024,
  embedHosts,
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'spotlight-media',
  },
};
