import { $, esc, money, normalize } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { updateBookingCount } from "../../shared/bootstrap.js";
import { bookingRow } from "./view.js";
import { initStayDialog } from "./stay-dialog.js";
let bookings = [];
function render() {
  const query = normalize($("bookingSearch").value),
    status = $("bookingStatus").value;
  const rows = bookings.filter(
    (b) =>
      (!status || b.status === status) &&
      normalize(
        `${b.id} ${b.customer_name} ${b.customer_email} ${b.customer_phone} ${b.room_name}`,
      ).includes(query),
  );
  $("bookingCountBadge").textContent = bookings.filter((b) =>
    ["pending", "confirmed", "checked_in"].includes(b.status),
  ).length;
  $("bookingSummary").textContent =
    `${rows.length} đơn · Đã thu ròng ${money(rows.reduce((sum, b) => sum + Number(b.paid_amount), 0))} · Còn thu ${money(rows.reduce((sum, b) => sum + Number(b.balance_due), 0))}`;
  $("bookingsTableBody").innerHTML = rows.length
    ? rows.map(bookingRow).join("")
    : '<tr><td colspan="8" class="text-center py-4">Không có đơn đặt phòng phù hợp.</td></tr>';
}
async function load() {
  try {
    bookings = await api("/api/bookings");
    render();
  } catch (error) {
    $("bookingsTableBody").innerHTML =
      `<tr><td colspan="8">${esc(error.message)} <button class="btn btn-outline" data-action="refresh">Thử lại</button></td></tr>`;
  }
}
const openStay = initStayDialog(load);
$("bookingSearch").addEventListener("input", render);
$("bookingStatus").addEventListener("change", render);
$("btnRefreshBookings").addEventListener("click", load);
$("bookingsTableBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action,
    id = Number(button.dataset.id);
  if (action === "refresh") return load();
  if (
    action !== "history" &&
    !confirm(
      action === "confirm"
        ? `Tôi đã liên hệ kiểm tra thông tin người đặt và đồng ý xác nhận đơn #${id}. Email trùng không tự liên kết hồ sơ khách cũ. Duyệt đơn?`
        : `${{ cancel: "Hủy đơn", "check-in": "Nhận phòng", "check-out": "Trả phòng", "no-show": "Xác nhận khách không đến" }[action]} #${id}?`,
    )
  )
    return;
  button.disabled = true;
  try {
    if (action === "history") return await openStay(id);
    const reason = ["check-out", "no-show"].includes(action)
      ? prompt(
          action === "check-out"
            ? "Ghi lý do trả sớm/muộn nếu có. Trả sớm không tự giảm tiền; ghi phụ thu trước khi trả."
            : "Lý do/xác nhận đã kiểm tra khách không đến:",
          action === "check-out"
            ? "Khách yêu cầu trả phòng tại quầy"
            : "Đã kiểm tra và liên hệ, khách không đến",
        )
      : undefined;
    if (reason === null) return;
    await api(
      `/api/bookings/${id}/${action}`,
      "PUT",
      action === "confirm" ? { contactVerified: true } : { reason },
    );
    toast(
      {
        confirm: "Đã xác nhận đơn sau khi liên hệ khách",
        cancel: "Đã hủy đơn",
        "check-in": "Đã nhận phòng",
        "check-out": "Đã trả phòng",
        "no-show": "Đã đóng đơn khách không đến",
      }[action],
    );
    await Promise.all([load(), updateBookingCount()]);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
load();
// Refresh status/deadlines while staff keep the page open.
setInterval(() => {
  if (!document.hidden && !document.querySelector(".modal.show")) load();
}, 30000);
