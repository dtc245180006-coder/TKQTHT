const HOLD_MINUTES = Number(process.env.BOOKING_HOLD_MINUTES || 120);
if (!Number.isInteger(HOLD_MINUTES) || HOLD_MINUTES < 1 || HOLD_MINUTES > 1440) {
  throw new Error('BOOKING_HOLD_MINUTES must be an integer between 1 and 1440');
}
const holding = (booking, now = Date.now()) => booking.status === 'pending' && Date.parse(booking.hold_expires_at) > now;
const blocking = (booking, now = Date.now()) => ['confirmed', 'checked_in'].includes(booking.status) || holding(booking, now);
// This predicate is shared by room mutation checks and availability queries.
const BLOCKING_SQL = "(status IN ('confirmed','checked_in') OR (status='pending' AND hold_expires_at>clock_timestamp()))";
module.exports = { HOLD_MINUTES, holding, blocking, BLOCKING_SQL };
