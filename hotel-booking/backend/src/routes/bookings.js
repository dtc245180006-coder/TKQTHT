const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireRoles, STAFF, csrfProtection } = require('../auth');
const { bookingsTotal } = require('../metrics');
const { rateLimit } = require('express-rate-limit');
const { context } = require('../bookings/requests');
const publicBurstLimit = rateLimit({
  windowMs: 15*60*1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  skip: req => !!req.user,
  message: { success:false, code:'BOOKING_RATE_LIMIT', message:'Quá nhiều yêu cầu đặt phòng. Vui lòng thử lại sau 15 phút.' }
});
const publicFields = ['id','room_id','room_name','room_type','booking_snapshot','history_complete','customer_name','customer_phone','customer_email','guest_count','check_in_date','check_out_date','total_price','status','hold_expires_at','created_at'];

// GET /api/bookings - Lấy danh sách các đơn đặt phòng
router.get('/', requireRoles(...STAFF), async (req, res) => {
  try {
    const bookings = await db.getBookings();
    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    console.error('[Error] Lỗi khi lấy danh sách đặt phòng:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách đặt phòng' });
  }
});

// POST /api/bookings - Tạo đơn đặt phòng mới
router.post('/', publicBurstLimit, csrfProtection, async (req, res) => {
  try {
    const { roomId, customerName, customerPhone, customerEmail, checkInDate, checkOutDate, guests } = req.body;
    if (!Number.isInteger(roomId) || roomId < 1 || !Number.isInteger(guests) || guests < 1 || guests > 50) return res.status(400).json({ success: false, message: 'Mã phòng và số khách phải là số nguyên hợp lệ (1–50 khách).' });
    if (!require('../validation').contact({ name: customerName, phone: customerPhone, email: customerEmail }) || !require('../validation').validRange(checkInDate, checkOutDate)) return res.status(400).json({ success: false, message: 'Kiểm tra thông tin khách hàng và ngày lưu trú (không được đặt trong quá khứ)' });

    if (!roomId || !customerName || !customerPhone || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ thông tin: Mã phòng, Tên khách hàng, SĐT, Ngày đến, Ngày đi'
      });
    }

    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
    }
    if (!/^[0-9+\s.-]{8,20}$/.test(customerPhone)) {
      return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ' });
    }

    if (!req.user && (Date.parse(checkOutDate)-Date.parse(checkInDate))/86400000 > 30) {
      return res.status(400).json({ success:false, message:'Đặt phòng trực tuyến tối đa 30 đêm; vui lòng liên hệ lễ tân nếu ở lâu hơn.' });
    }
    const data = {
      roomId,
      customerName,
      customerPhone,
      customerEmail: customerEmail || 'guest@hotel.vn',
      checkInDate,
      checkOutDate,
      guests
    };
    const meta = context({ key:req.body.requestKey, scope:req.user ? `staff:${req.user.id}` : `guest:${req.sessionID}`, ip:req.ip, data });
    const newBooking = await db.createBooking(data, req.user, meta);

    // Record metrics
    if (!newBooking.replayed) {
      bookingsTotal.inc({ room_type: newBooking.room_type });
      console.log(`[Booking] Created #${newBooking.id}, status=${newBooking.status}`);
    }
    res.set('Cache-Control', 'no-store');
    res.status(newBooking.replayed ? 200 : 201).json({
      success: true,
      message: newBooking.status === 'pending' ? 'Đã gửi yêu cầu; lễ tân cần liên hệ và xác nhận trước hạn giữ phòng.' : 'Đã xử lý yêu cầu đặt phòng.',
      replayed: !!newBooking.replayed,
      data: req.user ? newBooking : Object.fromEntries(publicFields.map(key => [key,newBooking[key]]))
    });
  } catch (error) {
    if (error.status) {
      if (error.status === 429) res.set('Retry-After', '3600');
      return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    if (error.code === 'ROOM_UNAVAILABLE') return res.status(409).json({ success: false, message: 'Phòng đã bị xóa hoặc chuyển sang bảo trì, vui lòng chọn lại' });
    if (error.code === 'BOOKING_CONFLICT') {
      return res.status(409).json({ success: false, message: 'Phòng đã được đặt trong khoảng thời gian này' });
    }
    if (error.code === 'INVALID_DATE_RANGE') {
      return res.status(400).json({ success: false, message: 'Ngày trả phòng phải sau ngày nhận phòng' });
    }
    console.error('[Error] Lỗi khi tạo đơn đặt phòng:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đơn đặt phòng' });
  }
});

// PUT /api/bookings/:id/cancel - Hủy đơn đặt phòng
router.put('/:id/cancel', requireRoles(...STAFF), async (req, res) => {
  try {
    if (!Number.isInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ success: false, message: 'Mã đơn không hợp lệ.' });
    const updated = await db.cancelBooking(req.params.id, req.user);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đơn đặt phòng này' });
    }
    res.json({
      success: true,
      message: 'Hủy đơn đặt phòng thành công',
      data: updated
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    console.error('[Error] Lỗi khi hủy đơn đặt phòng:', error);
    res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hủy đơn đặt phòng' });
  }
});

function bookingId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ success: false, message: 'Mã đơn không hợp lệ.' });
  req.bookingId = id;
  next();
}
function handleError(error, res) {
  if (!error.status) console.error('[Error] Booking operation:', error.message);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Không thể xử lý đơn đặt phòng.', code: error.code });
}

for (const action of ['confirm', 'check-in', 'check-out','no-show']) {
  router.put(`/:id/${action}`, requireRoles(...STAFF), bookingId, async (req, res) => {
    try { res.json({ success: true, data: await db.transitionBooking(req.bookingId, action, req.user, { contactVerified:req.body?.contactVerified,reason:req.body?.reason }) }); }
    catch (error) { handleError(error, res); }
  });
}
router.get('/:id/history', requireRoles(...STAFF), bookingId, async (req, res) => {
  try { res.json({ success: true, data: await db.getBookingHistory(req.bookingId) }); }
  catch (error) { handleError(error, res); }
});
router.post('/:id/payments', requireRoles(...STAFF), bookingId, async (req, res) => {
  try {
    const result = await db.recordPayment(req.bookingId, req.body, req.user);
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) { handleError(error, res); }
});

router.post('/:id/revisions',requireRoles(...STAFF),bookingId,async(req,res)=>{
  try {
    if(!/^[a-f0-9]{64}$/.test(req.body.quoteToken||''))return res.status(400).json({success:false,message:'Cần xem và xác nhận báo giá điều chỉnh trước khi lưu.'});
    const result=await db.reviseBooking(req.bookingId,req.body,req.user);res.status(result.replayed?200:201).json({success:true,data:result});}
  catch(error){handleError(error,res);}
});
router.post('/:id/revision-quote',requireRoles(...STAFF),bookingId,async(req,res)=>{
  try {res.json({success:true,data:await db.reviseBooking(req.bookingId,req.body,req.user,true)});}
  catch(error){handleError(error,res);}
});
module.exports = router;
