import { $ } from "../../shared/format.js";
import { api } from "../../shared/api.js";

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("loginSubmit"),
    error = $("loginError");
  button.disabled = true;
  button.textContent = "Đang đăng nhập...";
  error.hidden = true;
  try {
    const result = await api("/api/auth/login", "POST", {
      username: $("username").value.trim(),
      password: $("password").value,
      next: $("nextPath").value,
    });
    window.location.assign(result.next);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
    $("password").value = "";
    $("password").focus();
  } finally {
    button.disabled = false;
    button.textContent = "Đăng nhập";
  }
});
