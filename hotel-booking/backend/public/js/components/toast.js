import { $ } from "../shared/format.js";
export function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  $("toastContainer").append(node);
  setTimeout(() => node.remove(), 5000);
}
