const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const CSPC_DOMAIN = '@my.cspc.edu.ph';
const isConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function redirectUri(req) {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const base = String(process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).trim();
  return new URL('/auth/google/callback', base).toString();
}

function client(req) {
  if (!isConfigured()) return null;
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri(req));
}

function createState() {
  return crypto.randomBytes(32).toString('base64url');
}

function authorizationUrl(req, state) {
  const oauth = client(req);
  if (!oauth) return '';
  return oauth.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    include_granted_scopes: true,
    state,
    hd: 'my.cspc.edu.ph',
    prompt: 'select_account',
  });
}

async function verifyCode(req, code) {
  const oauth = client(req);
  if (!oauth) throw new Error('Google sign-in is not configured.');
  const { tokens } = await oauth.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an identity token.');
  const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  const email = String(payload?.email || '').trim().toLowerCase();
  if (!payload?.sub || !payload?.email_verified || !/^[^\s@]+@my\.cspc\.edu\.ph$/.test(email)) {
    throw new Error(`Use a verified ${CSPC_DOMAIN} Google account.`);
  }
  return {
    googleSub: String(payload.sub),
    email,
    name: String(payload.name || payload.given_name || email.split('@')[0]).trim().slice(0, 120),
    avatarUrl: typeof payload.picture === 'string' ? payload.picture.slice(0, 1000) : '',
  };
}

module.exports = { CSPC_DOMAIN, isConfigured, redirectUri, createState, authorizationUrl, verifyCode };
