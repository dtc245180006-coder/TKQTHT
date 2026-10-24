const { fail, cents, amount } = require("../bookings/rules");
const { createHash } = require("node:crypto");
const METHODS = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  wallet: "Ví điện tử",
};
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const reason = (value) =>
  typeof value === "string" &&
  value.trim().length >= 5 &&
  value.trim().length <= 500;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function instrument(data, confirmed = true) {
  if (!Object.hasOwn(METHODS, data.method))
    fail("INVALID_METHOD", "Phương thức thanh toán không hợp lệ.", 400);
  if (typeof data.reference !== "string" || data.reference.length > 200)
    fail("INVALID_REFERENCE", "Mã tham chiếu tối đa 200 ký tự.", 400);
  if (data.method !== "cash" && data.reference.trim().length < 3)
    fail(
      "REFERENCE_REQUIRED",
      "Chuyển khoản/ví điện tử cần mã giao dịch đã kiểm tra (ví dụ MoMo:mã-giao-dịch).",
      400,
    );
  if (confirmed && data.moneyConfirmed !== true)
    fail(
      "MONEY_CONFIRMATION_REQUIRED",
      "Cần xác nhận đã kiểm tra tiền thực nhận/thực hoàn.",
      400,
    );
}
function money(value, allowZero = false) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    cents(value) >= (allowZero ? 0 : 1) &&
    Math.abs(value * 100 - cents(value)) < 0.0001 &&
    Math.abs(cents(value)) <= 999999999999
  );
}
function receipt(row) {
  return {
    ...row,
    receipt_code: `${Number(row.amount) > 0 ? "PT" : "PH"}-${String(row.id).padStart(8, "0")}`,
  };
}
function totals(rows) {
  const result = {
    received: 0,
    refunded: 0,
    adjustment: 0,
    net: 0,
    count: rows.length,
  };
  for (const row of rows) {
    const n = cents(row.amount);
    if (["reversal", "replacement"].includes(row.entry_type))
      result.adjustment += n;
    else if (n > 0) result.received += n;
    else result.refunded -= n;
    result.net += n;
  }
  return Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, k === "count" ? v : amount(v)]),
  );
}
module.exports = {
  METHODS,
  uuid,
  reason,
  digest,
  instrument,
  money,
  receipt,
  totals,
};
