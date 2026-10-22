import { $, esc, money, nextDay } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { time } from "./view.js";
export function initOperations(reload) {
  let booking,
    rooms = [],
    key = crypto.randomUUID(),
    busy = false;
  const names = {
    move: "Đổi phòng",
    extend: "Gia hạn",
    charge: "Ghi phụ thu/dịch vụ",
    "void-charge": "Hủy khoản phụ thu",
  };
  const showFields = () => {
    const action = $("stayAction").value;
    document
      .querySelectorAll("[data-stay-field]")
      .forEach((node) => (node.hidden = node.dataset.stayField !== action));
    $("legacyCreditField").hidden = !(
      action === "move" &&
      booking?.status === "checked_in" &&
      (!booking.booking_snapshot ||
        booking.booking_snapshot.pricing.items.some((i) => i.code === "legacy"))
    );
    $("stayQuote").textContent =
      action === "extend"
        ? "Đêm gia hạn tính theo giá danh mục hiện tại; tiền phòng đã đặt giữ nguyên."
        : action === "move"
          ? "Trước nhận phòng: tính lại tiền phòng theo phòng mới. Đang ở: giữ các đêm đã ở, tính phòng mới từ hôm nay; phần giảm làm phát sinh tiền cần hoàn nếu đã thu dư."
          : "Khoản điều chỉnh được lưu cùng người thực hiện và lý do; khoản gốc vẫn còn trong lịch sử.";
  };
  $("stayAction").addEventListener("change", () => {
    key = crypto.randomUUID();
    showFields();
  });
  $("stayOperations").addEventListener("input", () => {
    if (!busy) key = crypto.randomUUID();
  });
  $("saveStayOperation").addEventListener("click", async () => {
    if (busy) return;
    const action = $("stayAction").value;
    const body = {
      action,
      requestKey: key,
      expectedVersion: booking.revision_version || 0,
      reason: $("stayReason").value.trim(),
    };
    if (action === "extend") body.checkOutDate = $("stayNewCheckout").value;
    if (action === "move") body.roomId = Number($("stayNewRoom").value);
    if (
      action === "move" &&
      !$("legacyCreditField").hidden &&
      $("stayAgreedCredit").value !== ""
    )
      body.agreedCredit = Number($("stayAgreedCredit").value);
    if (action === "charge")
      Object.assign(body, {
        label: $("stayChargeLabel").value,
        quantity: Number($("stayQuantity").value),
        unitPrice: Number($("stayUnitPrice").value),
      });
    if (action === "void-charge") body.chargeId = $("stayVoidCharge").value;
    if (body.reason.length < 5)
      return toast("Nhập lý do ít nhất 5 ký tự.", "error");
    busy = true;
    $("saveStayOperation").disabled = true;
    try {
      const quote = await api(
        `/api/bookings/${booking.id}/revision-quote`,
        "POST",
        body,
      );
      if (quote.replayed) {
        key = crypto.randomUUID();
        await reload(booking.id);
        toast("Điều chỉnh này đã được lưu trước đó; đã tải lại đơn.");
        return;
      }
      $("stayQuote").textContent =
        `Chênh lệch ${money(quote.delta)} · Tổng mới ${money(quote.total)} · Tiền cần hoàn ${money(quote.refundDue)}`;
      if (
        !confirm(
          `${names[action]} cho đơn #${booking.id}?\nChênh lệch: ${money(quote.delta)}\nTổng mới: ${money(quote.total)}\nCần hoàn: ${money(quote.refundDue)}\nLưu điều chỉnh và đối chiếu thu/hoàn với khách?`,
        )
      )
        return;
      await api(`/api/bookings/${booking.id}/revisions`, "POST", {
        ...body,
        quoteToken: quote.quoteToken,
      });
      key = crypto.randomUUID();
      await reload(booking.id);
      toast("Đã lưu điều chỉnh; kiểm tra tổng và số dư mới.");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      busy = false;
      $("saveStayOperation").disabled = false;
    }
  });
  return async (data) => {
    booking = data.booking;
    key = crypto.randomUUID();
    $("stayOperations").hidden = !["confirmed", "checked_in"].includes(
      booking.status,
    );
    $("stayOriginal").textContent =
      `Giá gốc: ${money(data.original?.total ?? booking.total_price)} · ${data.original?.snapshot ? data.original.snapshot.room.name : "Đơn cũ thiếu bản chụp phòng/đơn giá"}`;
    $("stayRevisions").innerHTML =
      (data.revisions || [])
        .map(
          (r) =>
            `<li>v${r.version} · ${time(r.created_at)} · ${esc(names[r.action])} · ${esc(r.actor_name)}<br>${esc(r.reason)} · Chênh lệch ${money(r.delta)} · Tổng ${money(r.state.total_price)}<br>Phòng ${esc(r.state.booking_snapshot?.room?.name)} · Trả ${esc(r.state.check_out_date)}</li>`,
        )
        .join("") || "<li>Chưa có điều chỉnh.</li>";
    $("stayNewCheckout").min = nextDay(booking.check_out_date);
    $("stayNewCheckout").value = nextDay(booking.check_out_date);
    $("stayReason").value = "";
    $("stayChargeLabel").value = "";
    $("stayUnitPrice").value = "";
    $("stayAgreedCredit").value = "";
    $("stayVoidCharge").innerHTML = (
      booking.booking_snapshot?.pricing.items || []
    )
      .filter((i) => i.code === "service")
      .map(
        (i) =>
          `<option value="${esc(i.charge_id)}">${esc(i.label)} · ${money(i.amount)}</option>`,
      )
      .join("");
    if (!$("stayOperations").hidden) {
      rooms = await api("/api/rooms");
      $("stayNewRoom").innerHTML = rooms
        .filter(
          (r) =>
            r.id !== booking.room_id &&
            r.status === "available" &&
            r.capacity >= booking.guest_count,
        )
        .map(
          (r) =>
            `<option value="${r.id}">${esc(r.name)} · ${money(r.price_per_night)} · ${r.cleaning_status === "ready" || !r.cleaning_status ? "Sẵn sàng" : "Chưa dọn xong"}</option>`,
        )
        .join("");
    }
    showFields();
  };
}
