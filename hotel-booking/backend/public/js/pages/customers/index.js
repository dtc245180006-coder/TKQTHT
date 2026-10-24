import { $, esc, money, normalize } from "../../shared/format.js";
import { api } from "../../shared/api.js";
import { toast } from "../../components/toast.js";
import { createEditor } from "../../components/editor.js";
import { customerFields } from "./form.js";
const state = { customers: [] };
const canDelete = document.body.dataset.role === "admin";
function deleteButton(customer) {
  return canDelete
    ? `<button class="btn btn-outline btn-sm" data-action="delete-customer" data-id="${customer.id}">Xóa</button>`
    : "";
}
const openEditor = createEditor();
function renderCustomers() {
  const query = normalize($("customerSearch").value),
    rows = state.customers.filter((c) =>
      normalize(`${c.name} ${c.phone} ${c.email}`).includes(query),
    );
  $("customerBody").innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<tr><td><strong>${esc(c.name)}</strong><br><small>#${c.id}</small></td><td>${esc(c.phone)}<br><small>${esc(c.email)}</small></td><td>${c.booking_count}</td><td class="nowrap">${money(c.total_spent)}</td><td>${esc(c.notes)}</td><td class="nowrap"><button class="btn btn-outline btn-sm" data-action="edit-customer" data-id="${c.id}">Sửa</button> ${deleteButton(c)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="text-center py-4">Không có khách hàng phù hợp.</td></tr>';
}
async function load() {
  try {
    state.customers = await api("/api/customers");
    renderCustomers();
  } catch (error) {
    $("customerBody").innerHTML =
      `<tr><td colspan="6">${esc(error.message)} <button class="btn btn-outline" data-action="refresh">Thử lại</button></td></tr>`;
  }
}
function edit(id) {
  const row = state.customers.find((row) => row.id === id) || {};
  openEditor({
    title: `${id ? "Cập nhật" : "Thêm"} khách hàng`,
    fields: customerFields(row),
    onSave: async (body) => {
      await api(
        `/api/customers${id ? "/" + id : ""}`,
        id ? "PUT" : "POST",
        body,
      );
      await load();
    },
  });
}
$("addCustomer").addEventListener("click", () => edit());
$("customerSearch").addEventListener("input", renderCustomers);
$("customerBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action,
    id = Number(button.dataset.id);
  if (action === "refresh") return load();
  if (action === "edit-customer") return edit(id);
  if (action !== "delete-customer" || !confirm(`Xóa khách hàng #${id}?`))
    return;
  button.disabled = true;
  try {
    await api(`/api/customers/${id}`, "DELETE");
    toast("Đã xóa");
    await load();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
load();
