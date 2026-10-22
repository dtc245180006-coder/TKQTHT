const fs = require("node:fs");
const path = require("node:path");
const directory = process.env.OPERATIONS_LOG_DIR;
function routeLabel(req) {
  const url = (req.originalUrl || req.url || "").split("?")[0];
  const prefix = [
    "/api/auth",
    "/api/staff",
    "/api/bookings",
    "/api/finance",
    "/api/customers",
    "/api/rooms",
    "/api/system",
  ].find((p) => url === p || url.startsWith(p + "/"));
  if (req.route && typeof req.route.path === "string")
    return (prefix || "") + req.route.path;
  if (/^\/(live|ready|health|metrics)$/.test(url)) return url;
  return "/other";
}
function write(entry) {
  const line =
    JSON.stringify({ time: new Date().toISOString(), ...entry }) + "\n";
  process.stdout.write(line);
  if (!directory) return;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "app.log");
    if (
      fs.existsSync(file) &&
      fs.statSync(file).size + Buffer.byteLength(line) > 5 * 1024 * 1024
    ) {
      for (let i = 4; i >= 1; i--) {
        const source = i === 1 ? file : `${file}.${i - 1}`;
        if (fs.existsSync(source)) fs.renameSync(source, `${file}.${i}`);
      }
    }
    fs.appendFileSync(file, line, { mode: 0o640 });
  } catch {
    process.stderr.write('{"level":"error","event":"log_write_failed"}\n');
  }
}
function install() {
  for (const level of ["error", "warn"])
    console[level] = (...args) =>
      write({
        level,
        event: "application_error",
        category:
          String(args[0] || "").match(/^\[([A-Za-z ]{1,40})\]/)?.[1] ||
          "application",
        code:
          typeof args[1]?.code === "string" &&
          /^[A-Z0-9_]{1,40}$/.test(args[1].code)
            ? args[1].code
            : "REDACTED",
      });
}
function http(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () =>
    write({
      level: res.statusCode >= 500 ? "error" : "info",
      event: "http",
      method: [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "HEAD",
        "OPTIONS",
      ].includes(req.method)
        ? req.method
        : "OTHER",
      route: routeLabel(req),
      status: res.statusCode,
      duration_ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
    }),
  );
  next();
}
module.exports = { routeLabel, write, install, http };
