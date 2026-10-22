const { fail } = require("./rules");
function local(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}
function check(booking, action, options, now) {
  if (process.env.NODE_ENV === "test" && process.env.STAY_TEST_NOW)
    now = Date.parse(process.env.STAY_TEST_NOW);
  const current = local(now);
  if (action === "check-in" && current.minutes < 840)
    fail("CHECKIN_TIME", "Giờ nhận phòng từ 14:00 theo giờ Việt Nam.");
  if (action === "check-out") {
    const early = current.date < booking.check_out_date;
    const late =
      current.date > booking.check_out_date ||
      (current.date === booking.check_out_date && current.minutes > 720);
    if ((early || late) && !reason(options.reason))
      fail(
        "CHECKOUT_REASON",
        "Trả sớm/muộn cần lý do; trả sớm không tự giảm tiền, phụ thu phải ghi riêng trước khi trả.",
        400,
      );
  }
  if (action === "no-show" && current.date <= booking.check_in_date)
    fail(
      "NO_SHOW_TIME",
      "Chỉ xác nhận khách không đến từ 00:00 ngày kế tiếp ngày nhận phòng.",
    );
}
function reason(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 5 &&
    value.trim().length <= 500
  );
}
module.exports = {
  local,
  check,
  reason,
  policy: {
    timezone: "Asia/Ho_Chi_Minh",
    checkIn: "14:00",
    checkOut: "12:00",
    earlyCheckout: "no_automatic_discount",
    lateCheckout: "manual_charge_with_reason",
    noShow: "manual_after_next_midnight",
    closure: "refund_all_before_cancel_or_no_show",
  },
};
