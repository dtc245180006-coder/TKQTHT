const { createHmac } = require('node:crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const { fail } = require('./rules');
const WINDOW_MS = 60 * 60 * 1000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function context({ key, scope, ip, data }) {
  if (typeof key !== 'string' || !UUID.test(key)) fail('INVALID_REQUEST_KEY', 'Cần mã yêu cầu UUID hợp lệ để tránh đặt phòng lặp.', 400);
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is required for booking request protection');
  const hash = value => createHmac('sha256', secret).update(value).digest('hex');
  const normalized = [data.roomId, data.customerName.trim(), data.customerPhone.trim(), data.customerEmail.trim().toLowerCase(), data.checkInDate, data.checkOutDate, data.guests];
  return { key: key.toLowerCase(), scope: hash(`scope:${scope}`), fingerprint: hash(JSON.stringify(normalized)),
    ip: hash(`ip:${ipKeyGenerator(ip)}`), email: hash(`email:${normalized[3]}`), phone: hash(`phone:${normalized[2].replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0')}`) };
}

module.exports = function requestStore({ bookings, clock }) {
  const memory = new Map();
  async function begin(client, meta, actor) {
    if (!meta) fail('INVALID_REQUEST_KEY', 'Thiếu thông tin chống gửi lặp.', 400);
    const id = `${meta.scope}:${meta.key}`;
    // Consistent lock order: request -> sorted quota keys -> room -> booking.
    if (client) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`booking-request:${id}`]);
    const existing = client ? (await client.query('SELECT * FROM booking_requests WHERE scope_hash=$1 AND request_key=$2', [meta.scope, meta.key])).rows[0] : memory.get(id);
    if (existing) {
      if (existing.fingerprint !== meta.fingerprint) fail('REQUEST_KEY_REUSED', 'Mã yêu cầu đã được dùng cho nội dung khác.');
      return existing.booking_id;
    }
    if (actor) return null;
    if (client) for (const lock of [`ip:${meta.ip}`, `email:${meta.email}`, `phone:${meta.phone}`].sort()) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`booking-quota:${lock}`]);
    }
    const now = client ? (await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime() : clock();
    const rows = client ? (await client.query(`SELECT r.*,b.status,b.hold_expires_at FROM booking_requests r
      JOIN bookings b ON b.id=r.booking_id WHERE r.is_public AND
      (r.created_at>$4 OR (b.status='pending' AND b.hold_expires_at>$5)) AND
      (r.ip_hash=$1 OR r.email_hash=$2 OR r.phone_hash=$3)`,
    [meta.ip, meta.email, meta.phone, new Date(now-WINDOW_MS), new Date(now)])).rows :
      [...memory.values()].filter(r => r.is_public).map(r => ({ ...r, ...bookings.find(b => b.id === r.booking_id), created_at: r.created_at }));
    const recent = rows.filter(r => new Date(r.created_at).getTime() > now-WINDOW_MS);
    if (recent.filter(r => r.ip_hash === meta.ip).length >= 5 ||
        recent.filter(r => r.email_hash === meta.email).length >= 3 ||
        recent.filter(r => r.phone_hash === meta.phone).length >= 3) {
      fail('BOOKING_RATE_LIMIT', 'Đã đạt giới hạn yêu cầu đặt phòng. Vui lòng thử lại sau 1 giờ hoặc liên hệ lễ tân.', 429);
    }
    if (rows.some(r => r.status === 'pending' && Date.parse(r.hold_expires_at) > now && (r.email_hash === meta.email || r.phone_hash === meta.phone))) {
      fail('ACTIVE_HOLD_EXISTS', 'Thông tin liên hệ này đang có yêu cầu chờ xử lý. Vui lòng liên hệ lễ tân trước khi đặt thêm.', 429);
    }
    return null;
  }
  async function save(client, meta, booking, actor) {
    const values = [meta.scope, meta.key, meta.fingerprint, booking.id, !actor, meta.ip, meta.email, meta.phone];
    if (client) await client.query(`INSERT INTO booking_requests
      (scope_hash,request_key,fingerprint,booking_id,is_public,ip_hash,email_hash,phone_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, values);
    else memory.set(`${meta.scope}:${meta.key}`, { scope_hash:meta.scope, request_key:meta.key, fingerprint:meta.fingerprint,
      booking_id:booking.id, is_public:!actor, ip_hash:meta.ip, email_hash:meta.email, phone_hash:meta.phone, created_at:new Date(clock()).toISOString() });
  }
  return { begin, save };
};
module.exports.context = context;
