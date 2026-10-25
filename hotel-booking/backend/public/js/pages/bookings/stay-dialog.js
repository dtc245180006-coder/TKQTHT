import { $, esc, money } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import {
  bindDialog,
  openDialog,
  setDialogBusy,
} from "../../components/dialog.js";
import { statusNames, time } from "./view.js";
import { initOperations } from "./operations.js";
import {initFinanceRequest} from './finance.js';
import {durableKey,clearDurableKey} from '../../shared/durable-key.js';
const eventNames = {
  confirm: "Duyệt đơn sau khi liên hệ khách",
  expired: "Hết hạn giữ phòng",
  created: "Tạo đơn",
  "check-in": "Nhận phòng",
  "check-out": "Trả phòng",
  cancel: "Hủy đơn",
  payment: "Thu tiền",
  refund: "Hoàn tiền",
  move: "Đổi phòng",
  extend: "Gia hạn",
  charge: "Ghi phụ thu/dịch vụ",
  'void-charge': "Hủy khoản phụ thu",
  'no-show': "Khách không đến",
};

export function initStayDialog(onChange) {
  let booking, requestKey;
  const renderFinance=initFinanceRequest(async id=>{render(await api(`/api/bookings/${id}/history`));await onChange();});
  const renderOperations = initOperations(async (id) => {
    render(await api(`/api/bookings/${id}/history`));
    await onChange();
  });
  bindDialog("stayDialog", "[data-close-stay]");
  function limits(resetAmount = true) {
    const refund = $("paymentKind").value === "refund";
    const max = Number(refund ? booking.paid_amount : booking.balance_due);
    $("paymentAmount").max = max;
    if (resetAmount) $("paymentAmount").value = max > 0 ? max : "";
    $("recordPayment").textContent = refund
      ? "Ghi nhận hoàn tiền"
      : "Ghi nhận thu tiền";
    $("recordPayment").disabled =
      max <= 0 || !["confirmed", "checked_in"].includes(booking.status);
  }
  function render(data) {
    renderFinance(data);
    renderOperations(data).catch((error) => toast(error.message, "error"));
    booking = data.booking;
    $("stayTitle").textContent = `Thanh toán và lịch sử đơn #${booking.id}`;
    $("stayGuest").textContent =
      `${booking.customer_name} · ${booking.guest_count} khách · ${statusNames[booking.status]}`;
    $("stayBalance").textContent =
      `Giá trị đơn ${money(booking.total_price)} · Giảm sau trả ${money(booking.credit_amount)} · Phải thanh toán ${money(booking.settlement_total)} · Thu ban đầu ${money(booking.received_amount)} · Hoàn ${money(booking.refunded_amount)} · Điều chỉnh sổ ${money(booking.adjustment_amount)} · Thu ròng ${money(booking.paid_amount)} · Còn ${money(booking.balance_due)}`;
    const snapshot = booking.booking_snapshot;
    $("staySnapshot").innerHTML = snapshot
      ? `<strong>${esc(snapshot.room?.name)} · ${esc(snapshot.room?.type)}</strong><br><small>${booking.revision_version ? "Thông tin phiên bản hiện tại" : "Thông tin khi đặt"}: ${time(snapshot.captured_at)}</small>${snapshot.pricing.items.map((item) => `<p>${esc(item.label)}: ${item.quantity} ${item.code === "room" ? "đêm" : "lượt"} × ${money(item.unit_price)} = ${money(item.amount)}</p>`).join("")}<small>Thuế không được tách riêng; chỉ ghi các khoản đã xác nhận với khách.</small>`
      : "<strong>Đơn cũ thiếu thông tin lịch sử</strong><p>Chưa lưu tên phòng, hạng phòng và đơn giá lúc đặt. Tổng tiền và ngày lưu trú dưới đây là dữ liệu đã lưu của đơn; không suy ra đơn giá từ danh mục hiện tại.</p>";
    const active = ["confirmed", "checked_in"].includes(booking.status);
    $("paymentFields").hidden = !active;
    $("paymentFields").disabled = !active;
    $("recordPayment").hidden = !active;
    limits();
    $("paymentHistory").innerHTML = data.payments.length
      ? data.payments
          .map(
            (p) => `<tr>
      <td>${time(p.created_at)}<br><a href="/receipts/${p.id}" target="_blank" rel="noopener">${esc(p.receipt_code)}</a></td><td>${p.entry_type==='reversal'?'Đảo bút toán':p.entry_type==='replacement'?'Phiếu thay thế':p.kind === "payment" ? "Thu tiền" : "Hoàn tiền"}</td>
      <td>${money(Math.abs(Number(p.amount)))}</td><td>${p.method === "cash" ? "Tiền mặt" :p.method==='wallet'?'Ví điện tử': "Chuyển khoản"}<br><small>${esc(p.reference)}</small></td><td>${esc(p.staff_name)}</td>
      </tr>`,
          )
          .join("")
      : '<tr><td colspan="5">Chưa có giao dịch.</td></tr>';
    $("stayEvents").innerHTML =
      data.events
        .map(
          (e) =>
            `<li>${time(e.created_at)} · ${esc(eventNames[e.action] || e.action)} · ${esc(e.staff_name)}</li>`,
        )
        .join("") || "<li>Đơn cũ chưa có lịch sử thao tác.</li>";
  }
  $("paymentKind").addEventListener("change", () => limits());
  $("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      $("paymentKind").value === "refund" &&
      !confirm(`Xác nhận đã hoàn ${money($("paymentAmount").value)} cho khách?`)
    )
      return;
    const button = $("recordPayment");
    button.disabled = true;
    setDialogBusy("stayDialog", true);
    let recorded = false;
    let refreshed = false;
    try {
      const body={
        kind: $("paymentKind").value,
        amount: Number($("paymentAmount").value),
        method: $("paymentMethod").value,
        reference: $("paymentReference").value.trim(),
        moneyConfirmed:$('paymentConfirmed').checked,
      };
      requestKey=await durableKey(`payment-${booking.id}`,body);
      await api(`/api/bookings/${booking.id}/payments`, "POST", {...body,requestKey});
      recorded = true;
      clearDurableKey(`payment-${booking.id}`);
      requestKey = crypto.randomUUID();
      $("paymentReference").value = "";
      $('paymentConfirmed').checked=false;
      toast("Đã ghi nhận giao dịch");
      render(await api(`/api/bookings/${booking.id}/history`));
      refreshed = true;
      button.disabled = true;
      await onChange();
    } catch (error) {
      toast(
        recorded
          ? "Giao dịch đã lưu. Hãy đóng và mở lại lịch sử để tải dữ liệu mới."
          : error.message,
        "error",
      );
    } finally {
      setDialogBusy("stayDialog", false);
      if (booking && (!recorded || refreshed)) limits(false);
    }
  });
  return async (id) => {
    $("paymentForm").reset();
    requestKey = crypto.randomUUID();
    render(await api(`/api/bookings/${id}/history`));
    openDialog("stayDialog");
  };
}
