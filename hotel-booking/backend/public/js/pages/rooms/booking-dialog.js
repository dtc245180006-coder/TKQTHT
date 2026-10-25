import { $, money, today, nextDay, image } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import {
  openDialog,
  closeDialog,
  bindDialog,
  setDialogBusy,
} from "../../components/dialog.js";
import { updateBookingCount } from "../../shared/bootstrap.js";
import { requestKey, clearRequestKey } from "./request-key.js";
export function initBookingDialog({ getRooms, onBooked }) {
  const state = {
    selected: null,
    get results() {
      return getRooms();
    },
  };
  function openBooking(id) {
    const room = state.results.find((r) => r.id === id);
    if (!room || room.status !== "available") return;
    state.selected = room;
    $("bookingForm").reset();
    $("modalRoomId").value = id;
    $("modalGuests").max = room.capacity;
    $("modalGuests").value = $("guestsInput").value || 1;
    $("modalRoomImg").src = image(room.image_url);
    $("modalRoomImg").alt = room.name;
    $("modalRoomName").textContent = room.name;
    $("modalRoomType").textContent =
      `${room.type} · Tối đa ${room.capacity} khách`;
    $("modalRoomPrice").textContent = `${money(room.price_per_night)} / đêm`;
    $("modalCheckIn").min = today();
    $("modalCheckIn").value = $("checkInInput").value || today();
    $("modalCheckOut").min = nextDay($("modalCheckIn").value);
    $("modalCheckOut").value =
      $("checkOutInput").value || $("modalCheckOut").min;
    priceSummary();
    openDialog("bookingModal");
  }
  function priceSummary() {
    const start = $("modalCheckIn").value,
      end = $("modalCheckOut").value;
    if (start) $("modalCheckOut").min = nextDay(start);
    const nights = (Date.parse(end) - Date.parse(start)) / 86400000;
    $("summaryNights").textContent =
      nights > 0 ? `${nights} đêm` : "Ngày lưu trú chưa hợp lệ";
    $("summaryTotalPrice").textContent =
      nights > 0 ? money(nights * state.selected.price_per_night) : "—";
  }
  async function submitBooking(event) {
    event.preventDefault();
    const button = $("btnSubmitBooking");
    button.disabled = true;
    setDialogBusy("bookingModal", true);
    button.textContent = "Đang đặt phòng...";
    try {
      const payload = {
        roomId: state.selected.id,
        customerName: $("custName").value.trim(),
        customerPhone: $("custPhone").value.trim(),
        customerEmail: $("custEmail").value.trim(),
        checkInDate: $("modalCheckIn").value,
        checkOutDate: $("modalCheckOut").value,
        guests: Number($("modalGuests").value),
      };
      const result = await api("/api/bookings", "POST", {
        ...payload,
        requestKey: await requestKey(payload),
      });
      clearRequestKey();
      button.disabled = false;
      setDialogBusy("bookingModal", false);
      closeDialog("bookingModal");
      const message =
        result.status === "pending"
          ? `Yêu cầu #${result.id} đang chờ lễ tân liên hệ và duyệt. Giữ phòng đến ${new Date(result.hold_expires_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}. Chưa phải đơn đã xác nhận.`
          : result.status === "expired"
            ? `Yêu cầu #${result.id} đã hết hạn. Vui lòng tìm phòng và gửi yêu cầu mới.`
            : result.status === "confirmed"
              ? `Đã xác nhận đặt phòng #${result.id}.`
              : `Yêu cầu #${result.id}: ${result.status === "cancelled" ? "đã hủy" : "đã xử lý"}.`;
      $("bookingRequestResult").textContent = message;
      $("bookingRequestResult").hidden = false;
      $("bookingRequestResult").scrollIntoView({ block: "center" });
      toast(message);
      await Promise.all([onBooked(), updateBookingCount()]);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setDialogBusy("bookingModal", false);
      button.disabled = false;
      button.textContent =
        document.body.dataset.role === "guest"
          ? "Gửi yêu cầu đặt phòng"
          : "Xác nhận đặt phòng";
    }
  }
  bindDialog("bookingModal", "#btnCloseModal, #btnCancelModal, #modalBackdrop");
  $("bookingForm").addEventListener("submit", submitBooking);
  ["modalCheckIn", "modalCheckOut"].forEach((id) =>
    $(id).addEventListener("change", priceSummary),
  );
  return openBooking;
}
