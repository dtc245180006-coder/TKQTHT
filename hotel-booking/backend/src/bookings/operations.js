const { fail, cents, amount } = require("./rules");
const { validDate } = require("../validation");
const policy = require("./stay-policy");
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const nights = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
// Revisions contain the entire effective quote; previous revisions and original stay are immutable.
module.exports = function operations({
  withBooking,
  getPool,
  rooms,
  bookings,
  revisions,
  effective,
  ledger,
  now,
  recordEvent,
  setCleaning,
  conflicts,
}) {
  async function revise(id, data, actor, preview = false) {
    if (
      !uuid(data.requestKey) ||
      !Number.isInteger(data.expectedVersion) ||
      !policy.reason(data.reason)
    )
      fail(
        "INVALID_REVISION",
        "Cần mã yêu cầu, phiên bản đang xem và lý do 5–500 ký tự.",
        400,
      );
    const allowed = ["move", "extend", "charge", "void-charge"];
    if (!allowed.includes(data.action))
      fail("INVALID_REVISION", "Loại điều chỉnh không hợp lệ.", 400);
    const fingerprint = JSON.stringify([
      data.action,
      data.expectedVersion,
      data.reason.trim(),
      data.roomId ?? null,
      data.checkOutDate ?? null,
      data.label ?? null,
      data.quantity ?? null,
      data.unitPrice ?? null,
      data.chargeId ?? null,
      data.agreedCredit ?? null,
    ]);
    return withBooking(
      id,
      async (client, b) => {
        const history = client
          ? (
              await client.query(
                "SELECT * FROM booking_revisions WHERE booking_id=$1 ORDER BY version",
                [id],
              )
            ).rows
          : revisions.filter((r) => r.booking_id === id);
        const replay = history.find((r) => r.request_key === data.requestKey);
        if (replay) {
          if (replay.fingerprint !== fingerprint)
            fail(
              "REVISION_KEY_REUSED",
              "Mã điều chỉnh đã dùng cho nội dung khác.",
            );
          return { booking: b, revision: replay, replayed: true };
        }
        if (!["confirmed", "checked_in"].includes(b.status))
          fail(
            "STAY_CLOSED",
            "Chỉ điều chỉnh đơn đã xác nhận hoặc đang lưu trú.",
          );
        if ((b.revision_version || 0) !== data.expectedVersion)
          fail(
            "STALE_REVISION",
            "Đơn đã thay đổi. Hãy tải lại trước khi điều chỉnh.",
          );
        const time = await now(client),
          date = policy.local(time).date;
        let room = client
          ? (await client.query("SELECT * FROM rooms WHERE id=$1", [b.room_id]))
              .rows[0]
          : rooms.find((r) => r.id === b.room_id);
        let nextRoom = room,
          checkout = b.check_out_date;
        let snap = b.booking_snapshot
          ? structuredClone(b.booking_snapshot)
          : {
              version: 2,
              captured_at: new Date(time).toISOString(),
              room: null,
              pricing: {
                currency: "VND",
                items: [
                  {
                    code: "legacy",
                    label: "Giá trị đơn cũ đã lưu (không có đơn giá lịch sử)",
                    quantity: 1,
                    unit_price: Number(b.total_price),
                    amount: Number(b.total_price),
                  },
                ],
                total: Number(b.total_price),
              },
            };
        let items = snap.pricing.items;
        if (data.action === "move") {
          if (!Number.isInteger(data.roomId) || data.roomId === b.room_id)
            fail("INVALID_ROOM", "Chọn phòng khác để chuyển.", 400);
          nextRoom = client
            ? (
                await client.query(
                  "SELECT * FROM rooms WHERE id=$1 FOR UPDATE",
                  [data.roomId],
                )
              ).rows[0]
            : rooms.find((r) => r.id === data.roomId);
          if (
            !nextRoom ||
            nextRoom.status !== "available" ||
            nextRoom.capacity < b.guest_count
          )
            fail(
              "ROOM_UNAVAILABLE",
              "Phòng mới không phù hợp hoặc không kinh doanh.",
            );
          if (
            b.status === "checked_in" &&
            (nextRoom.cleaning_status || "ready") !== "ready"
          )
            fail("ROOM_NOT_READY", "Phòng mới chưa dọn xong.");
          const start = b.status === "checked_in" ? date : b.check_in_date;
          if (start >= checkout)
            fail(
              "EXTEND_FIRST",
              "Đơn đã đến/quá ngày trả; cần gia hạn trước khi đổi phòng.",
            );
          if (await conflicts(client, nextRoom.id, id, start, checkout))
            fail(
              "BOOKING_CONFLICT",
              "Phòng mới có đơn trùng lịch hoặc đang có khách.",
            );
          if (b.status === "checked_in") {
            if (items.some((i) => i.code === "legacy")) {
              if (
                typeof data.agreedCredit !== "number" ||
                !Number.isFinite(data.agreedCredit) ||
                data.agreedCredit < 0 ||
                cents(data.agreedCredit) > cents(b.total_price) ||
                Math.abs(data.agreedCredit * 100 - cents(data.agreedCredit)) >
                  0.0001
              )
                fail(
                  "LEGACY_CREDIT_REQUIRED",
                  "Đơn cũ thiếu đơn giá: cần đối chiếu chứng từ và nhập khoản giảm đã thỏa thuận cho phòng cũ, không tự suy ra đơn giá.",
                  400,
                );
              items.push({
                code: "agreed-credit",
                label:
                  "Khoản giảm phòng cũ đã đối chiếu/thỏa thuận khi đổi phòng",
                quantity: 1,
                unit_price: -data.agreedCredit,
                amount: -data.agreedCredit,
              });
            } else
              items = items.flatMap((item) => {
                if (item.code !== "room") return [item];
                const from = item.from || b.check_in_date,
                  to =
                    item.to ||
                    new Date(Date.parse(from) + item.quantity * 86400000)
                      .toISOString()
                      .slice(0, 10);
                if (from >= start) return [];
                const end = to < start ? to : start;
                return [
                  {
                    ...item,
                    to: end,
                    quantity: nights(from, end),
                    amount: amount(cents(item.unit_price) * nights(from, end)),
                  },
                ];
              });
          } else
            items = items.filter(
              (item) => !["room", "legacy"].includes(item.code),
            );
          const quantity = nights(start, checkout),
            rate = amount(cents(nextRoom.price_per_night));
          items.push({
            code: "room",
            label: `Tiền phòng ${nextRoom.name}`,
            room_id: nextRoom.id,
            from: start,
            to: checkout,
            quantity,
            unit_price: rate,
            amount: amount(cents(rate) * quantity),
          });
        }
        if (data.action === "extend") {
          if (
            !validDate(data.checkOutDate) ||
            data.checkOutDate <= b.check_out_date ||
            data.checkOutDate <= date
          )
            fail(
              "INVALID_EXTENSION",
              "Ngày trả mới phải sau ngày trả hiện tại và sau hôm nay.",
              400,
            );
          if (!room || room.status !== "available")
            fail("ROOM_UNAVAILABLE", "Phòng không còn kinh doanh.");
          checkout = data.checkOutDate;
          if (nights(b.check_out_date, checkout) > 365)
            fail("INVALID_EXTENSION", "Mỗi lần gia hạn tối đa 365 đêm.", 400);
          if (await conflicts(client, room.id, id, b.check_out_date, checkout))
            fail("BOOKING_CONFLICT", "Khoảng gia hạn bị trùng lịch.");
          const rate = amount(cents(room.price_per_night)),
            quantity = nights(b.check_out_date, checkout);
          items.push({
            code: "room",
            label: `Gia hạn ${room.name}`,
            room_id: room.id,
            from: b.check_out_date,
            to: checkout,
            quantity,
            unit_price: rate,
            amount: amount(cents(rate) * quantity),
          });
        }
        if (data.action === "charge") {
          if (
            typeof data.label !== "string" ||
            data.label.trim().length < 2 ||
            data.label.length > 120 ||
            !Number.isInteger(data.quantity) ||
            data.quantity < 1 ||
            data.quantity > 1000 ||
            typeof data.unitPrice !== "number" ||
            !Number.isFinite(data.unitPrice) ||
            data.unitPrice <= 0 ||
            Math.abs(data.unitPrice * 100 - cents(data.unitPrice)) > 0.0001
          )
            fail(
              "INVALID_CHARGE",
              "Tên dịch vụ, số lượng nguyên 1–1000 và đơn giá tối đa 2 số thập phân là bắt buộc.",
              400,
            );
          items.push({
            code: "service",
            charge_id: data.requestKey,
            label: data.label.trim(),
            quantity: data.quantity,
            unit_price: data.unitPrice,
            amount: amount(cents(data.unitPrice) * data.quantity),
          });
        }
        if (data.action === "void-charge") {
          const item = items.find(
            (i) => i.code === "service" && i.charge_id === data.chargeId,
          );
          if (!item)
            fail(
              "CHARGE_NOT_FOUND",
              "Khoản phụ thu không tồn tại hoặc đã điều chỉnh.",
            );
          items = items.filter((i) => i !== item);
        }
        const totalCents = items.reduce(
          (sum, item) => sum + cents(item.amount),
          0,
        );
        if (
          !Number.isSafeInteger(totalCents) ||
          totalCents <= 0 ||
          totalCents > 999999999999
        )
          fail("INVALID_TOTAL", "Tổng giá trị điều chỉnh vượt giới hạn.", 400);
        snap = {
          ...snap,
          version: 2,
          captured_at: new Date(time).toISOString(),
          room: nextRoom
            ? { id: nextRoom.id, name: nextRoom.name, type: nextRoom.type }
            : snap.room,
          pricing: { currency: "VND", items, total: amount(totalCents) },
        };
        // Extra services/extensions must not silently relabel the room after a catalogue rename.
        if (data.action !== "move" && b.booking_snapshot)
          snap.room = structuredClone(b.booking_snapshot.room);
        const state = {
          room_id: nextRoom?.id || b.room_id,
          check_out_date: checkout,
          total_price: amount(totalCents),
          booking_snapshot: snap,
        };
        const quoteToken = require("node:crypto")
          .createHash("sha256")
          .update(
            JSON.stringify({
              ...state,
              booking_snapshot: { ...snap, captured_at: null },
            }),
          )
          .digest("hex");
        if (preview)
          return {
            preview: true,
            quoteToken,
            total: state.total_price,
            delta: amount(totalCents - cents(b.total_price)),
            refundDue: Math.max(
              0,
              amount(
                (await ledger(client, id)).reduce(
                  (sum, p) => sum + cents(p.amount),
                  0,
                ) - totalCents,
              ),
            ),
          };
        if (data.quoteToken && data.quoteToken !== quoteToken)
          fail(
            "PRICE_CHANGED",
            "Giá hoặc nội dung báo trước đã thay đổi. Hãy xem lại chênh lệch và xác nhận lần nữa.",
          );
        const row = {
          booking_id: id,
          version: (b.revision_version || 0) + 1,
          request_key: data.requestKey,
          action: data.action,
          room_id: state.room_id,
          state,
          reason: data.reason.trim(),
          actor_user_id: actor.id,
          actor_name: actor.name,
          fingerprint,
          delta: amount(totalCents - cents(b.total_price)),
        };
        let saved;
        if (client)
          saved = (
            await client.query(
              `INSERT INTO booking_revisions(booking_id,version,request_key,action,room_id,state,reason,actor_user_id,actor_name,fingerprint,delta)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
              Object.values(row),
            )
          ).rows[0];
        else {
          saved = {
            ...structuredClone(row),
            id: revisions.length + 1,
            created_at: new Date(time).toISOString(),
          };
          revisions.push(saved);
        }
        if (data.action === "move" && b.status === "checked_in")
          await setCleaning(
            client,
            b.room_id,
            "dirty",
            actor,
            "Khách đổi phòng",
          );
        await recordEvent(client, id, data.action, actor, {
          revision: saved.version,
          delta: saved.delta,
          reason: row.reason,
        });
        return {
          booking: { ...b, ...state, revision_version: row.version },
          revision: saved,
          replayed: false,
        };
      },
      true,
    );
  }
  return { revise };
};
