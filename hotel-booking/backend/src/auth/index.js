const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { randomBytes, timingSafeEqual } = require('node:crypto');
const db = require('../db');
const users = require('./users');
const { hashPassword, verifyPassword } = require('./passwords');

const STAFF = ['admin', 'receptionist'];
const COOKIE_NAME = 'hotel.sid';
const SESSION_AGE = 8 * 60 * 60 * 1000;
let sessionHandler, dummyHash;
const cookieOptions = () => ({
  path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.SESSION_COOKIE_SECURE === 'true'
});

function publicUser(user) {
  return user ? { id: user.id, username: user.username, name: user.display_name, role: user.role, mustChangePassword:!!user.must_change_password } : null;
}

async function initialize() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('CHANGE_ME')) throw new Error('Configure SESSION_SECRET (at least 32 random characters)');
  if (process.env.DB_AUTO_MIGRATE !== 'false') {
    await users.initialize();
    await require('../audit').initialize();
  }
  const accounts = [
    { prefix: 'STAFF_ADMIN', role: 'admin', name: 'Quản trị viên' },
    { prefix: 'STAFF_RECEPTION', role: 'receptionist', name: 'Lễ tân' }
  ];
  const usernames = new Set();
  for (const account of process.env.STAFF_BOOTSTRAP === 'false' ? [] : accounts) {
    const username = (process.env[`${account.prefix}_USERNAME`] || '').trim().toLowerCase();
    const password = process.env[`${account.prefix}_PASSWORD`];
    if (!/^[a-z0-9._-]{3,64}$/.test(username) || usernames.has(username)) throw new Error(`Configure a unique ${account.prefix}_USERNAME`);
    usernames.add(username);
    if (!password || password.length < 12 || password.length > 128 || password.startsWith('CHANGE_ME')) throw new Error(`Configure ${account.prefix}_PASSWORD (12-128 characters)`);
    const existing = await users.findByUsername(username);
    if (!existing) await users.create({ username, display_name: account.name, role: account.role, password_hash: await hashPassword(password) });
  }
  dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const pool = db.getPool();
  sessionHandler = session({
    name: COOKIE_NAME, secret, resave: false, saveUninitialized: false,
    store: pool ? new PgStore({ pool, tableName: 'staff_sessions', createTableIfMissing: process.env.DB_AUTO_MIGRATE !== 'false' }) : new session.MemoryStore(),
    cookie: { ...cookieOptions(), maxAge: SESSION_AGE }
  });
}

function middleware(req, res, next) {
  sessionHandler(req, res, error => {
    if (error) return next(error);
    attachUser(req, res).then(() => next(), next);
  });
}

async function attachUser(req, res) {
  req.user = null;
  if (req.session.userId) {
    if (!req.session.signedInAt || Date.now() - req.session.signedInAt >= SESSION_AGE) {
      await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
      res.clearCookie(COOKIE_NAME, cookieOptions());
    } else {
      const user = await users.findById(req.session.userId);
      if (user?.active && STAFF.includes(user.role) && req.session.userVersion===user.session_version &&
          (!user.must_change_password || Date.parse(user.temporary_password_expires_at)>Date.now())) {
        req.user = publicUser(user);
        Object.defineProperty(req.user,'sessionVersion',{value:user.session_version});
      }
      else await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    }
  }
  res.locals.currentUser = req.user;
}

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  const supplied = req.get('x-csrf-token') || '';
  const expected = req.session?.csrfToken || '';
  if (!/^[a-f0-9]{64}$/.test(supplied) || expected.length !== 64 || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ success: false, code: 'CSRF_INVALID', message: 'Phiên xác nhận không hợp lệ. Vui lòng tải lại trang.' });
  }
  next();
}

function noStore(req, res, next) { res.set('Cache-Control', 'no-store'); next(); }

function requireRoles(...roles) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', message: 'Vui lòng đăng nhập tài khoản nhân viên.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return csrfProtection(req, res, next);
    next();
  };
}

function safeNext(value, user) {
  if (user?.mustChangePassword || user?.must_change_password) return '/account';
  const staffPaths = ['/bookings', '/customers', '/account','/housekeeping','/finance'];
  const allowed = user?.role === 'admin' ? [...staffPaths, '/manage-rooms', '/staff'] : staffPaths;
  return allowed.includes(value) ? value : '/bookings';
}

function requirePage(...roles) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.path)}`);
    if (!roles.includes(req.user.role)) return res.status(403).render('pages/forbidden', {
      title: 'Không có quyền truy cập', activePage: '', stylesheets: [], pageScript: null
    });
    next();
  };
}

async function authenticate(username, password) {
  const user = await users.findByUsername(username);
  const valid = await verifyPassword(password, user?.password_hash || dummyHash);
  return valid && user?.active && (!user.must_change_password || Date.parse(user.temporary_password_expires_at)>Date.now()) ? user : null;
}

function requirePasswordChange(req,res,next) {
  if (!req.user?.mustChangePassword || req.path==='/account' || req.path==='/health') return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({success:false,code:'PASSWORD_CHANGE_REQUIRED',message:'Bạn cần đổi mật khẩu tạm tại trang Tài khoản trước khi sử dụng nghiệp vụ.'});
  return res.redirect('/account');
}

module.exports = { initialize, middleware, publicUser, csrfToken, csrfProtection, noStore,
  requireRoles, requirePage, safeNext, authenticate, cookieOptions, COOKIE_NAME, STAFF, requirePasswordChange };
