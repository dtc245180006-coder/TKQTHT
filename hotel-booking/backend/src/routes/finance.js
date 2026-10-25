const router = require("express").Router();
const { requireRoles, STAFF, noStore } = require("../auth");
const staff = require("../auth/staff");
const finance = require("../db").finance;
const { rateLimit } = require("express-rate-limit");
router.use(requireRoles(...STAFF), noStore);
const reauthLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Quá nhiều lần xác nhận mật khẩu thất bại. Thử lại sau 15 phút.",
  },
});
const positive = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0;
function error(res, e) {
  if (!e.status) console.error("[Finance]", e.code || e.name);
  res
    .status(e.status || 500)
    .json({
      success: false,
      code: e.code,
      message: e.status ? e.message : "Không thể xử lý thanh toán/đối soát.",
    });
}
async function adminGuard(req) {
  const snapshot = await staff.reauthenticate(
    req.user,
    req.body.currentPassword,
  );
  if (snapshot.role !== "admin")
    throw Object.assign(Error("Chỉ quản trị được duyệt/thực hiện trực tiếp."), {
      status: 403,
    });
  return async (client) => {
    if (client) await client.query("SELECT pg_advisory_xact_lock(80462027)");
    await staff.checkActor(req.user, snapshot, client, true);
  };
}
router.get("/report", async (req, res) => {
  try {
    res.json({ success: true, data: await finance.report(req.query.date) });
  } catch (e) {
    error(res, e);
  }
});
router.get("/requests", async (req, res) => {
  try {
    res.json({ success: true, data: await finance.listRequests() });
  } catch (e) {
    error(res, e);
  }
});
router.post("/requests", reauthLimit, async (req, res) => {
  try {
    if (!positive(req.body.bookingId))
      return res
        .status(400)
        .json({ success: false, message: "Mã đơn không hợp lệ." });
    if (req.body.executeNow && req.user.role !== "admin")
      return res
        .status(403)
        .json({
          success: false,
          message: "Chỉ quản trị được thực hiện trực tiếp.",
        });
    const guard = req.body.executeNow ? await adminGuard(req) : undefined;
    const result = await finance.submit(
      Number(req.body.bookingId),
      req.body,
      req.user,
      guard,
    );
    res
      .status(result.replayed ? 200 : 201)
      .json({ success: true, data: result });
  } catch (e) {
    error(res, e);
  }
});
router.post(
  "/requests/:id/decision",
  requireRoles("admin"),
  reauthLimit,
  async (req, res) => {
    try {
      if (!positive(req.params.id))
        return res
          .status(400)
          .json({ success: false, message: "Mã yêu cầu không hợp lệ." });
      const guard = await adminGuard(req);
      res.json({
        success: true,
        data: await finance.decide(
          Number(req.params.id),
          req.body,
          req.user,
          guard,
        ),
      });
    } catch (e) {
      error(res, e);
    }
  },
);
router.post("/reconciliations", async (req, res) => {
  try {
    const result = await finance.reconcile(req.body, req.user);
    res
      .status(result.replayed ? 200 : 201)
      .json({ success: true, data: result });
  } catch (e) {
    error(res, e);
  }
});
router.get("/receipts/:id", async (req, res) => {
  try {
    if (!positive(req.params.id)) return res.sendStatus(400);
    res.json({
      success: true,
      data: await finance.getReceipt(Number(req.params.id)),
    });
  } catch (e) {
    error(res, e);
  }
});
module.exports = router;
