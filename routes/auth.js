const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../middleware/db');
const { esc } = require('../middleware/views');
const { passwordPolicyError } = require('../middleware/password-policy');
const { sendVerificationLink, sendPasswordResetLink } = require('../middleware/email');
const googleAuth = require('../middleware/google-auth');
const router = express.Router();

const LINK_LIFETIME_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_EMAILS_PER_ADDRESS = 5;
const MAX_EMAILS_PER_IP = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES_PER_EMAIL = 5;
const MAX_LOGIN_FAILURES_PER_IP = 30;
const PASSWORD_RESET_LIFETIME_MS = 20 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PASSWORD_RESET_EMAILS = 5;
const MAX_PASSWORD_RESET_IP_REQUESTS = 20;
const CSPC_DOMAIN = '@my.cspc.edu.ph';
const isCspcEmail = email => typeof email === 'string' && /^[^\s@]+@my\.cspc\.edu\.ph$/i.test(email.trim());
const normalizeEmail = email => String(email || '').trim().toLowerCase();
const getDepartments = () => require('../middleware/departments');
const ipOf = req => String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
const developmentVerificationSecret = crypto.randomBytes(32).toString('hex');
const verificationSecret = () => process.env.VERIFICATION_CODE_SECRET || process.env.SESSION_SECRET || developmentVerificationSecret;
const hashVerificationToken = token => crypto.createHmac('sha256', verificationSecret()).update(token).digest('hex');

function createVerificationUrl(req, token) {
  const configuredBase = String(process.env.APP_BASE_URL || '').trim();
  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const requestBase = `${protocol}://${req.get('host')}`;
  const parsed = new URL(configuredBase || requestBase);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('APP_BASE_URL must be a valid HTTP(S) origin.');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
  return new URL(`/verify-email?token=${encodeURIComponent(token)}`, parsed.origin).toString();
}

function createPasswordResetUrl(req, token) {
  const configuredBase = String(process.env.APP_BASE_URL || '').trim();
  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProtocol || req.protocol;
  const requestBase = `${protocol}://${req.get('host')}`;
  const parsed = new URL(configuredBase || requestBase);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('APP_BASE_URL must be a valid HTTP(S) origin.');
  }
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production.');
  }
  return new URL(`/reset-password?token=${encodeURIComponent(token)}`, parsed.origin).toString();
}

function passwordField(label, id, name, autocomplete) {
  const constraints = autocomplete === 'new-password' ? 'minlength="12" maxlength="72"' : 'maxlength="72"';
  const fieldLabel = label.toLowerCase();
  return `<div class="auth-password-group">
    <div class="auth-password-field">
      <input id="${id}" type="password" name="${name}" autocomplete="${autocomplete}" aria-label="${esc(label)}" placeholder="${esc(label)}" required ${constraints}>
      <button class="password-toggle" type="button" data-password-toggle data-field-label="${esc(fieldLabel)}" aria-label="Show ${esc(fieldLabel)}" aria-pressed="false" title="Show ${esc(fieldLabel)}">
        <svg data-icon-show viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
        <svg data-icon-hide viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a15 15 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4-.8"/></svg>
      </button>
    </div>
  </div>`;
}

function departmentSelect(departments, selected = '') {
  const selectedLabel = departments.includes(selected) ? selected : 'Select your college / campus';
  return `<div class="department-select${selected ? ' has-value' : ''}" data-department-select data-required-selection>
    <input type="hidden" name="department" value="${esc(selected)}" data-department-value>
    <button class="department-select-trigger" type="button" data-department-trigger role="combobox" aria-label="Select your college or campus" aria-haspopup="listbox" aria-expanded="false" aria-controls="department-options" aria-required="true"><span data-department-label>${esc(selectedLabel)}</span><span class="department-select-chevron" aria-hidden="true"></span></button>
    <div class="department-select-menu" id="department-options" data-department-options role="listbox" aria-label="Colleges" hidden>${departments.map(name => `<button type="button" class="department-option" data-department-option data-value="${esc(name)}" role="option" aria-selected="${selected === name ? 'true' : 'false'}">${esc(name)}</button>`).join('')}</div>
    <span class="department-error" data-department-error hidden>Please choose a college or campus.</span>
  </div>`;
}

const authWelcomeLogo = `<span class="auth-welcome-logo" aria-hidden="true"><svg class="auth-logo-svg" viewBox="0 0 48 48"><path class="orbit" d="M24 4a20 20 0 1 1-14.14 5.86"/><path class="orbit orbit-secondary" d="M24 10a14 14 0 1 1-9.9 4.1"/><path class="core" d="m24 13 11 6.35v12.3L24 38l-11-6.35v-12.3z"/><path class="core-lines" d="M24 13v12.5m11-6.15-11 6.15-11-6.15"/></svg></span>`;

function form(kind, error = '', v = {}) {
  const departments = getDepartments();
  const escapedDepartments = JSON.stringify(departments).replace(/</g, '\\u003c');
  const googleButton = kind === 'login' && googleAuth.isConfigured() ? '<div class="auth-divider"><span>or</span></div><a class="google-sign-in" href="/auth/google"><span class="google-g-mark" aria-hidden="true">G</span><span>Continue with Google</span></a>' : '';
  return `<div class="auth-shell ${kind === 'login' ? 'login-mode' : 'register-mode'}" data-auth-mode="${kind}" data-google-enabled="${googleAuth.isConfigured() ? 'true' : 'false'}" data-departments='${esc(escapedDepartments)}'>
  <section class="auth-form-panel"><div class="auth-form-area">
    <div class="auth-welcome">${authWelcomeLogo}</div>
    <div class="auth-form-main">
    <div class="auth-kicker">${kind === 'login' ? 'Sign in' : 'Create account'}</div><h1>${kind === 'login' ? 'Sign in' : 'Create account'}</h1>
    <p class="auth-form-copy">${kind === 'login' ? 'Access your department equipment library and track your requests.' : 'Verify your CSPC email to create a borrower account.'}</p>
    ${error ? `<p class="flash error">${esc(error)}</p>` : ''}
    <form method="post" class="auth-card">
      ${kind === 'register' ? `<label>Full name<input name="name" autocomplete="name" placeholder="Name" required maxlength="120" value="${esc(v.name)}"></label>` : ''}
      <label>CSPC email<input type="email" name="email" autocomplete="email" placeholder="CSPC email" required value="${esc(v.email)}"${kind === 'register' ? ' pattern="[^@\\s]+@my\\.cspc\\.edu\\.ph" title="Use your @my.cspc.edu.ph email address"' : ''}></label>
      ${kind === 'register' ? `<label>College / campus${departmentSelect(departments, v.department)}</label>` : ''}
      ${passwordField('Password', 'auth-password', 'password', kind === 'login' ? 'current-password' : 'new-password')}
      ${kind === 'register' ? passwordField('Confirm password', 'auth-password-confirm', 'password_confirm', 'new-password') : ''}
      ${kind === 'register' ? '<p class="field-note">Use at least 12 characters with uppercase, lowercase, a number, and a symbol. We will email you a verification link.</p>' : ''}
      <button>${kind === 'login' ? 'Sign in' : 'Email verification link'}</button>
    </form>
    ${googleButton}
    ${kind === 'login' ? '<p class="auth-forgot"><a href="/forgot-password">Forgot password?</a></p>' : ''}
    </div>
    <p class="auth-switch">${kind === 'login' ? 'New to Vault?' : 'Already have an account?'} <a href="/${kind === 'login' ? 'register' : 'login'}" data-auth-switch>${kind === 'login' ? 'Create an account' : 'Sign in'}</a></p>
  </div></section>
  <section class="auth-art-panel" aria-label="Monochrome CSPC campus halftone artwork"><canvas class="auth-art-canvas" data-dot-canvas aria-label="CSPC campus image rendered as halftone dots"></canvas></section>
</div>`;
}

function forgotPasswordForm(error = '', email = '') {
  return `<section class="auth-form-area recovery-area"><span class="auth-kicker">ACCOUNT RECOVERY</span><h1>Forgot password?</h1>
    <p>Enter your CSPC email and, if an account exists, we will send a secure password reset link.</p>
    ${error ? `<p class="flash error">${esc(error)}</p>` : ''}
    <form method="post" action="/forgot-password" class="auth-card"><label>CSPC email<input type="email" name="email" autocomplete="email" placeholder="CSPC email" required value="${esc(email)}" pattern="[^@\s]+@my\.cspc\.edu\.ph" title="Use your @my.cspc.edu.ph email address"></label><button>Send reset link</button></form>
    <p class="auth-switch"><a href="/login">Back to sign in</a></p>
  </section>`;
}

function resetLinkSentForm(email) {
  return `<section class="auth-form-area recovery-area"><span class="auth-kicker">ACCOUNT RECOVERY</span><h1>Check your email</h1>
    <p>If an account exists for <strong>${esc(email)}</strong>, a password reset link has been sent. The link expires in 20 minutes.</p>
    <p class="auth-switch"><a href="/login">Back to sign in</a></p>
  </section>`;
}

function resetPasswordForm(token, error = '') {
  return `<section class="auth-form-area recovery-area"><span class="auth-kicker">ACCOUNT RECOVERY</span><h1>Set a new password</h1>
    <p>Choose a new password for your account.</p>
    ${error ? `<p class="flash error">${esc(error)}</p>` : ''}
    <form method="post" action="/reset-password" class="auth-card"><input type="hidden" name="token" value="${esc(token)}">${passwordField('New password','reset-password','password','new-password')}${passwordField('Confirm new password','reset-password-confirm','password_confirm','new-password')}<button>Update password</button></form>
    <p class="auth-switch"><a href="/login">Back to sign in</a></p>
  </section>`;
}

function invalidResetLink(message = 'This password reset link is invalid or expired. Please request a new one.') {
  return `<section class="auth-form-area recovery-area"><span class="auth-kicker">ACCOUNT RECOVERY</span><h1>Link unavailable</h1><p>${esc(message)}</p><p><a href="/forgot-password">Request another reset link</a></p></section>`;
}

function verificationPendingForm(email, message = '') {
  return `<section class="auth-form-area verification-area"><span class="auth-kicker">CHECK YOUR EMAIL</span><h1>Verification link sent</h1>
    <p>If an email was sent, open the verification link delivered to <strong>${esc(email)}</strong>. Opening it verifies your account and takes you to Sign in. The link expires in 10 minutes.</p>
    ${message ? `<p class="flash error">${esc(message)}</p>` : ''}
    <form method="post" action="/register/resend"><button class="link">Send a new link</button></form>
    <p class="field-note">For a local demo without working Gmail, check the server console for the verification link.</p>
  </section>`;
}

function verificationConfirmForm(token, message = '') {
  return `<section class="auth-form-area verification-area"><span class="auth-kicker">EMAIL CHECK</span><h1>Verifying your email</h1>
    <p role="status" aria-live="polite">Please wait. Your email is being verified, then you will be redirected to Sign in.</p>
    ${message ? `<p class="flash error">${esc(message)}</p>` : ''}
    <form method="post" action="/verify-email" class="auth-card" id="verify-email-form"><input type="hidden" name="token" value="${esc(token)}"><noscript><button>Continue to Sign in</button></noscript></form>
    <script>document.getElementById('verify-email-form')?.requestSubmit();</script>
  </section>`;
}

function invalidVerificationLink(message = 'This verification link is invalid or expired. Please register again.') {
  return `<section class="auth-form-area verification-area"><span class="auth-kicker">EMAIL CHECK</span><h1>Link unavailable</h1><p>${esc(message)}</p><p><a href="/register">Return to registration</a></p></section>`;
}

function sendLimitError(email, ip, pending) {
  const now = Date.now();
  if (pending && now - pending.last_sent_at < RESEND_COOLDOWN_MS) return 'Please wait about 60 seconds before requesting another verification link.';
  db.prepare('DELETE FROM verification_email_sends WHERE sent_at < ?').run(now - RATE_WINDOW_MS);
  const byEmail = db.prepare('SELECT COUNT(*) AS n FROM verification_email_sends WHERE email = ? AND sent_at >= ?').get(email, now - RATE_WINDOW_MS).n;
  const byIp = db.prepare('SELECT COUNT(*) AS n FROM verification_email_sends WHERE ip = ? AND sent_at >= ?').get(ip, now - RATE_WINDOW_MS).n;
  if (byEmail >= MAX_EMAILS_PER_ADDRESS) return 'Too many verification emails were sent to this address. Try again in about an hour.';
  if (byIp >= MAX_EMAILS_PER_IP) return 'Too many verification emails were requested from this network. Try again later.';
  return '';
}

async function issueVerificationLink(req, email, details) {
  const ip = ipOf(req);
  const now = Date.now();
  const existing = db.prepare('SELECT last_sent_at FROM pending_registrations WHERE email = ?').get(email);
  const error = sendLimitError(email, ip, existing);
  if (error) return { error };
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashVerificationToken(token);
  db.prepare(`INSERT INTO pending_registrations (email,name,password_hash,department,code_hash,token_hash,expires_at,attempts,last_sent_at,last_ip,created_at)
    VALUES (@email,@name,@password_hash,@department,'',@token_hash,@expires_at,0,@last_sent_at,@last_ip,@created_at)
    ON CONFLICT(email) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,department=excluded.department,
    code_hash='',token_hash=excluded.token_hash,expires_at=excluded.expires_at,attempts=0,last_sent_at=excluded.last_sent_at,last_ip=excluded.last_ip,created_at=excluded.created_at`)
    .run({ email, ...details, token_hash: tokenHash, expires_at: now + LINK_LIFETIME_MS, last_sent_at: now, last_ip: ip, created_at: now });
  db.prepare('INSERT INTO verification_email_sends (email,ip,sent_at) VALUES (?,?,?)').run(email, ip, now);
  req.session.pendingRegistrationEmail = email;
  const link = createVerificationUrl(req, token);
  const delivery = await sendVerificationLink(email, link);
  return { error: '', fallback: delivery.fallback };
}

function isLoginLimited(email, ip) {
  const now = Date.now();
  db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(now - LOGIN_WINDOW_MS);
  const byEmail = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND attempted_at >= ?').get(email, now - LOGIN_WINDOW_MS).n;
  const byIp = db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at >= ?').get(ip, now - LOGIN_WINDOW_MS).n;
  return byEmail >= MAX_LOGIN_FAILURES_PER_EMAIL || byIp >= MAX_LOGIN_FAILURES_PER_IP;
}

function startSession(req, res, user, next) {
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role,
      department: user.department, admin_scope: user.admin_scope || 'system', must_change_password: Boolean(user.must_change_password), avatar_url: user.avatar_url || '' };
    req.session.cookie.expires = false;
    req.session.save(saveErr => {
      if (saveErr) return next(saveErr);
      const destination = user.must_change_password ? '/change-password' : user.role !== 'admin' ? '/equipment' : user.admin_scope === 'system' ? '/admin/department-admins' : '/admin/dashboard';
      res.redirect(destination);
    });
  });
}

router.get('/auth/google', (req, res) => {
  if (!googleAuth.isConfigured()) return res.status(503).send(req.app.locals.page(req, 'Google sign-in unavailable', form('login', 'Google sign-in is not configured yet. Use email and password for now.')));
  const state = googleAuth.createState();
  req.session.googleOAuthState = state;
  req.session.googleOAuthStateCreatedAt = Date.now();
  res.redirect(googleAuth.authorizationUrl(req, state));
});

router.get('/auth/google/callback', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const expectedState = req.session.googleOAuthState;
    const stateCreatedAt = Number(req.session.googleOAuthStateCreatedAt || 0);
    delete req.session.googleOAuthState;
    delete req.session.googleOAuthStateCreatedAt;
    if (!state || !expectedState || state.length !== expectedState.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState)) || Date.now() - stateCreatedAt > 10 * 60 * 1000) {
      return res.status(400).send(req.app.locals.page(req, 'Google sign-in failed', form('login', 'The Google sign-in session expired. Please try again.')));
    }
    if (!code) return res.status(400).send(req.app.locals.page(req, 'Google sign-in failed', form('login', 'Google did not complete the sign-in request. Please try again.')));
    const identity = await googleAuth.verifyCode(req, code);
    const byGoogle = db.prepare('SELECT id,name,email,password_hash,role,department,admin_scope,must_change_password,email_verified,google_sub,avatar_url FROM users WHERE google_sub = ?').get(identity.googleSub);
    const byEmail = db.prepare('SELECT id,name,email,password_hash,role,department,admin_scope,must_change_password,email_verified,google_sub,avatar_url FROM users WHERE email = ?').get(identity.email);
    const user = byGoogle || byEmail;
    if (!user) return res.status(403).send(req.app.locals.page(req, 'Google account not registered', form('login', 'Create an account first, then use Google sign-in with the same CSPC email.')));
    if (byGoogle && byEmail && byGoogle.id !== byEmail.id) return res.status(409).send(req.app.locals.page(req, 'Google sign-in failed', form('login', 'This Google account is linked to a different user. Contact the system administrator.')));
    if (user.role === 'borrower' && !user.email_verified) return res.status(403).send(req.app.locals.page(req, 'Email not verified', form('login', 'Verify your CSPC email before using Google sign-in.')));
    if (user.google_sub && user.google_sub !== identity.googleSub) return res.status(409).send(req.app.locals.page(req, 'Google sign-in failed', form('login', 'This account is linked to a different Google identity. Contact the system administrator.')));
    db.prepare('UPDATE users SET google_sub = ?, avatar_url = ? WHERE id = ?').run(identity.googleSub, identity.avatarUrl, user.id);
    const linkedUser = { ...user, google_sub: identity.googleSub, avatar_url: identity.avatarUrl, name: user.name || identity.name };
    startSession(req, res, linkedUser, next);
  } catch (error) {
    console.error(`Google sign-in failed: ${error.message}`);
    res.status(502).send(req.app.locals.page(req, 'Google sign-in failed', form('login', 'Google sign-in could not be completed. Please try again.')));
  }
});

router.get('/login', (req, res) => res.send(req.app.locals.page(req, 'Sign in', form('login'))));
router.post('/login', async (req, res, next) => {
  try {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const ip = ipOf(req);
  const fail = (message, status = 401) => res.status(status).send(req.app.locals.page(req, 'Sign in', form('login', message, { email })));
  if (isLoginLimited(email, ip)) return fail('Too many failed attempts. Please wait 15 minutes before trying again.', 429);
  if (Buffer.byteLength(password, 'utf8') > 72) return fail('Incorrect CSPC email or password.');
  const user = db.prepare('SELECT id,name,email,password_hash,role,department,admin_scope,must_change_password,email_verified,avatar_url FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    db.prepare('INSERT INTO login_attempts (email,ip,attempted_at) VALUES (?,?,?)').run(email, ip, Date.now());
    return fail('Incorrect CSPC email or password.');
  }
  if (user.role === 'borrower' && !user.email_verified) {
    if (!isCspcEmail(email)) return fail(`Contact the system administrator to update this account to a ${CSPC_DOMAIN} address.`);
    const issued = await issueVerificationLink(req, email, { name: user.name, password_hash: user.password_hash, department: user.department });
    if (issued.error) return fail(issued.error, 429);
    db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
    const message = issued.fallback ? 'Email delivery is not configured or failed. For a local demo, use the verification link printed in the server console.' : '';
    return res.send(req.app.locals.page(req, 'Check your email', verificationPendingForm(email, message)));
  }
  db.prepare('DELETE FROM login_attempts WHERE email = ?').run(email);
  startSession(req, res, user, next);
  } catch (error) { next(error); }
});

function passwordResetRateLimitError(email, ip) {
  const now = Date.now();
  db.prepare('DELETE FROM password_reset_requests WHERE requested_at < ?').run(now - PASSWORD_RESET_RATE_WINDOW_MS);
  const lastForEmail = db.prepare('SELECT requested_at FROM password_reset_requests WHERE email = ? ORDER BY requested_at DESC LIMIT 1').get(email);
  if (lastForEmail && now - lastForEmail.requested_at < PASSWORD_RESET_COOLDOWN_MS) return 'cooldown';
  const byEmail = db.prepare('SELECT COUNT(*) AS n FROM password_reset_requests WHERE email = ? AND requested_at >= ?').get(email, now - PASSWORD_RESET_RATE_WINDOW_MS).n;
  const byIp = db.prepare('SELECT COUNT(*) AS n FROM password_reset_requests WHERE ip = ? AND requested_at >= ?').get(ip, now - PASSWORD_RESET_RATE_WINDOW_MS).n;
  if (byEmail >= MAX_PASSWORD_RESET_EMAILS || byIp >= MAX_PASSWORD_RESET_IP_REQUESTS) return 'limited';
  return '';
}

function invalidateUserSessions(userId) {
  const remove = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const row of db.prepare('SELECT sid,data FROM app_sessions').all()) {
    try {
      if (JSON.parse(row.data)?.user?.id === userId) remove.run(row.sid);
    } catch { /* Ignore malformed expired session rows. */ }
  }
}

async function issuePasswordReset(req, user) {
  const now = Date.now();
  const ip = ipOf(req);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?').run(user.id, now);
  db.prepare('INSERT INTO password_reset_tokens (user_id,token_hash,expires_at,created_at,request_ip) VALUES (?,?,?,?,?)')
    .run(user.id, hashVerificationToken(token), now + PASSWORD_RESET_LIFETIME_MS, now, ip);
  db.prepare('INSERT INTO password_reset_requests (email,ip,requested_at) VALUES (?,?,?)').run(user.email, ip, now);
  return sendPasswordResetLink(user.email, createPasswordResetUrl(req, token));
}

router.get('/forgot-password', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(req.app.locals.page(req, 'Forgot password', forgotPasswordForm()));
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const email = normalizeEmail(req.body.email);
    if (!isCspcEmail(email)) return res.send(req.app.locals.page(req, 'Check your email', resetLinkSentForm(email)));
    const user = db.prepare('SELECT id,email,role,email_verified FROM users WHERE email = ?').get(email);
    if (!user || (user.role === 'borrower' && !user.email_verified)) {
      return res.send(req.app.locals.page(req, 'Check your email', resetLinkSentForm(email)));
    }
    if (passwordResetRateLimitError(email, ipOf(req))) return res.send(req.app.locals.page(req, 'Check your email', resetLinkSentForm(email)));
    const delivery = await issuePasswordReset(req, user);
    return res.send(req.app.locals.page(req, 'Check your email', resetLinkSentForm(email)));
  } catch (error) { next(error); }
});

router.get('/reset-password', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!/^[a-f\d]{64}$/i.test(token)) return res.status(400).send(req.app.locals.page(req, 'Link unavailable', invalidResetLink()));
  const reset = db.prepare('SELECT id,expires_at,used_at FROM password_reset_tokens WHERE token_hash = ?').get(hashVerificationToken(token));
  if (!reset || reset.used_at || reset.expires_at <= Date.now()) return res.status(400).send(req.app.locals.page(req, 'Link unavailable', invalidResetLink()));
  res.send(req.app.locals.page(req, 'Reset password', resetPasswordForm(token)));
});

router.post('/reset-password', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const fail = message => res.status(400).send(req.app.locals.page(req, 'Reset password', invalidResetLink(message)));
  if (!/^[a-f\d]{64}$/i.test(token)) return fail();
  const reset = db.prepare('SELECT t.id,t.user_id,t.expires_at,t.used_at,u.password_hash FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash = ?').get(hashVerificationToken(token));
  if (!reset || reset.used_at || reset.expires_at <= Date.now()) return fail();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const passwordConfirm = typeof req.body.password_confirm === 'string' ? req.body.password_confirm : '';
  const passwordProblem = passwordPolicyError(password);
  if (passwordProblem) return res.status(400).send(req.app.locals.page(req, 'Reset password', resetPasswordForm(token, passwordProblem)));
  if (password !== passwordConfirm) return res.status(400).send(req.app.locals.page(req, 'Reset password', resetPasswordForm(token, 'Passwords do not match.')));
  if (bcrypt.compareSync(password, reset.password_hash)) return res.status(400).send(req.app.locals.page(req, 'Reset password', resetPasswordForm(token, 'Choose a password different from your current one.')));
  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(password, 12), reset.user_id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, reset.id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?').run(reset.user_id, reset.id);
  })();
  invalidateUserSessions(reset.user_id);
  req.session.flash = { type: 'ok', msg: 'Password reset successfully. Sign in with your new password.' };
  res.redirect('/login');
});

router.get('/register', (req, res) => res.send(req.app.locals.page(req, 'Create account', form('register'))));
router.post('/register', async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const passwordConfirm = typeof req.body.password_confirm === 'string' ? req.body.password_confirm : '';
    const department = typeof req.body.department === 'string' ? req.body.department.trim() : '';
    const fail = message => res.status(400).send(req.app.locals.page(req, 'Create account', form('register', message, { name, email, department })));
    if (name.length < 2 || name.length > 120) return fail('Enter your full name (2 to 120 characters).');
    if (!isCspcEmail(email)) return fail(`Use your ${CSPC_DOMAIN} email address.`);
    if (!getDepartments().includes(department)) return fail('Choose your college or campus.');
    const passwordProblem = passwordPolicyError(password);
    if (passwordProblem) return fail(passwordProblem);
    if (password !== passwordConfirm) return fail('Passwords do not match.');
    const existingAccount = db.prepare('SELECT role,email_verified FROM users WHERE email = ?').get(email);
    if (existingAccount) {
      const message = existingAccount.role === 'borrower' && !existingAccount.email_verified
        ? 'This email already has an unverified account. Go to Sign in and enter its current password; we will send a verification link.'
        : 'That email already has an account. Please go to Sign in.';
      return fail(message);
    }
    const issued = await issueVerificationLink(req, email, { name, password_hash: bcrypt.hashSync(password, 12), department });
    if (issued.error) return fail(issued.error);
    const message = issued.fallback ? 'Email delivery is not configured or failed. For a local demo, use the verification link printed in the server console.' : '';
    return res.send(req.app.locals.page(req, 'Check your email', verificationPendingForm(email, message)));
  } catch (error) { next(error); }
});

router.get('/verify-email', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!/^[a-f\d]{64}$/i.test(token)) return res.status(400).send(req.app.locals.page(req, 'Link unavailable', invalidVerificationLink()));
  const pending = db.prepare('SELECT email,expires_at FROM pending_registrations WHERE token_hash = ?').get(hashVerificationToken(token));
  if (!pending) return res.status(400).send(req.app.locals.page(req, 'Link unavailable', invalidVerificationLink()));
  if (pending.expires_at <= Date.now()) {
    db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(pending.email);
    return res.status(400).send(req.app.locals.page(req, 'Link expired', invalidVerificationLink('This verification link has expired. Please register again.')));
  }
  res.send(req.app.locals.page(req, 'Confirm your email', verificationConfirmForm(token)));
});

router.post('/register/resend', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.session.pendingRegistrationEmail);
    const pending = email && db.prepare('SELECT name,password_hash,department FROM pending_registrations WHERE email = ?').get(email);
    if (!pending) return res.redirect('/register');
    const issued = await issueVerificationLink(req, email, pending);
    if (issued.error) return res.status(429).send(req.app.locals.page(req, 'Check your email', verificationPendingForm(email, issued.error)));
    const message = issued.fallback ? 'Email delivery is not configured or failed. Use the new link printed in the server console.' : 'A new verification link was sent. The previous link is now invalid.';
    return res.send(req.app.locals.page(req, 'Check your email', verificationPendingForm(email, message)));
  } catch (error) { next(error); }
});

router.post('/verify-email', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const fail = message => res.status(400).send(req.app.locals.page(req, 'Link unavailable', invalidVerificationLink(message)));
  if (!/^[a-f\d]{64}$/i.test(token)) return fail();
  const pending = db.prepare('SELECT * FROM pending_registrations WHERE token_hash = ?').get(hashVerificationToken(token));
  if (!pending) return fail();
  if (pending.expires_at <= Date.now()) {
    db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(pending.email);
    return fail('This verification link has expired. Please register again.');
  }
  const createBorrower = db.transaction(() => {
    const existing = db.prepare('SELECT id,role,email_verified FROM users WHERE email = ?').get(pending.email);
    if (existing) {
      if (existing.role !== 'borrower' || existing.email_verified) throw new Error('That email already has a verified account. Please sign in instead.');
      db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(existing.id);
    } else {
      db.prepare(`INSERT INTO users (name,email,password_hash,role,department,admin_scope,email_verified,must_change_password)
        VALUES (?,?,?,'borrower',?,'system',1,0)`).run(pending.name, pending.email, pending.password_hash, pending.department);
    }
    db.prepare('DELETE FROM pending_registrations WHERE email = ?').run(pending.email);
  });
  try { createBorrower(); } catch (error) { return fail(error.message); }
  if (normalizeEmail(req.session.pendingRegistrationEmail) === pending.email) delete req.session.pendingRegistrationEmail;
  req.session.flash = { type: 'ok', msg: 'Email verified. Your borrower account is ready; please sign in.' };
  res.redirect('/login');
});

router.get('/change-password', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const forced = req.session.user.must_change_password;
  const body = `<section class="auth-form-area"><span class="auth-kicker">ACCOUNT SECURITY</span><h1>${forced ? 'Set a new password' : 'Change password'}</h1>
    <p>${forced ? 'For security, change the temporary password before using your account.' : 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.'}</p>
    <form method="post" action="/change-password" class="auth-card">${passwordField('Current password','current-password','current_password','current-password')}${passwordField('New password','new-password','new_password','new-password')}${passwordField('Confirm new password','confirm-password','confirm_password','new-password')}<button>Update password</button></form></section>`;
  res.send(req.app.locals.page(req, 'Change password', body));
});

router.post('/change-password', (req, res) => {
  const sessionUser = req.session.user;
  if (!sessionUser) return res.redirect('/login');
  const backTo = sessionUser.role !== 'admin' ? '/equipment' : sessionUser.admin_scope === 'system' ? '/admin/department-admins' : '/admin/dashboard';
  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';
  const confirmPassword = typeof req.body.confirm_password === 'string' ? req.body.confirm_password : '';
  const account = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(sessionUser.id);
  const fail = message => {
    if (sessionUser.must_change_password) return res.status(400).send(req.app.locals.page(req, 'Change password', `<section class="auth-form-area"><h1>Set a new password</h1><p class="flash error">${esc(message)}</p><form method="post" action="/change-password" class="auth-card">${passwordField('Current password','current-password','current_password','current-password')}${passwordField('New password','new-password','new_password','new-password')}${passwordField('Confirm new password','confirm-password','confirm_password','new-password')}<button>Update password</button></form></section>`));
    req.session.flash = { type: 'error', msg: message };
    res.redirect(backTo);
  };
  if (!account || Buffer.byteLength(currentPassword, 'utf8') > 72 || !bcrypt.compareSync(currentPassword, account.password_hash)) return fail('Current password is incorrect.');
  const passwordProblem = passwordPolicyError(newPassword);
  if (passwordProblem) return fail(passwordProblem);
  if (newPassword !== confirmPassword) return fail('New passwords do not match.');
  if (bcrypt.compareSync(newPassword, account.password_hash)) return fail('Choose a password different from your current one.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), sessionUser.id);
  sessionUser.must_change_password = false;
  req.session.flash = { type: 'ok', msg: 'Password changed successfully.' };
  res.redirect(backTo);
});

router.get('/csrf-token', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ token: req.csrfToken() });
});

router.post('/logout', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const session = req.session;
  if (!session) return res.redirect(303, '/login');
  session.destroy(error => {
    if (error) return next(error);
    const production = process.env.NODE_ENV === 'production';
    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: production,
      sameSite: production ? 'none' : 'lax',
    });
    return res.redirect(303, '/login');
  });
});
module.exports = router;
