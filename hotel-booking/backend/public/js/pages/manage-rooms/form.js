import { esc } from "../../shared/format.js";
import { field } from "../../components/editor.js";
export function roomFields(row = {}) {
  return (
    field("Tên phòng *", "name", row.name, "text", 'required maxlength="150"') +
    `<div class="form-row"><div class="form-group"><label for="edit-type">Hạng phòng *</label><select name="type" id="edit-type">${["Standard", "Deluxe", "Suite", "Villa", "Family", "Penthouse"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>${field("Giá mỗi đêm (VNĐ) *", "pricePerNight", row.price_per_night, "number", 'required min="1" max="9999999999" step="any"')}</div>` +
    `<div class="form-row">${field("Sức chứa *", "capacity", row.capacity || 2, "number", 'required min="1" max="50"')}<div class="form-group"><label for="edit-status">Trạng thái</label><select id="edit-status" name="status"><option value="available" ${row.status === "available" ? "selected" : ""}>Sẵn sàng</option><option value="maintenance" ${row.status === "maintenance" ? "selected" : ""}>Bảo trì</option><option value="retired" ${row.status === "retired" ? "selected" : ""}>Ngừng kinh doanh</option></select></div></div><p class="muted">Phòng có lịch sử đặt được giữ lại. Chỉ ngừng kinh doanh sau khi xử lý hết đơn đang hoạt động; đơn cũ vẫn tra cứu được.</p>` +
    field(
      "Ảnh (URL https://images.unsplash.com/...)",
      "imageUrl",
      row.image_url,
      "url",
    ) +
    `<div class="form-group"><label for="edit-description">Mô tả</label><textarea name="description" id="edit-description" rows="3" maxlength="3000">${esc(row.description)}</textarea></div>` +
    field(
      "Tiện nghi (phân cách bằng dấu phẩy)",
      "amenities",
      (row.amenities || []).join(", "),
    )
  );
}
export function roomPayload(body) {
  return {
    ...body,
    pricePerNight: Number(body.pricePerNight),
    capacity: Number(body.capacity),
    amenities: body.amenities
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
  };
}
