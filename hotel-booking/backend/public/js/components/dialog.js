import { $ } from "../shared/format.js";
let previousFocus;
export function openDialog(id) {
  previousFocus = document.activeElement;
  $(id).classList.add("show");
  document.body.classList.add("modal-open");
  $(id).querySelector("input:not([type=hidden]), button").focus();
}
export function closeDialog(id) {
  if ($(id).getAttribute("aria-busy") === "true") return;
  $(id).classList.remove("show");
  document.body.classList.remove("modal-open");
  previousFocus?.focus();
}
export function setDialogBusy(id, busy) {
  const modal = $(id);
  modal.setAttribute("aria-busy", String(busy));
  modal
    .querySelectorAll('.btn-close, .modal-footer button[type="button"]')
    .forEach((button) => {
      button.disabled = busy;
    });
}
export function bindDialog(id, closeSelector) {
  const modal = $(id);
  modal
    .querySelectorAll(closeSelector)
    .forEach((node) => node.addEventListener("click", () => closeDialog(id)));
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDialog(id);
    if (event.key !== "Tab") return;
    const nodes = [
      ...modal.querySelectorAll(
        "button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])",
      ),
    ];
    const first = nodes[0],
      last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
