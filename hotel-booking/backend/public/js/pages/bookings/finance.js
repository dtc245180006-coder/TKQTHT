import { $, esc, money } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { time } from "./view.js";
import { durableKey, clearDurableKey } from "../../shared/durable-key.js";
export function initFinanceRequest(reload) {
  let data,
    key = crypto.randomUUID(),
    busy = false;
  const admin = document.body.dataset.role === "admin";
  $("financeAction").addEventListener("change", () => {
    $("financeTargetField").hidden = $("financeAction").value !== "correct";
    key = crypto.randomUUID();
  });
  $("financeRequestSection").addEventListener("input", () => {
    if (!busy) key = crypto.randomUUID();
  });
  $("submitFinanceRequest").addEventListener("click", async () => {
    if (busy) return;
    const body = {
      bookingId: data.booking.id,
      action: $("financeAction").value,
      paymentId: Number($("financePaymentId").value),
      amount: Number($("financeAmount").value),
      method: $("financeMethod").value,
      reference: $("financeReference").value.trim(),
      reason: $("financeReason").value.trim(),
      requestKey: key,
      expectedLedgerId: data.payments.at(-1)?.id || 0,
      expectedRevision: data.booking.revision_version || 0,
      executeNow: admin,
      moneyConfirmed: $("financeConfirmed")?.checked || false,
      ...(admin ? { currentPassword: $("financePassword").value } : {}),
    };
    if ($("financeAmount").value === "")
      return toast("Nhập số tiền đúng để đối chiếu.", "error");
    if (
      !confirm(
        admin
          ? "Ghi điều chỉnh đã đối chiếu? Phiếu gốc giữ nguyên."
          : "Gửi yêu cầu? Chưa ghi tiền, chờ quản trị duyệt.",
      )
    )
      return;
    busy = true;
    $("submitFinanceRequest").disabled = true;
    try {
      body.requestKey = await durableKey(`finance-request-${data.booking.id}`, {
        action: body.action,
        paymentId: body.action === "correct" ? body.paymentId : null,
        amount: body.amount,
        method: body.method,
        reference: body.reference,
        reason: body.reason,
        executeNow: body.executeNow,
      });
      await api("/api/finance/requests", "POST", body);
      clearDurableKey(`finance-request-${data.booking.id}`);
      key = crypto.randomUUID();
      if ($("financePassword")) $("financePassword").value = "";
      await reload(data.booking.id);
      toast(admin ? "Đã ghi điều chỉnh" : "Đã gửi yêu cầu duyệt");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy = false;
      $("submitFinanceRequest").disabled = false;
    }
  });
  return (value) => {
    data = value;
    key = crypto.randomUUID();
    const reversed = new Set(
      data.payments
        .filter((p) => p.reverses_payment_id)
        .map((p) => Number(p.reverses_payment_id)),
    );
    $("financePaymentId").innerHTML = data.payments
      .filter((p) => p.entry_type !== "reversal" && !reversed.has(p.id))
      .map(
        (p) =>
          `<option value="${p.id}">${esc(p.receipt_code)} · ${money(Math.abs(Number(p.amount)))} · ${p.kind === "payment" ? "Thu" : "Hoàn"}</option>`,
      )
      .join("");
    $("financeAmount").value = "";
    $("financeReference").value = "";
    $("financeReason").value = "";
    if ($("financeConfirmed")) $("financeConfirmed").checked = false;
    if ($("financePassword")) $("financePassword").value = "";
    $("bookingFinanceRequests").innerHTML = (data.financeRequests || [])
      .map(
        (r) =>
          `<li>Yêu cầu #${r.id} · ${time(r.created_at)} · ${esc(r.requester_name)} · ${r.outcome === "approved" ? "Đã duyệt" : r.outcome === "rejected" ? "Từ chối" : "Chờ duyệt"}<br>${esc(r.payload.reason)}${r.approver_name ? ` · ${esc(r.approver_name)}: ${esc(r.decision_reason)}` : ""}</li>`,
      )
      .join("");
  };
}
