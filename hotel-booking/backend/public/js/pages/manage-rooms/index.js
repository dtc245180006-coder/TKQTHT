import { $, esc, money } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { createEditor } from "../../components/editor.js";
import { roomFields, roomPayload } from "./form.js";
const state = { rooms: [] };
const openEditor = createEditor();
function renderAdminRooms() {
  $("roomAdminBody").innerHTML = state.rooms.length
    ? state.rooms
        .map(
          (r) =>
            `<tr><td><strong>${esc(r.name)}</strong><br><small>#${r.id}</small></td><td>${esc(r.type)}</td><td class="nowrap">${money(r.price_per_night)}</td><td>${r.capacity} khách</td><td><span class="badge-pill ${r.status === "available" ? "success" : "danger"}">${r.status === "available" ? "Sẵn sàng" : r.status === "retired" ? "Ngừng kinh doanh" : "Bảo trì"}</span></td><td class="nowrap"><button class="btn btn-outline btn-sm" data-action="edit-room" data-id="${r.id}">Sửa</button> <button class="btn btn-outline btn-sm" data-action="delete-room" data-id="${r.id}">Xóa</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="text-center py-4">Chưa có phòng. Nhấn Thêm phòng để bắt đầu.</td></tr>';
}
async function load() {
  try {
    state.rooms = await api("/api/rooms?includeRetired=true");
    renderAdminRooms();
  } catch (error) {
    $("roomAdminBody").innerHTML =
      `<tr><td colspan="6">${esc(error.message)} <button class="btn btn-outline" data-action="refresh">Thử lại</button></td></tr>`;
  }
}
function edit(id) {
  const row = state.rooms.find((row) => row.id === id) || {};
  openEditor({
    title: `${id ? "Cập nhật" : "Thêm"} phòng nghỉ`,
    fields: roomFields(row),
    onSave: async (body) => {
      await api(
        `/api/rooms${id ? "/" + id : ""}`,
        id ? "PUT" : "POST",
        roomPayload(body),
      );
      await load();
    },
  });
}
$("addRoom").addEventListener("click", () => edit());

$("roomAdminBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action,
    id = Number(button.dataset.id);
  if (action === "refresh") return load();
  if (action === "edit-room") return edit(id);
  if (action !== "delete-room" || !confirm(`Xóa phòng #${id}?`)) return;
  button.disabled = true;
  try {
    await api(`/api/rooms/${id}`, "DELETE");
    toast("Đã xóa");
    await load();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
load();
