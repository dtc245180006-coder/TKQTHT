function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validRange(start, end) { return validDate(start) && validDate(end) && start >= today() && end > start; }
function contact(body) {
  return typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 120 &&
    typeof body.phone === 'string' && /^[0-9+\s.-]{8,20}$/.test(body.phone) &&
    typeof body.email === 'string' && body.email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email);
}
module.exports = { today, validDate, validRange, contact };
