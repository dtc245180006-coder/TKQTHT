import { esc, money, day, today } from "../../shared/format.js";
export const statusNames = {
  pending: "Chờ lễ tân duyệt",
  expired: "Đã hết hạn",
  confirmed: "Đã xác nhận",
  checked_in: "Đang lưu trú",
  checked_out: "Đã trả phòng",
  cancelled: "Đã hủy",
  no_show: "Khách không đến",
};
const paymentNames = {
  paid: "Đã thu đủ",
  partial: "Đã thu một phần",
  refunded: "Đã hoàn hết",
  unpaid: "Chưa thu tiền",
};
export const time = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Ho_Chi_Minh",
      }).format(new Date(value))
    : "";
function button(action, id, label, disabled = false, title = "") {
  return `<button class="btn btn-outline btn-sm" data-action="${action}" data-id="${id}" ${disabled ? "disabled" : ""} title="${esc(title)}">${label}</button>`;
}
export function bookingRow(b) {
  const active = ["confirmed", "checked_in"].includes(b.status);
  const canArrive = b.check_in_date <= today() && today() < b.check_out_date;
  const actions = [
    button("history", b.id, active ? "Thu / hoàn tiền" : "Xem lịch sử"),
  ];
  if (b.status === "pending")
    actions.push(
      button("confirm", b.id, "Duyệt đơn"),
      button("cancel", b.id, "Hủy đơn"),
    );
  if (b.status === "confirmed") {
    if (b.check_in_date < today())
      actions.push(button("no-show", b.id, "Khách không đến"));
    actions.push(
      button(
        "check-in",
        b.id,
        "Nhận phòng",
        !canArrive,
        "Nhận phòng trong ngày lưu trú đã đặt",
      ),
    );
    actions.push(
      button(
        "cancel",
        b.id,
        "Hủy đơn",
        Number(b.paid_amount) > 0,
        "Hoàn hết tiền đã thu trước khi hủy",
      ),
    );
  }
  if (b.status === "checked_in")
    actions.push(
      button(
        "check-out",
        b.id,
        "Trả phòng",
        Number(b.balance_due) > 0,
        "Thanh toán đủ trước khi trả phòng",
      ),
    );
  return `<tr>
    <td><strong>#${b.id}</strong></td>
    <td>${esc(b.customer_name)}</td>
    <td>${esc(b.customer_phone)}<br><small>${esc(b.customer_email)}</small></td>
    <td><strong>${esc(b.room_name || `Chưa lưu tên phòng (#${b.room_id ?? "không còn mã"})`)}</strong><br><small>${esc(b.room_type || "Chưa lưu hạng phòng")}</small> · <small>${b.guest_count} khách</small>${!b.history_complete ? "<br><small>Đơn cũ thiếu thông tin phòng/đơn giá lịch sử</small>" : ""}</td>
    <td class="nowrap">${day(b.check_in_date)}<br>→ ${day(b.check_out_date)}
      ${b.checked_in_at ? `<br><small>Nhận: ${time(b.checked_in_at)}</small>` : ""}
      ${b.checked_out_at ? `<br><small>Trả: ${time(b.checked_out_at)}</small>` : ""}
    </td>
    <td class="nowrap">Tổng: ${money(b.total_price)}<br><small>Đã thu ròng: ${money(b.paid_amount)}</small><br><strong>Còn: ${money(b.balance_due)}</strong></td>
    <td><span class="badge-pill ${["cancelled", "expired"].includes(b.status) ? "danger" : "success"}">${statusNames[b.status]}</span><br><small>${paymentNames[b.payment_status]}</small>${b.status === "pending" ? `<br><small>Giữ đến: ${time(b.hold_expires_at)}</small>` : ""}${b.customer_id == null ? "<br><small>Chưa liên kết hồ sơ khách</small>" : ""}</td>
    <td><div class="booking-actions">${actions.join("")}</div></td>
  </tr>`;
}
