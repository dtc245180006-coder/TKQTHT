const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRoles } = require('../auth');

// GET /api/rooms - Danh sách tất cả phòng hoặc lọc theo type
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    const { checkIn, checkOut, guests } = req.query;
    if ((checkIn || checkOut) && !require('../validation').validRange(checkIn, checkOut)) return res.status(400).json({ success: false, message: 'Ngày lưu trú không hợp lệ hoặc nằm trong quá khứ' });
    if (guests && (!Number.isInteger(Number(guests)) || Number(guests) < 1)) return res.status(400).json({ success: false, message: 'Số khách không hợp lệ' });
    let rooms = await db.getRooms(type);
    if (!req.user || req.query.includeRetired !== 'true') rooms = rooms.filter(r => r.status !== 'retired');
    if (guests) rooms = rooms.filter(r => r.capacity >= Number(guests));
    if (checkIn) {
      const blocked = new Set(await db.getBlockingRoomIds(checkIn, checkOut));
      rooms = rooms.filter(r => r.status === 'available' && !blocked.has(r.id));
    }
    res.json({
      success: true,
      count: rooms.length,
      data: rooms
    });
  } catch (error) {
    console.error('[Error] Lỗi khi lấy danh sách phòng:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách phòng' });
  }
});

// GET /api/rooms/:id - Chi tiết phòng
router.get('/:id', async (req, res) => {
  try {
    const room = await db.getRoomById(req.params.id);
    if (!room || (!req.user && room.status === 'retired')) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy phòng này' });
    }
    res.json({ success: true, data: room });
  } catch (error) {
    console.error('[Error] Lỗi khi lấy chi tiết phòng:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy chi tiết phòng' });
  }
});

function validateRoom(body) {
  const price = Number(body.pricePerNight);
  const capacity = Number(body.capacity);
  return typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 150 &&
    ['Standard', 'Deluxe', 'Suite', 'Villa', 'Family', 'Penthouse'].includes(body.type) &&
    Number.isFinite(price) && price > 0 && price <= 9999999999 && Number.isInteger(capacity) && capacity > 0 && capacity <= 50 &&
    (!body.status || ['available', 'maintenance', 'retired'].includes(body.status)) &&
    (!body.imageUrl || /^https:\/\/images\.unsplash\.com\//.test(body.imageUrl)) &&
    (!body.amenities || (Array.isArray(body.amenities) && body.amenities.every(a => typeof a === 'string')));
}

router.post('/', requireRoles('admin'), async (req, res) => {
  try {
    if (!validateRoom(req.body)) return res.status(400).json({ success: false, message: 'Thông tin phòng không hợp lệ' });
    const room = await db.createRoom(req.body, req.user);
    res.status(201).json({ success: true, data: room });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không thể tạo phòng' });
  }
});

router.put('/:id', requireRoles('admin'), async (req, res) => {
  try {
    if (!validateRoom(req.body)) return res.status(400).json({ success: false, message: 'Thông tin phòng không hợp lệ' });
    const room = await db.updateRoom(req.params.id, req.body, req.user);
    if (!room) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
    res.json({ success: true, data: room });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Không thể cập nhật phòng' });
  }
});

router.delete('/:id', requireRoles('admin'), async (req, res) => {
  try {
    const result = await db.deleteRoom(req.params.id, req.user);
    if (!result) return res.status(404).json({ success: false, message: 'Không tìm thấy phòng' });
    if (result.conflict) return res.status(409).json({ success: false, message: 'Phòng có lịch sử đặt không được xóa. Hãy chọn Ngừng kinh doanh sau khi xử lý các đơn đang hoạt động.' });
    res.json({ success: true, message: 'Đã xóa phòng' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Không thể xóa phòng' });
  }
});

router.put('/:id/cleaning',requireRoles('admin','receptionist'),async(req,res)=>{
  try {
    const id=Number(req.params.id);if(!Number.isInteger(id)||id<1)return res.status(400).json({success:false,message:'Mã phòng không hợp lệ.'});
    res.json({success:true,data:await db.cleanRoom(id,req.body,req.user)});
  }catch(error){res.status(error.status||500).json({success:false,code:error.code,message:error.status?error.message:'Không thể cập nhật trạng thái dọn phòng.'});}
});
module.exports = router;
