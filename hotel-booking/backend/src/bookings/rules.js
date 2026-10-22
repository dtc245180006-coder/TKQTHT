const { today, validRange } = require('../validation');
const ACTIVE = ['confirmed', 'checked_in'];
function fail(code, message, status = 409) {
  const error = new Error(message);
  Object.assign(error, { code, status });
  throw error;
}
const cents = value => Math.round(Number(value) * 100);
const amount = value => value / 100;

function validateBooking(data, room) {
  if (!room || room.status !== 'available') fail('ROOM_UNAVAILABLE', 'Phòng không tồn tại hoặc đang bảo trì.', 404);
  if (!Number.isInteger(data.guests) || data.guests < 1 || data.guests > 50) fail('INVALID_GUESTS', 'Số khách phải là số nguyên từ 1 đến 50.', 400);
  if (data.guests > room.capacity) fail('CAPACITY_EXCEEDED', `Phòng chỉ cho phép tối đa ${room.capacity} khách.`, 400);
  if (!validRange(data.checkInDate, data.checkOutDate)) fail('INVALID_DATE_RANGE', 'Ngày lưu trú không hợp lệ.', 400);
  const nights = (Date.parse(data.checkOutDate) - Date.parse(data.checkInDate)) / 86400000;
  const total = cents(room.price_per_night) * nights;
  if (!Number.isSafeInteger(total) || total <= 0 || total > 999999999999) fail('INVALID_TOTAL', 'Tổng tiền vượt giới hạn cho phép.', 400);
  return amount(total);
}

function summarize(booking, payments = [], now = Date.now()) {
  if (booking.status === 'pending' && Date.parse(booking.hold_expires_at) <= now) booking = { ...booking, status: 'expired' };
  const regular=payments.filter(p=>!['reversal','replacement'].includes(p.entry_type));
  const received = regular.filter(p => Number(p.amount) > 0).reduce((sum, p) => sum + cents(p.amount), 0);
  const refunded = -regular.filter(p => Number(p.amount) < 0).reduce((sum, p) => sum + cents(p.amount), 0);
  const adjustment=payments.filter(p=>['reversal','replacement'].includes(p.entry_type)).reduce((sum,p)=>sum+cents(p.amount),0);
  const credit=payments.reduce((sum,p)=>sum+cents(p.credit_amount||0),0);
  const paid = received - refunded+adjustment, total = cents(booking.total_price)-credit;
  return {
    ...booking, guest_count: booking.guest_count ?? 1,
    booking_snapshot: booking.booking_snapshot ? structuredClone(booking.booking_snapshot) : null,
    history_complete: booking.original_snapshot===undefined?!!booking.booking_snapshot:!!booking.original_snapshot,
    room_name: booking.booking_snapshot?.room.name || null,
    room_type: booking.booking_snapshot?.room.type || null,
    received_amount: amount(received), refunded_amount: amount(refunded), paid_amount: amount(paid),
    adjustment_amount:amount(adjustment),credit_amount:amount(credit),settlement_total:amount(total),
    balance_due: ['pending','expired','cancelled','no_show'].includes(booking.status) ? 0 : amount(total - paid),
    payment_status: paid === total ? 'paid' : paid > 0 ? 'partial' : refunded > 0 ? 'refunded' : 'unpaid'
  };
}

function validateTransition(booking, room, action, paid, occupied, now=Date.now()) {
  const date=require('./stay-policy').local(now).date;
  if(action==='no-show') {
    if(booking.status!=='confirmed')fail('INVALID_TRANSITION','Chỉ ghi khách không đến cho đơn đã xác nhận chưa nhận phòng.');
    if(paid>0)fail('REFUND_REQUIRED','Cần hoàn hết tiền trước khi đóng đơn khách không đến.');
    return 'no_show';
  }
  if (action === 'cancel') {
    if (booking.status === 'cancelled') return 'cancelled';
    if (!['pending','confirmed'].includes(booking.status)) fail('INVALID_TRANSITION', 'Chỉ hủy được đơn đang chờ duyệt hoặc đã xác nhận, chưa nhận phòng.');
    if (paid > 0) fail('REFUND_REQUIRED', 'Cần hoàn hết tiền đã thu trước khi hủy đơn.');
    return 'cancelled';
  }
  if (action === 'check-in') {
    if (booking.status !== 'confirmed') fail('INVALID_TRANSITION', 'Chỉ nhận phòng cho đơn đã xác nhận.');
    if (date < booking.check_in_date || date >= booking.check_out_date) fail('CHECKIN_DATE', 'Chỉ nhận phòng trong khoảng ngày lưu trú đã đặt.');
    if (!room || room.status !== 'available') fail('ROOM_UNAVAILABLE', 'Phòng không sẵn sàng để nhận khách.');
    if (booking.guest_count > room.capacity) fail('CAPACITY_EXCEEDED', 'Sức chứa hiện tại không đủ cho đơn này.');
    if (occupied) fail('ROOM_OCCUPIED', 'Phòng còn khách chưa trả phòng.');
    return 'checked_in';
  }
  if (action === 'check-out') {
    if (booking.status !== 'checked_in') fail('INVALID_TRANSITION', 'Chỉ trả phòng cho đơn đang lưu trú.');
    if (cents(paid) !== cents(booking.total_price)) fail('PAYMENT_REQUIRED', 'Cần thanh toán đủ tiền trước khi trả phòng.');
    return 'checked_out';
  }
  fail('INVALID_TRANSITION', 'Thao tác không hợp lệ.', 400);
}

function validatePayment(booking, data, paid) {
  if (!ACTIVE.includes(booking.status)) fail('PAYMENT_CLOSED', 'Đơn đã hủy hoặc trả phòng không được ghi thêm thu/hoàn tiền.');
  if (!['payment', 'refund'].includes(data.kind) || !['cash', 'bank_transfer','wallet'].includes(data.method)) fail('INVALID_PAYMENT', 'Loại giao dịch hoặc phương thức không hợp lệ.', 400);
  if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0 || Math.abs(data.amount * 100 - cents(data.amount)) > 0.0001 || cents(data.amount) > 999999999999) fail('INVALID_AMOUNT', 'Số tiền phải lớn hơn 0 và có tối đa 2 chữ số thập phân.', 400);
  if (typeof data.requestKey !== 'string' || !/^[a-f0-9-]{36}$/i.test(data.requestKey)) fail('INVALID_PAYMENT_KEY', 'Mã giao dịch không hợp lệ.', 400);
  if (data.reference !== undefined && (typeof data.reference !== 'string' || data.reference.length > 200)) fail('INVALID_REFERENCE', 'Nội dung giao dịch tối đa 200 ký tự.', 400);
  if (data.kind === 'payment' && cents(data.amount) > cents(booking.total_price) - cents(paid)) fail('OVERPAYMENT', 'Số tiền thu vượt số tiền còn phải thanh toán.');
  if (data.kind === 'refund' && cents(data.amount) > cents(paid)) fail('OVER_REFUND', 'Số tiền hoàn vượt số tiền đang giữ của khách.');
}

module.exports = { ACTIVE, fail, cents, amount, validateBooking, summarize, validateTransition, validatePayment };
