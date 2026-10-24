import { $, esc } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
const labels = { dirty: "Chờ dọn", cleaning: "Đang dọn", ready: "Sẵn sàng" };
let rooms = [];
async function load() {
  try {
    const [rows, stays] = await Promise.all([
      api("/api/rooms?includeRetired=true"),
      api("/api/bookings"),
    ]);
    rooms = rows;
    const occupied = new Set(
      stays.filter((b) => b.status === "checked_in").map((b) => b.room_id),
    );
    $("cleaningBody").innerHTML = rows
      .map((r) => {
        const status = r.cleaning_status || "ready",
          next = { dirty: "cleaning", cleaning: "ready", ready: "dirty" }[
            status
          ];
        return `<tr><td>${esc(r.name)} <small>#${r.id}</small></td><td>${r.status === "available" ? "Kinh doanh" : r.status === "retired" ? "Ngừng kinh doanh" : "Bảo trì"}</td><td>${occupied.has(r.id) ? "Đang có khách" : "Không có khách"}</td><td>${labels[status]}</td><td><button type="button" class="btn btn-outline btn-sm" data-id="${r.id}" data-next="${next}" ${occupied.has(r.id) ? "disabled" : ""}>${next === "cleaning" ? "Bắt đầu dọn" : next === "ready" ? "Xác nhận sạch" : "Đánh dấu chờ dọn"}</button></td></tr>`;
      })
      .join("");
  } catch (error) {
    toast(error.message, "error");
  }
}
$("refreshCleaning").addEventListener("click", load);
$("cleaningBody").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) return;
  const room = rooms.find((r) => r.id === Number(button.dataset.id));
  if (
    !confirm(`Phòng ${room.name}: chuyển sang ${labels[button.dataset.next]}?`)
  )
    return;
  button.disabled = true;
  try {
    await api(`/api/rooms/${room.id}/cleaning`, "PUT", {
      status: button.dataset.next,
      expectedStatus: room.cleaning_status || "ready",
    });
    await load();
    toast("Đã cập nhật dọn phòng");
  } catch (error) {
    toast(error.message, "error");
    await load();
  }
});
load();
