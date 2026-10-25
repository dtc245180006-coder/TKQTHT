const router = require('express').Router();
const auth = require('../auth');

router.get('/login', auth.noStore, (req, res) => {
  if (req.user) return res.redirect(auth.safeNext(req.query.next, req.user));
  res.render('pages/login', {
    title: 'Đăng nhập nhân viên', activePage: 'login', stylesheets: ['/css/pages/login.css'],
    pageScript: '/js/pages/login/index.js', nextPath: auth.safeNext(req.query.next, { role: 'admin' }), passwordChanged:req.query.passwordChanged==='1'
  });
});

// Route metadata is fixed here; request input is never passed to EJS options.
const pages = [
  { path: '/', name: 'rooms', title: 'Phòng nghỉ', styles: ['rooms'] },
  { path: '/bookings', name: 'bookings', title: 'Quản lý đơn đặt phòng', styles: ['bookings'], roles: auth.STAFF },
  { path: '/housekeeping', name: 'housekeeping', title: 'Dọn phòng', roles:auth.STAFF },
  { path: '/finance', name: 'finance', title: 'Thanh toán và đối soát', styles:['finance'], roles:auth.STAFF },
  { path: '/manage-rooms', name: 'manage-rooms', title: 'Quản lý phòng nghỉ', roles: ['admin'] },
  { path: '/customers', name: 'customers', title: 'Thông tin khách hàng', roles: auth.STAFF },
  { path: '/staff', name: 'staff', title: 'Tài khoản nhân viên', styles:['staff'], roles:['admin'] },
  { path: '/account', name: 'account', title: 'Tài khoản của tôi', styles:['staff'], roles:auth.STAFF },
];

for (const page of pages) {
  router.get(page.path, ...(page.roles ? [auth.requirePage(...page.roles)] : []), (req, res) => {
    res.render(`pages/${page.name}`, {
      title: page.title,
      activePage: page.name,
      stylesheets: (page.styles || []).map(name => `/css/pages/${name}.css`),
      pageScript: `/js/pages/${page.name}/index.js`
    });
  });
}

router.get('/receipts/:id',auth.requirePage(...auth.STAFF),async(req,res,next)=>{
  try{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.sendStatus(400);
    const data=await require('../db').finance.getReceipt(id);
    res.render('pages/receipt',{...data,title:data.payment.receipt_code,activePage:'finance',stylesheets:['/css/pages/finance.css'],pageScript:'/js/pages/finance/receipt.js',
      money:value=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:2}).format(Number(value)),
      timestamp:value=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(value))});
  }catch(error){if(error.status)return res.status(error.status).send(error.message);next(error);}
});
module.exports = router;
