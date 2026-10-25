import { $, esc } from "../shared/format.js";
import {
  openDialog,
  closeDialog,
  bindDialog,
  setDialogBusy,
} from "./dialog.js";
import { toast } from "./toast.js";

export function field(label, name, value = "", type = "text", extra = "") {
  return `<div class="form-group"><label for="edit-${name}">${label}</label><input id="edit-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
}

// The component owns dialog behavior; each page owns its fields and API calls.
export function createEditor() {
  let save;
  bindDialog("editorModal", "[data-close-editor]");
  $("editorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("saveEditor");
    button.disabled = true;
    setDialogBusy("editorModal", true);
    try {
      await save(Object.fromEntries(new FormData(event.target)));
      button.disabled = false;
      setDialogBusy("editorModal", false);
      closeDialog("editorModal");
      toast("Đã lưu thông tin");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setDialogBusy("editorModal", false);
      button.disabled = false;
    }
  });
  return ({ title, fields, onSave }) => {
    $("editorTitle").textContent = title;
    $("editorFields").innerHTML = fields;
    save = onSave;
    openDialog("editorModal");
  };
}
