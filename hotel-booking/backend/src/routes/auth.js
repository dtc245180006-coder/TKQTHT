const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const auth = require('../auth');
const audit = require('../audit');
const { changePassword } = require('../auth/staff');
router.use(auth.noStore);

router.get('/session', (req, res) => {
  res.json({ success: true, data: { user: req.user, csrfToken: auth.csrfToken(req) } });
});

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút.' }
});

router.post('/login', loginLimit, auth.csrfProtection, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || username.length > 64 || typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ success: false, message: 'Thông tin đăng nhập không hợp lệ.' });
    }
    const user = await auth.authenticate(username.trim().toLowerCase(), password);
    if (!user) return res.status(401).json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    await audit.record(auth.publicUser(user),'auth.login','staff',user.id);
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.userVersion = user.session_version;
    req.session.signedInAt = Date.now();
    const csrfToken = auth.csrfToken(req);
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    res.json({ success: true, data: { user:auth.publicUser(user), csrfToken, next: auth.safeNext(req.body.next, user) } });
  } catch (error) { next(error); }
});

router.post('/logout', auth.csrfProtection, (req, res, next) => {
  const actor = req.user;
  req.session.destroy(async error => {
    if (error) return next(error);
    res.clearCookie(auth.COOKIE_NAME, auth.cookieOptions());
    if (actor) {
      try { await audit.record(actor,'auth.logout','staff',actor.id); }
      catch(error) { console.error('[Logout audit]',error.message); }
    }
    res.json({ success: true, data: null });
  });
});

const passwordLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,
  keyGenerator:req=>String(req.user.id),skipSuccessfulRequests:true,
  message:{success:false,message:'Quá nhiều lần đổi mật khẩu không thành công. Thử lại sau 15 phút.'}});
router.post('/password',auth.requireRoles(...auth.STAFF),passwordLimit,async(req,res,next)=>{
  try {
    const result = await changePassword(req.user,req.body);
    await new Promise((resolve,reject)=>req.session.destroy(error=>error?reject(error):resolve()));
    res.clearCookie(auth.COOKIE_NAME,auth.cookieOptions());
    res.json({success:true,data:result});
  } catch (error) {
    if (error.status) return res.status(error.status).json({success:false,code:error.code,message:error.message});
    next(error);
  }
});

module.exports = router;
