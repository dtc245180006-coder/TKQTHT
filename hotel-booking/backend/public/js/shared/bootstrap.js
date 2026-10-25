import { $ } from "./format.js";
import { api } from "./api.js";
import { toast } from "../components/toast.js";
export async function updateBookingCount() {
  if (!$("bookingCountBadge")) return;
  try {
    $("bookingCountBadge").textContent = (await api("/api/bookings")).filter(
      (b) => ["pending", "confirmed", "checked_in"].includes(b.status),
    ).length;
  } catch {
    $("bookingCountBadge").textContent = "—";
  }
}
document.addEventListener(
  "error",
  (event) => {
    if (
      event.target.tagName === "IMG" &&
      !event.target.src.endsWith("room-placeholder.svg")
    )
      event.target.src = "/images/room-placeholder.svg";
  },
  true,
);
updateBookingCount();
$("logoutButton")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/auth/logout", "POST");
    window.location.assign("/login");
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
});
