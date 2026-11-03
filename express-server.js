const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./middleware/db');
const SQLiteSessionStore = require('./middleware/sqlite-session-store');
const csrfProtection = require('./middleware/csrf');
const { page } = require('./middleware/views');
const app = express();
const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-only-change-me');
if (!sessionSecret) throw new Error('SESSION_SECRET must be set in production.');
if (process.env.NODE_ENV === 'production' && !process.env.VERIFICATION_CODE_SECRET) {
  throw new Error('VERIFICATION_CODE_SECRET must be set separately in production.');
}
if (process.env.NODE_ENV === 'production') {
  let publicUrl;
  try { publicUrl = new URL(String(process.env.APP_BASE_URL || '')); }
  catch { throw new Error('APP_BASE_URL must be set to the public HTTPS origin in production.'); }
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password) {
    throw new Error('APP_BASE_URL must be a public HTTPS origin in production.');
  }
}
app.locals.page = page;
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 200 }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteSessionStore(db),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
  },
}));
app.use(csrfProtection);
app.use((req, res, next) => {
  const user = req.session.user;
  if (user?.must_change_password && !['/change-password', '/logout'].includes(req.path)) return res.redirect('/change-password');
  next();
});
app.get('/', (req, res) => {
  const user = req.session.user;
  if (!user) return res.redirect('/login');
  if (user.must_change_password) return res.redirect('/change-password');
  if (user.role === 'admin') return res.redirect(user.admin_scope === 'system' ? '/admin/department-admins' : '/admin/dashboard');
  return res.redirect('/equipment');
});
app.use(require('./routes/auth'));
app.use(require('./routes/notifications'));
app.use(require('./routes/borrower'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/admin'));
app.use(require('./routes/chat'));
app.use((req, res) => res.status(404).send(page(req, 'Not found', '<h1>Page not found</h1><p><a href="/">Go home</a></p>')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled application error:', err?.stack || err);
  res.status(500).send(page(req, 'Server error', '<h1>Something went wrong</h1><p>Your request could not be completed. Please try again.</p>'));
});
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`CSPC Equipment Desk running at http://localhost:${port}`));
