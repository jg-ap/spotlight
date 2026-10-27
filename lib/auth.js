const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'spot_admin';
const TTL = 12 * 60 * 60 * 1000;
const sign = v => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const attempts = new Map(); // ip -> {n, reset}
function rateLimited(ip) {
  const t = Date.now(), a = attempts.get(ip);
  if (!a || a.reset < t) return false;
  return a.n >= 10;
}
function noteFailure(ip) {
  const t = Date.now(), a = attempts.get(ip);
  if (!a || a.reset < t) attempts.set(ip, { n: 1, reset: t + 15 * 60 * 1000 });
  else a.n++;
}

function issue(res) {
  const exp = String(Date.now() + TTL);
  const val = `${exp}.${sign(exp)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL / 1000}${config.production ? '; Secure' : ''}`);
}
const clear = res => res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
function isAdmin(req) {
  const v = parseCookies(req)[COOKIE];
  if (!v) return false;
  const [exp, sig] = v.split('.');
  return !!sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now();
}

module.exports = {
  isAdmin, issue, clear, rateLimited, noteFailure,
  checkPassword: p => safeEq(p || '', config.adminPassword),
  // Gate for /api and /preview. Mutations also need the custom header, which a cross-site form post can't send.
  require(req, res, next) {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Not signed in' });
    if (req.method !== 'GET' && req.get('x-spotlight') !== '1') return res.status(403).json({ error: 'Missing header' });
    next();
  },
};
