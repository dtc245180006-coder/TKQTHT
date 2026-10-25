import { $ } from "../../shared/format.js";
import { api } from "../../shared/api.js";
$("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("passwordError"),
    button = $("changePassword");
  error.hidden = true;
  if ($("newPassword").value !== $("confirmPassword").value) {
    error.textContent = "Hai mật khẩu mới chưa khớp.";
    error.hidden = false;
    return;
  }
  button.disabled = true;
  try {
    await api("/api/auth/password", "POST", {
      currentPassword: $("currentPassword").value,
      newPassword: $("newPassword").value,
    });
    $("passwordForm").reset();
    window.location.assign("/login?passwordChanged=1");
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
