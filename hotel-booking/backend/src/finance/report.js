const { fail, cents, amount, summarize } = require("../bookings/rules");
const { validDate, today } = require("../validation");
const { METHODS, uuid, reason, digest, totals } = require("./common");
module.exports = ({
  getPool,
  atomic,
  allPayments,
  requestsFor,
  reconciliations,
  currentBookings,
  receipt,
}) => {
  function bounds(date) {
    if (!validDate(date))
      fail("INVALID_REPORT_DATE", "Ngày đối soát không hợp lệ.", 400);
    return [
      new Date(`${date}T00:00:00+07:00`),
      new Date(Date.parse(`${date}T00:00:00+07:00`) + 86400000),
    ];
  }
  async function build(client, date) {
    const [start, end] = bounds(date);
    const rows = client
      ? (
          await client.query(
            "SELECT * FROM booking_payments WHERE created_at>=$1 AND created_at<$2 ORDER BY id",
            [start, end],
          )
        ).rows
      : (await allPayments(null)).filter(
          (p) =>
            Date.parse(p.created_at) >= +start &&
            Date.parse(p.created_at) < +end,
        );
    const byMethod = Object.fromEntries(
      Object.keys(METHODS).map((method) => [
        method,
        totals(rows.filter((p) => p.method === method)),
      ]),
    );
    return {
      date,
      timezone: "Asia/Ho_Chi_Minh",
      totals: totals(rows),
      byMethod,
      digest: digest(
        rows.map((p) => [
          p.id,
          p.amount,
          p.method,
          p.entry_type || "normal",
          p.credit_amount || 0,
        ]),
      ),
      count: rows.length,
      entries: rows.slice(-500).reverse().map(receipt),
      entriesTruncated: rows.length > 500,
    };
  }
  async function report(date = today()) {
    return atomic(async (client) => {
      const summary = await build(client, date),
        all = await allPayments(client);
      const bookings = client
        ? (await client.query("SELECT * FROM booking_current ORDER BY id")).rows
        : currentBookings();
      const debts = bookings
        .map((b) =>
          summarize(
            b,
            all.filter((p) => p.booking_id === b.id),
          ),
        )
        .filter((b) => b.balance_due > 0);
      const records = client
        ? (
            await client.query(
              "SELECT * FROM finance_reconciliations WHERE business_date=$1 ORDER BY id DESC",
              [date],
            )
          ).rows
        : reconciliations
            .filter((r) => r.business_date === date)
            .slice()
            .reverse();
      return {
        ...summary,
        debtAsOf: new Date().toISOString(),
        debtTotal: amount(
          debts.reduce((sum, b) => sum + cents(b.balance_due), 0),
        ),
        debts,
        reconciliations: records.map((row) => ({
          ...row,
          stale: row.report_digest !== summary.digest,
        })),
        methods: METHODS,
      };
    });
  }
  async function reconcile(data, actor) {
    bounds(data.date);
    if (
      !uuid(data.requestKey) ||
      !reason(data.reason) ||
      typeof data.reportDigest !== "string"
    )
      fail(
        "INVALID_RECONCILIATION",
        "Cần mã yêu cầu, lý do đối soát và phiên bản báo cáo.",
        400,
      );
    for (const method of Object.keys(METHODS)) {
      const n = data.actual?.[method];
      if (
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        Math.abs(n * 100 - cents(n)) > 0.0001 ||
        Math.abs(cents(n)) > 999999999999
      )
        fail(
          "INVALID_ACTUAL",
          "Nhập số thu ròng đối chiếu cho từng phương thức (tối đa 2 số thập phân).",
          400,
        );
    }
    return atomic(async (client) => {
      const prior = client
        ? (
            await client.query(
              "SELECT * FROM finance_reconciliations WHERE staff_user_id=$1 AND request_key=$2",
              [actor.id, data.requestKey],
            )
          ).rows[0]
        : reconciliations.find(
            (r) =>
              r.staff_user_id === actor.id && r.request_key === data.requestKey,
          );
      if (prior) {
        if (
          prior.business_date !== data.date ||
          Object.keys(METHODS).some(
            (method) =>
              cents(prior.actual[method]) !== cents(data.actual[method]),
          ) ||
          prior.reason !== data.reason.trim() ||
          prior.report_digest !== data.reportDigest
        )
          fail(
            "RECONCILIATION_KEY_REUSED",
            "Mã yêu cầu đối soát đã dùng cho nội dung khác.",
          );
        return { ...prior, replayed: true };
      }
      const current = await build(client, data.date);
      if (current.digest !== data.reportDigest)
        fail(
          "STALE_REPORT",
          "Báo cáo đã có giao dịch mới. Tải lại rồi đối soát.",
        );
      const expected = Object.fromEntries(
        Object.entries(current.byMethod).map(([method, t]) => [method, t.net]),
      );
      const actual = Object.fromEntries(
        Object.keys(METHODS).map((method) => [method, data.actual[method]]),
      );
      const difference = Object.fromEntries(
        Object.keys(METHODS).map((method) => [
          method,
          amount(cents(actual[method]) - cents(expected[method])),
        ]),
      );
      const row = {
        business_date: data.date,
        request_key: data.requestKey,
        staff_user_id: actor.id,
        staff_name: actor.name,
        report_digest: current.digest,
        expected,
        actual,
        difference,
        reason: data.reason.trim(),
      };
      let saved;
      if (client)
        saved = (
          await client.query(
            `INSERT INTO finance_reconciliations(business_date,request_key,staff_user_id,staff_name,report_digest,expected,actual,difference,reason)
        VALUES(${Object.keys(row)
          .map((_, i) => "$" + (i + 1))
          .join(",")}) RETURNING *`,
            Object.values(row),
          )
        ).rows[0];
      else {
        saved = {
          ...structuredClone(row),
          id: reconciliations.length + 1,
          created_at: new Date().toISOString(),
        };
        reconciliations.push(saved);
      }
      await require("../audit").record(
        actor,
        "finance.reconcile",
        "reconciliation",
        Number(saved.id),
        { date: data.date, difference },
        client,
      );
      return { ...saved, replayed: false };
    });
  }
  async function getReceipt(id) {
    return atomic(async (client) => {
      const row = (await allPayments(client)).find((p) => p.id === id);
      if (!row) fail("RECEIPT_NOT_FOUND", "Không tìm thấy phiếu.", 404);
      const request = row.finance_request_id
        ? (await requestsFor(client, row.booking_id)).find(
            (r) => Number(r.id) === Number(row.finance_request_id),
          )
        : null;
      return {
        payment: receipt(row),
        approval: request || null,
        methods: METHODS,
      };
    });
  }
  return { report, reconcile, getReceipt };
};
