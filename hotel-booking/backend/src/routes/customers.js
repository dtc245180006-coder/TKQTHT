const router = require('express').Router();
const db = require('../db');
const { requireRoles, STAFF } = require('../auth');
router.use(requireRoles(...STAFF));
const { contact } = require('../validation');
router.get('/', async (req, res) => {
  try { res.json({ success: true, data: await db.getCustomers() }); }
  catch { res.status(500).json({ success: false, message: 'Không thể tải khách hàng' }); }
});
for (const method of ['post', 'put']) {
  router[method](method === 'post' ? '/' : '/:id', async (req, res) => {
    if (!contact(req.body)) return res.status(400).json({ success: false, message: 'Tên, số điện thoại hoặc email không hợp lệ' });
    try {
      const data = await db.saveCustomer(req.params.id, req.body, req.user);
      if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
      res.status(method === 'post' ? 201 : 200).json({ success: true, data });
    } catch (error) {
      res.status(error.code === '23505' ? 409 : 500).json({ success: false, message: error.code === '23505' ? 'Email đã thuộc về khách hàng khác' : 'Không thể lưu khách hàng' });
    }
  });
}
router.delete('/:id', requireRoles('admin'), async (req, res) => {
  try {
    const result = await db.deleteCustomer(req.params.id, req.user);
    if (!result) return res.status(404).json({ success: false, message: 'Không tìm thấy khách hàng' });
    if (result.conflict) return res.status(409).json({ success: false, message: 'Khách hàng có lịch sử đặt phòng, hãy giữ hồ sơ để tra cứu' });
    res.json({ success: true });
  } catch (error) { res.status(error.code === '23503' ? 409 : 500).json({ success: false, message: error.code === '23503' ? 'Khách hàng có lịch sử đặt phòng' : 'Không thể xóa khách hàng' }); }
});
module.exports = router;
