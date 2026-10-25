import { $, esc, money, today } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import {
  bindDialog,
  openDialog,
  closeDialog,
} from "../../components/dialog.js";
import { durableKey, clearDurableKey } from "../../shared/durable-key.js";
import { time } from "../bookings/view.js";
const methods = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  wallet: "Ví điện tử",
};
const actions = {
  correct: "Sửa sai phiếu",
  post_refund: "Hoàn/giảm sau trả phòng",
  post_payment: "Thu công nợ sau trả phòng",
};
const entryNames = {
  normal: "Thu/hoàn thông thường",
  reversal: "Bút toán đảo",
  replacement: "Phiếu thay thế",
  post_refund: "Hoàn/giảm sau trả",
  post_payment: "Thu công nợ sau trả",
};
let report,
  requests = [],
  selected,
  outcome;
const admin = document.body.dataset.role === "admin";
$("financeDate").value = today();
async function load() {
  try {
    const [data, rows] = await Promise.all([
      api(
        `/api/finance/report?date=${encodeURIComponent($("financeDate").value)}`,
      ),
      api("/api/finance/requests"),
    ]);
    report = data;
    requests = rows;
    $("financeTotals").textContent =
      `${data.date} · ${data.count} bút toán · Thu ${money(data.totals.received)} · Hoàn ${money(data.totals.refunded)} · Điều chỉnh ${money(data.totals.adjustment)} · Thu ròng ${money(data.totals.net)}`;
    $("financeMethodBody").innerHTML = Object.entries(data.byMethod)
      .map(
        ([method, t]) =>
          `<tr><td>${methods[method]}</td><td>${money(t.received)}</td><td>${money(t.refunded)}</td><td>${money(t.adjustment)}</td><td>${money(t.net)}</td></tr>`,
      )
      .join("");
    $("financeEntryBody").innerHTML =
      data.entries
        .map(
          (p) =>
            `<tr><td><a href="/receipts/${p.id}" target="_blank" rel="noopener">${esc(p.receipt_code)}</a><br>#${p.booking_id}</td><td>${time(p.created_at)}</td><td>${entryNames[p.entry_type] || entryNames.normal}</td><td>${money(p.amount)}</td><td>${methods[p.method]}<br>${esc(p.reference)}</td><td>${esc(p.staff_name)}</td></tr>`,
        )
        .join("") || '<tr><td colspan="6">Chưa có phiếu trong ngày.</td></tr>';
    $("financeEntryLimit").textContent = data.entriesTruncated
      ? "Hiển thị 500 phiếu gần nhất; tổng ở trên tính toàn bộ phiếu trong ngày."
      : "";
    $("financeDebtNote").textContent =
      `Công nợ tại ${time(data.debtAsOf)}, không phải công nợ cuối ngày đã chọn: ${money(data.debtTotal)}.`;
    $("financeDebtBody").innerHTML =
      data.debts
        .map(
          (b) =>
            `<tr><td>#${b.id}</td><td>${esc(b.customer_name)}</td><td>${money(b.settlement_total)}</td><td>${money(b.paid_amount)}</td><td>${money(b.balance_due)}</td></tr>`,
        )
        .join("") || '<tr><td colspan="5">Không có công nợ hiện tại.</td></tr>';
    $("reconciliationHistory").innerHTML =
      data.reconciliations
        .map(
          (r) =>
            `<li>#${r.id} · ${time(r.created_at)} · ${esc(r.staff_name)} · ${r.stale ? "Có phiếu mới, cần đối soát lại" : "Khớp phiên bản sổ hiện tại"}<br>Chênh lệch: ${Object.keys(
              methods,
            )
              .map((m) => `${methods[m]} ${money(r.difference[m])}`)
              .join(" · ")}<br>${esc(r.reason)}</li>`,
        )
        .join("") || "<li>Chưa có biên bản đối soát ngày này.</li>";
    $("financeRequestBody").innerHTML =
      rows
        .map(
          (r) =>
            `<tr><td>#${r.id} / đơn #${r.booking_id}</td><td>${actions[r.payload.action]} ${r.payload.paymentId ? `<a href="/receipts/${r.payload.paymentId}" target="_blank" rel="noopener">Phiếu gốc</a>` : ""}<br>${money(r.payload.amount)} · ${methods[r.payload.method]} · ${esc(r.payload.reference)}<br>${esc(r.payload.reason)}</td><td>${esc(r.requester_name)}<br>${time(r.created_at)}</td><td>${r.outcome ? `${r.outcome === "approved" ? "Đã duyệt" : "Từ chối"} · ${esc(r.approver_name)}<br>${esc(r.decision_reason)}` : admin ? `<button class="btn btn-outline btn-sm" data-decision="approved" data-id="${r.id}">Duyệt</button> <button class="btn btn-outline btn-sm" data-decision="rejected" data-id="${r.id}">Từ chối</button>` : "Chờ quản trị duyệt"}</td></tr>`,
        )
        .join("") || '<tr><td colspan="4">Chưa có yêu cầu.</td></tr>';
  } catch (error) {
    toast(error.message, "error");
  }
}
$("financeReportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  load();
});
$("financeReconcileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!report) return;
  const body = {
    date: report.date,
    reportDigest: report.digest,
    actual: {
      cash: Number($("actualCash").value),
      bank_transfer: Number($("actualBank").value),
      wallet: Number($("actualWallet").value),
    },
    reason: $("reconcileReason").value.trim(),
  };
  const button = $("saveReconciliation");
  button.disabled = true;
  try {
    body.requestKey = await durableKey("reconcile", body);
    await api("/api/finance/reconciliations", "POST", body);
    clearDurableKey("reconcile");
    toast("Đã lưu biên bản và chênh lệch");
    await load();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
if (admin) {
  bindDialog("financeApprovalDialog", "[data-close-approval]");
  $("financeRequestBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]");
    if (!button) return;
    selected = requests.find((r) => Number(r.id) === Number(button.dataset.id));
    outcome = button.dataset.decision;
    $("financeApprovalForm").reset();
    $("approvalTitle").textContent =
      outcome === "approved"
        ? `Duyệt yêu cầu #${selected.id}`
        : `Từ chối yêu cầu #${selected.id}`;
    $("approvalSummary").textContent =
      `Đơn #${selected.booking_id}: ${actions[selected.payload.action]} · ${money(selected.payload.amount)} · ${methods[selected.payload.method]} · ${selected.payload.reference} · ${selected.payload.reason}`;
    $("approvalConfirmedLabel").hidden = outcome !== "approved";
    $("approvalConfirmed").required = outcome === "approved";
    openDialog("financeApprovalDialog");
  });
  $("financeApprovalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("saveFinanceDecision");
    button.disabled = true;
    try {
      await api(`/api/finance/requests/${selected.id}/decision`, "POST", {
        outcome,
        reason: $("approvalReason").value,
        currentPassword: $("approvalPassword").value,
        moneyConfirmed: $("approvalConfirmed").checked,
      });
      $("approvalPassword").value = "";
      closeDialog("financeApprovalDialog");
      toast("Đã ghi quyết định");
      await load();
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
}
load();
