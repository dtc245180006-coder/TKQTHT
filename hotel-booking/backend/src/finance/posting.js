const { randomUUID } = require("node:crypto");
const {
  fail,
  cents,
  amount,
  summarize,
  validatePayment,
} = require("../bookings/rules");
const {
  uuid,
  reason,
  digest,
  instrument,
  money,
  receipt,
} = require("./common");
module.exports = function posting({
  getPool,
  withBooking,
  ledger,
  payments,
  recordEvent,
  transaction,
  memoryLock,
  currentBookings,
}) {
  const requests = [],
    decisions = [],
    reconciliations = [];
  const atomic = (work) =>
    getPool() ? transaction(work) : memoryLock(() => work(null));
  const allPayments = async (client) =>
    client
      ? (await client.query("SELECT * FROM booking_payments ORDER BY id")).rows
      : payments;
  const merge = (r, d) =>
    d
      ? {
          ...r,
          outcome: d.outcome,
          approver_id: d.approver_id,
          approver_name: d.approver_name,
          decision_reason: d.reason,
          decided_at: d.created_at,
        }
      : r;
  async function requestsFor(client, bookingId) {
    if (client)
      return (
        await client.query(
          `SELECT r.*,d.outcome,d.approver_id,d.approver_name,d.reason AS decision_reason,d.created_at AS decided_at
      FROM finance_requests r LEFT JOIN finance_decisions d ON d.request_id=r.id WHERE ($1::integer IS NULL OR r.booking_id=$1) ORDER BY r.id DESC`,
          [bookingId ?? null],
        )
      ).rows;
    return requests
      .filter((r) => !bookingId || r.booking_id === bookingId)
      .map((r) =>
        merge(
          r,
          decisions.find((d) => d.request_id === r.id),
        ),
      )
      .reverse();
  }
  async function uniqueReference(client, data, exclude = []) {
    if (data.method === "cash") return;
    const rows = await allPayments(client),
      reversed = new Set(
        rows
          .filter((p) => p.reverses_payment_id)
          .map((p) => Number(p.reverses_payment_id)),
      );
    if (
      rows.some(
        (p) =>
          !exclude.includes(Number(p.id)) &&
          !reversed.has(Number(p.id)) &&
          p.entry_type !== "reversal" &&
          p.method === data.method &&
          p.reference.trim().toLowerCase() ===
            data.reference.trim().toLowerCase(),
      )
    )
      fail(
        "EXTERNAL_REFERENCE_USED",
        "Mã giao dịch này đã được ghi nhận. Hãy kiểm tra phiếu cũ, không tạo phiếu mới.",
      );
  }
  async function insert(client, b, data, actor, extra = {}) {
    const row = {
      booking_id: b.id,
      kind: data.kind,
      amount: data.kind === "refund" ? -data.amount : data.amount,
      method: data.method,
      reference: data.reference.trim(),
      request_key: data.requestKey,
      staff_user_id: actor.id,
      staff_name: actor.name,
      entry_type: extra.entry_type || "normal",
      reverses_payment_id: extra.reverses_payment_id || null,
      finance_request_id: extra.finance_request_id || null,
      credit_amount: extra.credit_amount || 0,
      receipt_snapshot: {
        customer_name: b.customer_name,
        customer_phone: b.customer_phone,
        room_name: b.booking_snapshot?.room?.name || null,
        booking_id: b.id,
        revision_version: b.revision_version || 0,
        total_price: Number(b.total_price),
      },
      confirmation: {
        manual: true,
        checked_by: actor.id,
        ...extra.confirmation,
      },
    };
    let saved;
    if (client)
      saved = (
        await client.query(
          `INSERT INTO booking_payments(booking_id,kind,amount,method,reference,request_key,staff_user_id,staff_name,
      entry_type,reverses_payment_id,finance_request_id,credit_amount,receipt_snapshot,confirmation)
      VALUES(${Object.keys(row)
        .map((_, i) => "$" + (i + 1))
        .join(",")}) RETURNING *`,
          Object.values(row),
        )
      ).rows[0];
    else {
      saved = {
        ...structuredClone(row),
        id: payments.length + 1,
        created_at: new Date().toISOString(),
      };
      payments.push(saved);
    }
    return receipt(saved);
  }
  async function pay(id, data, actor) {
    return withBooking(id, async (client, b) => {
      const rows = await ledger(client, id),
        existing = rows.find((p) => p.request_key === data.requestKey);
      const normalized = { ...data, reference: data.reference ?? "" };
      if (existing) {
        if (
          (existing.entry_type || "normal") !== "normal" ||
          existing.kind !== data.kind ||
          cents(existing.amount) !==
            (data.kind === "refund"
              ? -cents(data.amount)
              : cents(data.amount)) ||
          existing.method !== data.method ||
          existing.reference !== String(normalized.reference).trim()
        )
          fail("PAYMENT_KEY_REUSED", "Mã yêu cầu đã dùng cho nội dung khác.");
        return {
          booking: summarize(b, rows),
          payment: receipt(existing),
          replayed: true,
        };
      }
      if (!uuid(data.requestKey))
        fail("INVALID_PAYMENT_KEY", "Mã yêu cầu phải là UUID v4.", 400);
      instrument(normalized);
      const summary = summarize(b, rows);
      validatePayment(
        { ...b, total_price: summary.settlement_total },
        data,
        summary.paid_amount,
      );
      await uniqueReference(client, normalized);
      const payment = await insert(client, b, normalized, actor);
      await recordEvent(client, id, data.kind, actor, {
        receipt: payment.receipt_code,
        moneyConfirmed: true,
      });
      return {
        booking: summarize(b, [...rows, payment]),
        payment,
        replayed: false,
      };
    });
  }
  function payload(data) {
    if (
      !["correct", "post_refund", "post_payment"].includes(data.action) ||
      !reason(data.reason) ||
      !uuid(data.requestKey) ||
      !Number.isSafeInteger(data.expectedLedgerId) ||
      data.expectedLedgerId < 0 ||
      !Number.isInteger(data.expectedRevision) ||
      data.expectedRevision < 0
    )
      fail(
        "INVALID_FINANCE_REQUEST",
        "Cần loại yêu cầu, lý do 5–500 ký tự, UUID và phiên bản sổ/đơn đang xem.",
        400,
      );
    if (!money(data.amount, data.action === "correct"))
      fail(
        "INVALID_AMOUNT",
        "Số tiền không hợp lệ (tối đa 2 số thập phân).",
        400,
      );
    instrument({ ...data, reference: data.reference ?? "" }, false);
    if (
      data.action === "correct" &&
      (!Number.isSafeInteger(data.paymentId) || data.paymentId < 1)
    )
      fail("INVALID_PAYMENT", "Chọn phiếu cần sửa.", 400);
    return {
      action: data.action,
      reason: data.reason.trim(),
      paymentId: data.action === "correct" ? data.paymentId : null,
      amount: data.amount,
      method: data.method,
      reference: (data.reference || "").trim(),
      expectedLedgerId: data.expectedLedgerId,
      expectedRevision: data.expectedRevision,
    };
  }
  async function plan(client, b, p) {
    const rows = await ledger(client, b.id),
      summary = summarize(b, rows);
    if (
      (rows.at(-1)?.id || 0) !== p.expectedLedgerId ||
      (b.revision_version || 0) !== p.expectedRevision
    )
      fail(
        "STALE_FINANCE_REQUEST",
        "Sổ tiền hoặc đơn đã thay đổi. Tải lại và lập yêu cầu mới.",
      );
    let target,
      newPaid = cents(summary.paid_amount),
      newCredit = cents(summary.credit_amount);
    if (p.action === "correct") {
      target = rows.find((row) => row.id === p.paymentId);
      if (
        !target ||
        target.entry_type === "reversal" ||
        rows.some((row) => Number(row.reverses_payment_id) === target.id)
      )
        fail(
          "PAYMENT_ALREADY_CORRECTED",
          "Phiếu không tồn tại hoặc đã được điều chỉnh.",
        );
      const signed =
        target.kind === "refund" ? -cents(p.amount) : cents(p.amount);
      newPaid = newPaid - cents(target.amount) + signed;
      if (Number(target.credit_amount) > 0)
        newCredit = newCredit - cents(target.credit_amount) + cents(p.amount);
      if (
        cents(Math.abs(Number(target.amount))) === cents(p.amount) &&
        target.method === p.method &&
        target.reference === p.reference
      )
        fail("NO_CHANGE", "Nội dung mới giống phiếu cũ.", 400);
    } else {
      if (b.status !== "checked_out")
        fail("NOT_CHECKED_OUT", "Chỉ dùng quy trình này cho đơn đã trả phòng.");
      if (p.action === "post_refund") {
        newPaid -= cents(p.amount);
        newCredit += cents(p.amount);
      } else newPaid += cents(p.amount);
    }
    if (newPaid < 0 || newCredit < 0 || newCredit > cents(b.total_price))
      fail(
        "INVALID_SETTLEMENT",
        "Khoản điều chỉnh vượt tiền đang giữ hoặc giá trị đơn.",
      );
    if (
      ["cancelled", "no_show", "expired", "pending"].includes(b.status) &&
      newPaid !== 0
    )
      fail(
        "CLOSED_BALANCE",
        "Đơn đã đóng không được phát sinh số tiền đang giữ; cần đối chiếu riêng.",
      );
    if (
      p.action === "post_payment" &&
      newPaid > cents(summary.settlement_total)
    )
      fail("OVERPAYMENT", "Thu bổ sung vượt công nợ hiện tại.");
    if (p.amount > 0)
      await uniqueReference(client, p, target ? [target.id] : []);
    return { rows, target, summary, newPaid, newCredit };
  }
  async function apply(client, b, r, actor, confirmation) {
    const p = r.payload,
      checked = await plan(client, b, p),
      created = [];
    instrument({ ...p, moneyConfirmed: confirmation.moneyConfirmed });
    if (p.action === "correct") {
      const old = checked.target;
      created.push(
        await insert(
          client,
          b,
          {
            kind: old.kind === "payment" ? "refund" : "payment",
            amount: Math.abs(Number(old.amount)),
            method: old.method,
            reference: old.reference,
            requestKey: randomUUID(),
          },
          actor,
          {
            entry_type: "reversal",
            reverses_payment_id: old.id,
            finance_request_id: r.id,
            credit_amount: -Number(old.credit_amount || 0),
            confirmation: { journal: true, reason: p.reason },
          },
        ),
      );
      if (p.amount > 0)
        created.push(
          await insert(
            client,
            b,
            { ...p, kind: old.kind, requestKey: randomUUID() },
            actor,
            {
              entry_type: "replacement",
              finance_request_id: r.id,
              credit_amount: Number(old.credit_amount) > 0 ? p.amount : 0,
              confirmation: { journal: true, reason: p.reason },
            },
          ),
        );
    } else
      created.push(
        await insert(
          client,
          b,
          {
            ...p,
            kind: p.action === "post_refund" ? "refund" : "payment",
            requestKey: randomUUID(),
          },
          actor,
          {
            entry_type: p.action,
            finance_request_id: r.id,
            credit_amount: p.action === "post_refund" ? p.amount : 0,
            confirmation: { reason: p.reason },
          },
        ),
      );
    await recordEvent(client, b.id, "finance-adjust", actor, {
      requestId: r.id,
      reason: p.reason,
      receipts: created.map((p) => p.receipt_code),
    });
    return created;
  }
  async function decision(client, r, outcome, actor, note) {
    const row = {
      request_id: r.id,
      outcome,
      approver_id: actor.id,
      approver_name: actor.name,
      reason: note,
    };
    if (client)
      return (
        await client.query(
          "INSERT INTO finance_decisions(request_id,outcome,approver_id,approver_name,reason) VALUES($1,$2,$3,$4,$5) RETURNING *",
          Object.values(row),
        )
      ).rows[0];
    const saved = {
      ...row,
      id: decisions.length + 1,
      created_at: new Date().toISOString(),
    };
    decisions.push(saved);
    return saved;
  }
  async function submit(id, data, actor, guard = async () => {}) {
    const p = payload(data),
      fingerprint = digest([
        id,
        { ...p, expectedLedgerId: null, expectedRevision: null },
        !!data.executeNow,
      ]);
    if (data.executeNow && actor.role !== "admin")
      fail("FORBIDDEN", "Chỉ quản trị được thực hiện trực tiếp.", 403);
    return withBooking(id, async (client, b) => {
      await guard(client);
      const prior = (await requestsFor(client)).find(
        (r) => r.requester_id === actor.id && r.request_key === data.requestKey,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail("FINANCE_KEY_REUSED", "Mã yêu cầu đã dùng cho nội dung khác.");
        return { request: prior, replayed: true };
      }
      await plan(client, b, p);
      if (data.executeNow)
        instrument({ ...p, moneyConfirmed: data.moneyConfirmed });
      const row = {
        booking_id: id,
        request_key: data.requestKey,
        requester_id: actor.id,
        requester_name: actor.name,
        payload: p,
        fingerprint,
      };
      let saved;
      if (client)
        saved = (
          await client.query(
            "INSERT INTO finance_requests(booking_id,request_key,requester_id,requester_name,payload,fingerprint) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            Object.values(row),
          )
        ).rows[0];
      else {
        saved = {
          ...structuredClone(row),
          id: requests.length + 1,
          created_at: new Date().toISOString(),
        };
        requests.push(saved);
      }
      let entries = [],
        decided;
      if (data.executeNow) {
        entries = await apply(client, b, saved, actor, data);
        decided = await decision(client, saved, "approved", actor, p.reason);
      }
      await recordEvent(client, id, "finance-request", actor, {
        requestId: saved.id,
        direct: !!data.executeNow,
      });
      return {
        request: merge(saved, decided),
        payments: entries,
        replayed: false,
      };
    });
  }
  async function decide(requestId, data, actor, guard = async () => {}) {
    if (actor.role !== "admin")
      fail("FORBIDDEN", "Chỉ quản trị được duyệt yêu cầu.", 403);
    if (
      !["approved", "rejected"].includes(data.outcome) ||
      !reason(data.reason)
    )
      fail("INVALID_DECISION", "Cần quyết định và lý do 5–500 ký tự.", 400);
    const found = (await requestsFor(getPool())).find(
      (r) => Number(r.id) === requestId,
    );
    if (!found) fail("REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu.", 404);
    return withBooking(found.booking_id, async (client, b) => {
      await guard(client);
      const r = (await requestsFor(client, b.id)).find(
        (r) => Number(r.id) === requestId,
      );
      if (r.outcome) {
        if (r.outcome !== data.outcome)
          fail("ALREADY_DECIDED", "Yêu cầu đã được quyết định.");
        return { request: r, replayed: true };
      }
      const entries =
        data.outcome === "approved"
          ? await apply(client, b, r, actor, data)
          : [];
      const d = await decision(
        client,
        r,
        data.outcome,
        actor,
        data.reason.trim(),
      );
      await recordEvent(client, b.id, "finance-decision", actor, {
        requestId,
        outcome: data.outcome,
        reason: d.reason,
      });
      return { request: merge(r, d), payments: entries, replayed: false };
    });
  }
  const report = require("./report")({
    getPool,
    atomic,
    allPayments,
    requestsFor,
    reconciliations,
    currentBookings,
    receipt,
    ledger,
  });
  return {
    pay,
    submit,
    decide,
    requestsFor,
    listRequests: () => atomic((client) => requestsFor(client)),
    ...report,
  };
};
