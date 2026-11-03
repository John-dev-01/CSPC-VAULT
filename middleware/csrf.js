const crypto = require('crypto');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validCsrfToken(req) {
  const submitted = (typeof req.body?._csrf === 'string' && req.body._csrf)
    || req.get('x-csrf-token')
    || '';
  return constantTimeEqual(submitted, req.session?.csrfToken || '');
}

function sameOrigin(req) {
  const supplied = req.get('origin') || req.get('referer');
  if (!supplied) return false;
  try {
    const origin = new URL(supplied);
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
    return origin.host.toLowerCase() === String(host || '').toLowerCase() && origin.protocol === `${protocol}:`;
  } catch { return false; }
}

function csrfProtection(req, res, next) {
  if (!req.session) return next(new Error('Session middleware must run before CSRF protection.'));
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  req.csrfToken = () => req.session.csrfToken;
  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method)) return next();
  if (req.is('multipart/form-data')) {
    if (!sameOrigin(req)) return res.status(403).send('Cross-origin upload blocked. Refresh the page and try again.');
    req.csrfBodyPending = true;
    return next();
  }
  if (!validCsrfToken(req)) {
    if (req.accepts('json')) return res.status(403).json({ error: 'Security token expired. Refresh the page and try again.' });
    return res.status(403).send(req.app.locals.page(req, 'Request blocked', '<h1>Request blocked</h1><p>Refresh the page and try again.</p>'));
  }
  next();
}

csrfProtection.validCsrfToken = validCsrfToken;
module.exports = csrfProtection;
