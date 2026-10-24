import { $, esc, normalize } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { initStaffDialog } from "./dialog.js";
const time = (value) =>
  new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
let users = [],
  events = [],
  nextCursor;
const names = {
  "staff.create": "Tạo tài khoản",
  "staff.update": "Đổi thông tin/quyền/trạng thái",
  "staff.reset-password": "Cấp mật khẩu tạm",
  "staff.revoke-sessions": "Thu hồi phiên",
  "staff.change-password": "Đổi mật khẩu",
  "auth.login": "Xác thực đăng nhập",
  "auth.logout": "Đăng xuất",
  "room.create": "Thêm phòng",
  "room.update": "Sửa phòng",
  "room.delete": "Xóa phòng",
  "customer.create": "Thêm khách",
  "customer.update": "Sửa khách",
  "customer.delete": "Xóa hồ sơ khách",
};
function render() {
  const query = normalize($("staffSearch").value);
  $("staffBody").innerHTML =
    users
      .filter((user) =>
        normalize(`${user.username} ${user.displayName}`).includes(query),
      )
      .map(
        (user) =>
          `<tr><td><strong>${esc(user.displayName)}</strong><br><small>${esc(user.username)}</small></td><td>${user.role === "admin" ? "Quản trị" : "Lễ tân"}</td><td>${user.active ? "Đang hoạt động" : "Đã khóa"}${user.mustChangePassword ? "<br><small>Cần đổi mật khẩu tạm</small>" : ""}</td><td><div class="staff-actions">${[
            ["update", "Sửa / khóa"],
            ["reset-password", "Cấp mật khẩu tạm"],
            ["revoke-sessions", "Thu hồi phiên"],
          ]
            .map(
              ([action, label]) =>
                `<button class="btn btn-outline btn-sm" data-action="${action}" data-id="${user.id}">${label}</button>`,
            )
            .join("")}</div></td></tr>`,
      )
      .join("") || '<tr><td colspan="4">Không có nhân viên phù hợp.</td></tr>';
}
async function loadAudit(append = false) {
  const result = await api(
    `/api/staff/audit${append && nextCursor ? `?before=${nextCursor}` : ""}`,
  );
  events = append ? [...events, ...result.events] : result.events;
  nextCursor = result.nextCursor;
  $("staffAuditBody").innerHTML =
    events
      .map(
        (event) =>
          `<tr><td>${time(event.created_at)}</td><td>${esc(event.actor_name)}<br><small>#${event.actor_user_id || "—"}</small></td><td>${esc(names[event.action] || event.action)}</td><td>${esc(event.entity_type)} #${event.entity_id || "—"}<br>${esc(event.metadata.username || "")}<br>${esc(event.metadata.reason || "")}</td></tr>`,
      )
      .join("") || '<tr><td colspan="4">Chưa có nhật ký.</td></tr>';
  $("moreAudit").hidden = !nextCursor;
}
async function load() {
  $("staffError").hidden = true;
  try {
    users = await api("/api/staff");
    render();
    await loadAudit();
  } catch (error) {
    $("staffError").textContent = error.message;
    $("staffError").hidden = false;
  }
}
const open = initStaffDialog(load);
$("addStaff").addEventListener("click", () => open("create"));
$("staffSearch").addEventListener("input", render);
$("refreshStaff").addEventListener("click", load);
$("staffBody").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button)
    open(
      button.dataset.action,
      users.find((user) => user.id === Number(button.dataset.id)),
    );
});
$("moreAudit").addEventListener("click", async () => {
  $("moreAudit").disabled = true;
  try {
    await loadAudit(true);
  } catch (error) {
    $("staffError").textContent = error.message;
    $("staffError").hidden = false;
  } finally {
    $("moreAudit").disabled = false;
  }
});
load();
