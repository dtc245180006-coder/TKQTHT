const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { requireRoles } = require('../auth');
const users = require('../auth/users');
const staff = require('../auth/staff');
const audit = require('../audit');
router.use(requireRoles('admin'));
const reauthLimit = rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,
  keyGenerator:req=>String(req.user.id),skipSuccessfulRequests:true,
  message:{success:false,message:'Quá nhiều lần xác nhận không thành công. Thử lại sau 15 phút.'}});
router.get('/',async(req,res,next)=>{
  try { res.json({success:true,data:(await users.all()).map(users.safe)}); } catch(error) { next(error); }
});
router.get('/audit',async(req,res,next)=>{
  if (req.query.before && !/^[1-9]\d{0,17}$/.test(req.query.before)) return res.status(400).json({success:false,message:'Mốc nhật ký không hợp lệ.'});
  try { res.json({success:true,data:await audit.list(req.query.before)}); } catch(error) { next(error); }
});
for (const [method,path,operation] of [['post','/','create'],['put','/:id','update'],['post','/:id/reset-password','reset-password'],['post','/:id/revoke-sessions','revoke-sessions']]) {
  router[method](path,reauthLimit,async(req,res,next)=>{
    const id = req.params.id ? Number(req.params.id) : null;
    if (req.params.id && (!Number.isSafeInteger(id) || id<1)) return res.status(400).json({success:false,message:'Mã nhân viên không hợp lệ.'});
    try { res.status(operation==='create'?201:200).json({success:true,data:await staff.manage(req.user,operation,id,req.body)}); }
    catch(error) {
      if (error.status) return res.status(error.status).json({success:false,code:error.code,message:error.message});
      next(error);
    }
  });
}
module.exports = router;
