import { esc } from "../../shared/format.js";
import { field } from "../../components/editor.js";
export function customerFields(row = {}) {
  return (
    field(
      "Họ và tên *",
      "name",
      row.name,
      "text",
      'required minlength="2" maxlength="120"',
    ) +
    field(
      "Số điện thoại *",
      "phone",
      row.phone,
      "tel",
      'required minlength="8" maxlength="20"',
    ) +
    field("Email *", "email", row.email, "email", 'required maxlength="120"') +
    `<div class="form-group"><label for="edit-notes">Ghi chú</label><textarea name="notes" id="edit-notes" rows="3" maxlength="2000">${esc(row.notes)}</textarea></div>`
  );
}
