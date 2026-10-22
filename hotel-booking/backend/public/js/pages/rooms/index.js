import { $, esc, money, today, nextDay, image } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { initBookingDialog } from "./booking-dialog.js";
const state = { results: [], version: 0 };
async function searchRooms() {
  const version = ++state.version;
  const params = new URLSearchParams({
    type: $("filterType").value,
    guests: $("guestsInput").value,
  });
  const start = $("checkInInput").value,
    end = $("checkOutInput").value;
  if ((start || end) && (!start || !end || start < today() || end <= start)) {
    toast("Chọn đủ ngày lưu trú hợp lệ, ngày trả phải sau ngày nhận.", "error");
    return;
  }
  if (start) {
    params.set("checkIn", start);
    params.set("checkOut", end);
  }
  $("roomsGrid").innerHTML =
    '<div class="loading-state"><div class="spinner"></div><p>Đang tìm phòng...</p></div>';
  document.querySelectorAll(".pill").forEach((p) => {
    const active = p.dataset.type === $("filterType").value;
    p.classList.toggle("active", active);
    p.setAttribute("aria-pressed", active);
  });
  try {
    const rooms = await api(`/api/rooms?${params}`);
    if (version === state.version) {
      state.results = rooms;
      renderRooms();
    }
  } catch (e) {
    if (version === state.version)
      $("roomsGrid").innerHTML =
        `<div class="empty-state">${esc(e.message)}<br><button class="btn btn-outline" data-action="retry">Thử lại</button></div>`;
  }
}
function renderRooms() {
  const rooms = [...state.results];
  if ($("roomSort").value !== "default")
    rooms.sort(
      (a, b) =>
        ($("roomSort").value === "priceAsc" ? 1 : -1) *
        (a.price_per_night - b.price_per_night),
    );
  $("roomResults").textContent =
    `${rooms.length} phòng phù hợp${$("checkInInput").value ? " trong khoảng ngày đã chọn" : ""}`;
  $("roomsGrid").innerHTML = rooms.length
    ? rooms
        .map(
          (r) => `<article class="room-card">
    <div class="room-thumb-wrapper"><img src="${esc(image(r.image_url))}" alt="${esc(r.name)}" class="room-thumb" loading="lazy"><span class="room-type-badge">${esc(r.type)}</span></div>
    <div class="room-body"><h3 class="room-title">${esc(r.name)}</h3><p class="room-desc">${esc(r.description)}</p>
    <div class="room-amenities">${(r.amenities || [])
      .slice(0, 3)
      .map((a) => `<span class="amenity-tag">${esc(a)}</span>`)
      .join(
        "",
      )}<span class="amenity-tag">Tối đa ${r.capacity} khách</span></div>
    <div class="room-footer"><div class="room-price"><span class="price-amount">${money(r.price_per_night)}</span><span class="price-unit">mỗi đêm</span></div><button class="btn btn-gold btn-sm" data-action="book" data-id="${r.id}" ${r.status !== "available" ? "disabled" : ""}>${r.status === "available" ? "Đặt phòng" : "Đang bảo trì"}</button></div></div></article>`,
        )
        .join("")
    : '<div class="empty-state">Không có phòng phù hợp. Hãy thử ngày khác hoặc xóa bộ lọc.</div>';
}
const openBooking = initBookingDialog({
  getRooms: () => state.results,
  onBooked: searchRooms,
});
$("checkInInput").min = today();
$("checkOutInput").min = nextDay(today());
$("checkInInput").addEventListener("change", () => {
  const value = $("checkInInput").value;
  if (!value) return;
  $("checkOutInput").min = nextDay(value);
  if ($("checkOutInput").value <= value)
    $("checkOutInput").value = $("checkOutInput").min;
});
$("btnFilterRooms").addEventListener("click", async () => {
  await searchRooms();
  $("rooms-section").scrollIntoView({ behavior: "smooth" });
});
document.querySelectorAll(".pill").forEach((p) =>
  p.addEventListener("click", () => {
    $("filterType").value = p.dataset.type;
    searchRooms();
  }),
);
$("resetFilters").addEventListener("click", () => {
  $("filterType").value = "";
  $("checkInInput").value = "";
  $("checkOutInput").value = "";
  $("guestsInput").value = 1;
  $("roomSort").value = "default";
  searchRooms();
});
$("roomSort").addEventListener("change", renderRooms);
$("roomsGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button?.dataset.action === "book") openBooking(Number(button.dataset.id));
  if (button?.dataset.action === "retry") searchRooms();
});
searchRooms();
