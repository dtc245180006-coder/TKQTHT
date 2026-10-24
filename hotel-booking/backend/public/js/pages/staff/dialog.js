import { $ } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import {
  bindDialog,
  openDialog,
  closeDialog,
  setDialogBusy,
} from "../../components/dialog.js";
export function initStaffDialog(onChange) {
  let mode, selected;
  bindDialog("staffDialog", "[data-close-staff]");
  bindDialog("credentialDialog", "[data-close-credential]");
  const clearSecret = () => {
    $("temporaryPassword").value = "";
    $("temporaryPassword").type = "password";
  };
  document
    .querySelectorAll("[data-close-credential]")
    .forEach((node) => node.addEventListener("click", clearSecret));
  $("credentialDialog").addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearSecret();
  });
  window.addEventListener("pagehide", clearSecret);
  $("showTemporaryPassword").addEventListener("click", () => {
    $("temporaryPassword").type =
      $("temporaryPassword").type === "password" ? "text" : "password";
  });
  $("staffForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      adminPassword: $("staffAdminPassword").value,
      reason: $("staffReason").value.trim(),
    };
    if (mode === "create" || mode === "update")
      Object.assign(body, {
        username: $("staffUsername").value.trim(),
        displayName: $("staffDisplayName").value.trim(),
        role: $("staffRole").value,
        active: $("staffActive").checked,
      });
    const button = $("saveStaff");
    button.disabled = true;
    setDialogBusy("staffDialog", true);
    let saved = false;
    try {
      const url =
        mode === "create"
          ? "/api/staff"
          : `/api/staff/${selected.id}${mode === "update" ? "" : `/${mode}`}`;
      const result = await api(url, mode === "update" ? "PUT" : "POST", body);
      saved = true;
      $("staffAdminPassword").value = "";
      setDialogBusy("staffDialog", false);
      closeDialog("staffDialog");
      if (result.temporaryPassword) {
        $("credentialUsername").textContent =
          `Tài khoản: ${result.user.username}`;
        $("temporaryPassword").value = result.temporaryPassword;
        $("temporaryPassword").type = "password";
        openDialog("credentialDialog");
      } else toast("Đã cập nhật tài khoản / thu hồi phiên.");
      await onChange();
    } catch (error) {
      toast(
        saved
          ? "Thao tác đã lưu. Hãy làm mới danh sách để xem kết quả."
          : error.message,
        "error",
      );
    } finally {
      setDialogBusy("staffDialog", false);
      button.disabled = false;
    }
  });
  return (operation, user) => {
    mode = operation;
    selected = user;
    $("staffForm").reset();
    const details = mode === "create" || mode === "update";
    $("staffDetails").hidden = !details;
    $("staffDetails").disabled = !details;
    $("staffUsername").value = user?.username || "";
    $("staffUsername").disabled = mode !== "create";
    $("staffDisplayName").value = user?.displayName || "";
    $("staffRole").value = user?.role || "receptionist";
    $("staffActive").checked = user?.active ?? true;
    $("staffActive").disabled = mode === "create";
    $("staffDialogTitle").textContent = {
      create: "Thêm nhân viên",
      update: "Cập nhật nhân viên",
      "reset-password": "Cấp mật khẩu tạm",
      "revoke-sessions": "Thu hồi tất cả phiên",
    }[mode];
    $("staffDialogNote").textContent =
      mode === "create"
        ? "Hệ thống tạo mật khẩu tạm, hiển thị một lần sau khi lưu."
        : `${user.username} — ${mode === "reset-password" ? "Mật khẩu cũ mất hiệu lực; nhân viên phải đổi mật khẩu tạm." : "Thay đổi quyền/trạng thái hoặc thu hồi phiên sẽ yêu cầu đăng nhập lại."}`;
    openDialog("staffDialog");
  };
}
