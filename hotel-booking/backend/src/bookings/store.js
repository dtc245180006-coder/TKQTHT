const {
  ACTIVE,
  fail,
  cents,
  validateBooking,
  summarize,
  validateTransition,
  validatePayment,
} = require("./rules");
const { HOLD_MINUTES, blocking, holding, BLOCKING_SQL } = require("./holds");
const snapshot = require("./snapshot");

module.exports = function createStore({
  getPool,
  rooms,
  bookings,
  customers,
  clock = Date.now,
  stayClock = null,
}) {
  const payments = [],
    events = [],
    revisions = [];
  function effective(b) {
    const r = revisions.filter((r) => r.booking_id === b.id).at(-1);
    return {
      ...b,
      ...(r?.state || {}),
      revision_version: r?.version || 0,
      original_snapshot:
        b.original_snapshot === undefined
          ? b.booking_snapshot
          : b.original_snapshot,
      original_total:
        b.original_total === undefined ? b.total_price : b.original_total,
    };
  }
  const requests = require("./requests")({ bookings, clock });
  let queue = Promise.resolve();
  function memoryLock(work) {
    const task = queue.then(work);
    queue = task.catch(() => {});
    return task;
  }
  async function transaction(work) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(80462060)");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async function recordEvent(client, bookingId, action, actor, metadata = {}) {
    const values = [
      bookingId,
      action,
      actor?.id || null,
      actor?.name || "Khách đặt trực tuyến",
    ];
    if (client)
      await client.query(
        "INSERT INTO booking_events (booking_id,action,staff_user_id,staff_name,metadata) VALUES ($1,$2,$3,$4,$5)",
        [...values, metadata],
      );
    else
      events.push({
        metadata,
        id: events.length + 1,
        booking_id: bookingId,
        action,
        staff_user_id: values[2],
        staff_name: values[3],
        created_at: new Date().toISOString(),
      });
  }
  async function ledger(client, id) {
    if (client)
      return (
        await client.query(
          "SELECT * FROM booking_payments WHERE booking_id=$1 ORDER BY id",
          [id],
        )
      ).rows;
    return payments.filter((p) => p.booking_id === id);
  }
  function samePayment(existing, data) {
    const signed =
      data.kind === "refund" ? -cents(data.amount) : cents(data.amount);
    return (
      existing.kind === data.kind &&
      cents(existing.amount) === signed &&
      existing.method === data.method &&
      existing.reference === (data.reference || "").trim()
    );
  }

  async function databaseNow(client) {
    return client
      ? (
          await client.query("SELECT clock_timestamp() AS now")
        ).rows[0].now.getTime()
      : clock();
  }
  async function expireRoom(client, roomId) {
    const now = await databaseNow(client);
    const expired = client
      ? (
          await client.query(
            `UPDATE bookings SET status='expired'
      WHERE room_id IS NOT DISTINCT FROM $1 AND status='pending' AND hold_expires_at<=$2 RETURNING id`,
            [roomId, new Date(now)],
          )
        ).rows
      : bookings.filter(
          (b) =>
            b.room_id === roomId && b.status === "pending" && !holding(b, now),
        );
    for (const b of expired) {
      if (!client) b.status = "expired";
      await recordEvent(client, b.id, "expired", { name: "Hệ thống" });
    }
    return expired.length;
  }
  async function expirePending() {
    if (!getPool())
      return memoryLock(async () => {
        let total = 0;
        for (const roomId of new Set(bookings.map((b) => b.room_id)))
          total += await expireRoom(null, roomId);
        return total;
      });
    const ids = (
      await getPool().query(
        "SELECT DISTINCT room_id FROM booking_current WHERE status='pending' AND hold_expires_at<=clock_timestamp() ORDER BY room_id",
      )
    ).rows;
    let total = 0;
    for (const row of ids)
      total += await transaction(async (client) => {
        await client.query("SELECT id FROM rooms WHERE id=$1 FOR UPDATE", [
          row.room_id,
        ]);
        return expireRoom(client, row.room_id);
      });
    return total;
  }
  async function newCustomer(client, data) {
    // A matching email is not proof of identity, even on staff-created bookings.
    // Only a newly created profile can be linked here; existing profiles stay separate.
    if (client)
      return (
        (
          await client.query(
            `INSERT INTO customers (name,phone,email) VALUES ($1,$2,$3)
      ON CONFLICT (email) DO NOTHING RETURNING id`,
            [
              data.customerName.trim(),
              data.customerPhone.trim(),
              data.customerEmail.trim().toLowerCase(),
            ],
          )
        ).rows[0]?.id || null
      );
    if (
      customers.some((c) => c.email === data.customerEmail.trim().toLowerCase())
    )
      return null;
    const customer = {
      id: Math.max(0, ...customers.map((c) => c.id)) + 1,
      name: data.customerName.trim(),
      phone: data.customerPhone.trim(),
      email: data.customerEmail.trim().toLowerCase(),
      notes: "",
    };
    customers.push(customer);
    return customer.id;
  }
  async function create(data, actor, meta) {
    if (getPool())
      return transaction(async (client) => {
        const replay = await requests.begin(client, meta, actor);
        if (replay)
          return {
            ...summarize(
              (
                await client.query(
                  "SELECT * FROM booking_current WHERE id=$1",
                  [replay],
                )
              ).rows[0],
              await ledger(client, replay),
            ),
            replayed: true,
          };
        const room = (
          await client.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
            data.roomId,
          ])
        ).rows[0];
        const total = validateBooking(data, room);
        await expireRoom(client, data.roomId);
        const conflict = await client.query(
          `SELECT 1 FROM booking_current WHERE room_id=$1 AND ${BLOCKING_SQL}
        AND check_in_date < $3 AND check_out_date > $2 LIMIT 1`,
          [data.roomId, data.checkInDate, data.checkOutDate],
        );
        if (conflict.rowCount)
          fail(
            "BOOKING_CONFLICT",
            "Phòng đã được đặt trong khoảng thời gian này.",
          );
        const customerId = actor ? await newCustomer(client, data) : null;
        const now = await databaseNow(client);
        const booking = (
          await client.query(
            `INSERT INTO bookings
        (room_id,customer_name,customer_phone,customer_email,check_in_date,check_out_date,total_price,customer_id,guest_count,status,hold_expires_at,confirmed_at,confirmed_by,booking_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [
              data.roomId,
              data.customerName.trim(),
              data.customerPhone.trim(),
              data.customerEmail.trim().toLowerCase(),
              data.checkInDate,
              data.checkOutDate,
              total,
              customerId,
              data.guests,
              actor ? "confirmed" : "pending",
              actor ? null : new Date(now + HOLD_MINUTES * 60000),
              actor ? new Date(now) : null,
              actor?.id || null,
              snapshot(room, data, total, now),
            ],
          )
        ).rows[0];
        await recordEvent(client, booking.id, "created", actor);
        await requests.save(client, meta, booking, actor);
        return summarize(booking);
      });
    return memoryLock(async () => {
      const replay = await requests.begin(null, meta, actor);
      if (replay)
        return {
          ...summarize(
            effective(bookings.find((b) => b.id === replay)),
            await ledger(null, replay),
            clock(),
          ),
          replayed: true,
        };
      const room = rooms.find((r) => r.id === data.roomId);
      const total = validateBooking(data, room);
      await expireRoom(null, room.id);
      if (
        bookings
          .map(effective)
          .some(
            (b) =>
              b.room_id === room.id &&
              blocking(b, clock()) &&
              b.check_in_date < data.checkOutDate &&
              b.check_out_date > data.checkInDate,
          )
      )
        fail(
          "BOOKING_CONFLICT",
          "Phòng đã được đặt trong khoảng thời gian này.",
        );
      const customerId = actor ? await newCustomer(null, data) : null;
      const booking = {
        id: Math.max(100, ...bookings.map((b) => b.id)) + 1,
        room_id: room.id,
        customer_id: customerId,
        customer_name: data.customerName.trim(),
        customer_phone: data.customerPhone.trim(),
        customer_email: data.customerEmail.trim().toLowerCase(),
        check_in_date: data.checkInDate,
        check_out_date: data.checkOutDate,
        guest_count: data.guests,
        total_price: total,
        status: actor ? "confirmed" : "pending",
        hold_expires_at: actor
          ? null
          : new Date(clock() + HOLD_MINUTES * 60000).toISOString(),
        confirmed_at: actor ? new Date(clock()).toISOString() : null,
        confirmed_by: actor?.id || null,
        booking_snapshot: snapshot(room, data, total, clock()),
        checked_in_at: null,
        checked_out_at: null,
        created_at: new Date(clock()).toISOString(),
      };
      bookings.unshift(booking);
      await recordEvent(null, booking.id, "created", actor);
      await requests.save(null, meta, booking, actor);
      return summarize(booking, [], clock());
    });
  }

  async function list() {
    await expirePending();
    if (getPool()) {
      const result = await getPool().query(`SELECT b.*,COALESCE(p.ledger,'[]'::jsonb) AS ledger
        FROM booking_current b
        LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) AS ledger FROM booking_payments p WHERE p.booking_id=b.id) p ON TRUE
        ORDER BY b.id DESC`);
      return result.rows.map(({ledger,...b})=>summarize(b,ledger));
    }
    return bookings.map(effective).map((b) =>
      summarize(
        b,
        payments.filter((p) => p.booking_id === b.id),
      ),
    );
  }

  async function withBooking(id, work, lockRoom = false) {
    if (!getPool())
      return memoryLock(async () => {
        const booking = bookings.find((b) => b.id === id);
        if (!booking)
          fail("BOOKING_NOT_FOUND", "Không tìm thấy đơn đặt phòng.", 404);
        const current = effective(booking);
        return work(
          null,
          current,
          rooms.find((r) => r.id === current.room_id),
        );
      });
    return transaction(async (client) => {
      let room;
      if (lockRoom) {
        const initial = (
          await client.query(
            "SELECT room_id FROM booking_current WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (initial?.room_id)
          room = (
            await client.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
              initial.room_id,
            ])
          ).rows[0];
      }
      await client.query("SELECT id FROM bookings WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const booking = (
        await client.query("SELECT * FROM booking_current WHERE id=$1", [id])
      ).rows[0];
      if (!booking)
        fail("BOOKING_NOT_FOUND", "Không tìm thấy đơn đặt phòng.", 404);
      return work(client, booking, room);
    });
  }

  async function transition(id, action, actor, options = {}) {
    return withBooking(
      id,
      async (client, booking, room) => {
        const rows = await ledger(client, id);
        const summary = summarize(booking, rows);
        const now = await databaseNow(client);
        if (booking.status === "pending" && !holding(booking, now))
          fail(
            "HOLD_EXPIRED",
            "Đơn đã hết thời hạn giữ phòng; khách cần đặt lại.",
          );
        if (action === "confirm") {
          if (booking.status !== "pending")
            fail("INVALID_TRANSITION", "Chỉ duyệt được đơn đang chờ xác nhận.");
          if (options.contactVerified !== true)
            fail(
              "CONTACT_VERIFICATION_REQUIRED",
              "Cần xác nhận đã liên hệ kiểm tra thông tin người đặt.",
              400,
            );
          if (
            !room ||
            room.status !== "available" ||
            booking.guest_count > room.capacity
          )
            fail("ROOM_UNAVAILABLE", "Phòng không còn phù hợp để xác nhận.");
          if (require("../validation").today() > booking.check_in_date)
            fail("CHECKIN_DATE", "Ngày nhận phòng đã qua; khách cần đặt lại.");
          const conflict = client
            ? (
                await client.query(
                  `SELECT 1 FROM booking_current WHERE room_id=$1 AND id<>$2 AND ${BLOCKING_SQL}
          AND check_in_date<$4 AND check_out_date>$3 LIMIT 1`,
                  [room.id, id, booking.check_in_date, booking.check_out_date],
                )
              ).rowCount
            : bookings
                .map(effective)
                .some(
                  (b) =>
                    b.id !== id &&
                    b.room_id === room.id &&
                    blocking(b, now) &&
                    b.check_in_date < booking.check_out_date &&
                    b.check_out_date > booking.check_in_date,
                );
          if (conflict)
            fail(
              "BOOKING_CONFLICT",
              "Phòng không còn trống trong thời gian này.",
            );
          const customerId = await newCustomer(client, {
            customerName: booking.customer_name,
            customerPhone: booking.customer_phone,
            customerEmail: booking.customer_email,
          });
          const updated = client
            ? (
                await client.query(
                  `UPDATE bookings SET status='confirmed',customer_id=$2,confirmed_at=$3,contact_verified_at=$3,confirmed_by=$4
          WHERE id=$1 AND status='pending' AND hold_expires_at>clock_timestamp() RETURNING *`,
                  [id, customerId, new Date(now), actor.id],
                )
              ).rows[0]
            : Object.assign(
                bookings.find((b) => b.id === id),
                {
                  status: "confirmed",
                  customer_id: customerId,
                  confirmed_at: new Date(now).toISOString(),
                  contact_verified_at: new Date(now).toISOString(),
                  confirmed_by: actor.id,
                },
              );
          if (!updated)
            fail(
              "HOLD_EXPIRED",
              "Đơn đã hết thời hạn giữ phòng; khách cần đặt lại.",
            );
          await recordEvent(client, id, "confirm", actor);
          return summarize(updated, rows);
        }
        let occupied = false;
        if (action === "check-in") {
          if ((room?.cleaning_status || "ready") !== "ready")
            fail("ROOM_NOT_READY", "Phòng chưa dọn xong.");
          occupied = client
            ? (
                await client.query(
                  "SELECT 1 FROM booking_current WHERE room_id=$1 AND status='checked_in' AND id<>$2 LIMIT 1",
                  [booking.room_id, id],
                )
              ).rowCount > 0
            : bookings
                .map(effective)
                .some(
                  (b) =>
                    b.room_id === booking.room_id &&
                    b.status === "checked_in" &&
                    b.id !== id,
                );
        }
        require("./stay-policy").check(
          booking,
          action,
          options,
          stayClock ? stayClock() : now,
        );
        if (
          action === "no-show" &&
          !require("./stay-policy").reason(options.reason)
        )
          fail(
            "NO_SHOW_REASON",
            "Cần lý do và xác nhận đã kiểm tra khách không đến.",
            400,
          );
        const status = validateTransition(
          booking,
          room,
          action,
          summary.paid_amount,
          occupied,
          stayClock ? stayClock() : now,
        );
        if (status === booking.status) return summary;
        const timestamp = new Date(now).toISOString();
        let updated;
        if (client)
          updated = (
            await client.query(
              `UPDATE bookings SET status=$2::varchar,
        checked_in_at=CASE WHEN $2::varchar='checked_in' THEN CURRENT_TIMESTAMP ELSE checked_in_at END,
        checked_out_at=CASE WHEN $2::varchar='checked_out' THEN CURRENT_TIMESTAMP ELSE checked_out_at END WHERE id=$1 RETURNING *`,
              [id, status],
            )
          ).rows[0];
        else {
          booking.status = status;
          if (status === "checked_in") booking.checked_in_at = timestamp;
          if (status === "checked_out") booking.checked_out_at = timestamp;
          updated = booking;
        }
        if (!client)
          Object.assign(
            bookings.find((b) => b.id === id),
            {
              status: updated.status,
              checked_in_at: updated.checked_in_at,
              checked_out_at: updated.checked_out_at,
            },
          );
        if (action === "check-out")
          await setCleaning(
            client,
            booking.room_id,
            "dirty",
            actor,
            "Khách trả phòng",
          );
        await recordEvent(client, id, action, actor, {
          reason: options.reason || "",
          policy: require("./stay-policy").policy,
        });
        return summarize(
          {
            ...booking,
            ...updated,
            booking_snapshot: booking.booking_snapshot,
            total_price: booking.total_price,
            room_id: booking.room_id,
            check_out_date: booking.check_out_date,
          },
          rows,
        );
      },
      true,
    );
  }

  async function pay(id,data,actor){return finance.pay(id,data,actor);}

  async function history(id) {
    await expirePending();
    return withBooking(id, async (client, booking) => ({
      original: {
        snapshot:
          booking.original_snapshot === undefined
            ? booking.booking_snapshot
            : booking.original_snapshot,
        total: booking.original_total ?? booking.total_price,
      },
      revisions: client
        ? (
            await client.query(
              "SELECT * FROM booking_revisions WHERE booking_id=$1 ORDER BY version",
              [id],
            )
          ).rows
        : revisions.filter((r) => r.booking_id === id),
      policy: require("./stay-policy").policy,
      financeRequests:await finance.requestsFor(client,id),
      booking: summarize(booking, await ledger(client, id)),
      payments: (await ledger(client, id)).map(require('../finance/common').receipt),
      events: client
        ? (
            await client.query(
              "SELECT * FROM booking_events WHERE booking_id=$1 ORDER BY id",
              [id],
            )
          ).rows
        : events.filter((e) => e.booking_id === id),
    }));
  }
  async function blockingRoomIds(start, end) {
    if (getPool())
      return (
        await getPool().query(
          `SELECT DISTINCT room_id FROM booking_current WHERE ${BLOCKING_SQL}
      AND check_in_date<$2 AND check_out_date>$1`,
          [start, end],
        )
      ).rows.map((b) => b.room_id);
    return bookings
      .map(effective)
      .filter(
        (b) =>
          blocking(b, clock()) &&
          b.check_in_date < end &&
          b.check_out_date > start,
      )
      .map((b) => b.room_id);
  }
  async function setCleaning(client, roomId, status, actor, reason) {
    if (client)
      await client.query("UPDATE rooms SET cleaning_status=$2 WHERE id=$1", [
        roomId,
        status,
      ]);
    else {
      const room = rooms.find((r) => r.id === roomId);
      if (room) room.cleaning_status = status;
    }
  }
  async function conflicts(client, roomId, id, start, end) {
    if (client)
      return (
        (
          await client.query(
            `SELECT 1 FROM booking_current WHERE room_id=$1 AND id<>$2 AND ${BLOCKING_SQL}
      AND (status='checked_in' OR (check_in_date<$4 AND check_out_date>$3)) LIMIT 1`,
            [roomId, id, start, end],
          )
        ).rowCount > 0
      );
    return bookings
      .map(effective)
      .some(
        (b) =>
          b.id !== id &&
          b.room_id === roomId &&
          blocking(b, clock()) &&
          (b.status === "checked_in" ||
            (b.check_in_date < end && b.check_out_date > start)),
      );
  }
  const operations = require("./operations")({
    withBooking,
    getPool,
    rooms,
    bookings,
    revisions,
    effective,
    ledger,
    now: stayClock ? async () => stayClock() : databaseNow,
    recordEvent,
    setCleaning,
    conflicts,
  });
  async function revise(id, data, actor, preview = false) {
    const result = await operations.revise(id, data, actor, preview);
    return result.preview
      ? result
      : {
          ...result,
          booking: summarize(result.booking, await ledger(getPool(), id)),
        };
  }
  async function cleanRoom(id, data, actor) {
    if (
      !["dirty", "cleaning", "ready"].includes(data.status) ||
      !["dirty", "cleaning", "ready"].includes(data.expectedStatus)
    )
      fail("INVALID_CLEANING", "Trạng thái dọn phòng không hợp lệ.", 400);
    const work = async (client) => {
      const room = client
        ? (
            await client.query("SELECT * FROM rooms WHERE id=$1 FOR UPDATE", [
              id,
            ])
          ).rows[0]
        : rooms.find((r) => r.id === id);
      if (!room) fail("ROOM_NOT_FOUND", "Không tìm thấy phòng.", 404);
      const current = room.cleaning_status || "ready";
      if (current !== data.expectedStatus)
        fail("STALE_CLEANING", "Trạng thái phòng đã đổi, hãy tải lại.");
      if (
        !{
          ready: ["dirty"],
          dirty: ["cleaning"],
          cleaning: ["ready", "dirty"],
        }[current].includes(data.status)
      )
        fail(
          "INVALID_CLEANING_TRANSITION",
          "Cần lần lượt: Chờ dọn → Đang dọn → Sẵn sàng.",
        );
      const occupied = client
        ? (
            await client.query(
              "SELECT 1 FROM booking_current WHERE room_id=$1 AND status='checked_in'",
              [id],
            )
          ).rowCount
        : bookings
            .map(effective)
            .some((b) => b.room_id === id && b.status === "checked_in");
      if (occupied)
        fail(
          "ROOM_OCCUPIED",
          "Không đổi trạng thái dọn khi khách đang lưu trú.",
        );
      await setCleaning(client, id, data.status, actor, "Dọn phòng");
      await require("../audit").record(
        actor,
        "room.cleaning",
        "room",
        id,
        { from: current, to: data.status },
        client,
      );
      return { ...room, cleaning_status: data.status };
    };
    return getPool() ? transaction(work) : memoryLock(() => work(null));
  }
  async function hasRoomHistory(id) {
    return getPool()
      ? (
          await getPool().query(
            "SELECT 1 FROM bookings WHERE room_id=$1 UNION ALL SELECT 1 FROM booking_revisions WHERE room_id=$1 LIMIT 1",
            [id],
          )
        ).rowCount > 0
      : bookings.some((b) => b.room_id === id) ||
          revisions.some((r) => r.room_id === id);
  }
  const finance=require('../finance/posting')({getPool,withBooking,ledger,payments,recordEvent,transaction,memoryLock,currentBookings:()=>bookings.map(effective)});
  return {
    finance,
    create,
    list,
    transition,
    pay,
    history,
    expirePending,
    blockingRoomIds,
    revise,
    cleanRoom,
    hasRoomHistory,
    exclusive: memoryLock,
    currentBookings: () => bookings.map(effective),
  };
};
