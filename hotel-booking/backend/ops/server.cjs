const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const state = process.env.OPS_STATE_DIR || "/var/lib/hotel-ops";
fs.mkdirSync(state, { recursive: true });
const targets = {
  backend: "http://backend:5000/live",
  database: "http://backend:5000/ready",
  website: "http://nginx:8080/ready",
  grafana: "http://grafana:3000/api/health",
  loki: "http://loki:3100/ready",
  alloy: "http://alloy:12345/-/ready",
  pgadmin: "http://pgadmin:8080/misc/ping",
  alertmanager: "http://alertmanager:9093/-/ready",
  prometheus: "http://prometheus:9090/-/ready",
};
let probes = {},
  lastProbe = 0,
  busy = false;
async function probe() {
  if (busy) return;
  busy = true;
  try {
    await Promise.all(
      Object.entries(targets).map(async ([name, url]) => {
        try {
          probes[name] = (
            await fetch(url, { signal: AbortSignal.timeout(2500) })
          ).ok
            ? 1
            : 0;
        } catch {
          probes[name] = 0;
        }
      }),
    );
    lastProbe = Date.now() / 1000;
  } finally {
    busy = false;
  }
}
function read(file) {
  try {
    return JSON.parse(
      fs
        .readFileSync(
          path.join(process.env.OPS_OBSERVATIONS || "/observations", file),
          "utf8",
        )
        .replace(/^\uFEFF/, ""),
    );
  } catch {
    return {};
  }
}
function metrics() {
  const lines = Object.entries(probes).map(
    ([service, n]) => `hotel_probe_success{service="${service}"} ${n}`,
  );
  lines.push(`hotel_probe_timestamp_seconds ${lastProbe}`);
  try {
    const d = fs.statfsSync(state);
    lines.push(
      `hotel_disk_free_ratio{filesystem="docker_data"} ${d.bavail / d.blocks}`,
    );
  } catch {}
  const host = read("host.json"),
    backup = read("backup.json");
  lines.push(
    `hotel_host_observation_timestamp_seconds ${Number(host.timestamp) || 0}`,
  );
  if (Number.isFinite(host.freeRatio))
    lines.push(
      `hotel_disk_free_ratio{filesystem="windows_project_drive"} ${host.freeRatio}`,
    );
  lines.push(
    `hotel_backup_last_success_timestamp_seconds ${Number(backup.lastSuccess) || 0}`,
    `hotel_backup_last_attempt_timestamp_seconds ${Number(backup.lastAttempt) || 0}`,
    `hotel_backup_last_attempt_success ${backup.success === true ? 1 : 0}`,
  );
  return lines.join("\n") + "\n";
}
function save(alerts) {
  const file = path.join(state, "alerts.jsonl");
  if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
    for (let i = 2; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i}`);
    }
  }
  for (const a of alerts) {
    const allowed = [
      "alertname",
      "severity",
      "service",
      "job",
      "instance",
      "filesystem",
    ];
    const labels = Object.fromEntries(
      allowed
        .filter((k) => typeof a.labels?.[k] === "string")
        .map((k) => [k, a.labels[k].slice(0, 120)]),
    );
    fs.appendFileSync(
      file,
      JSON.stringify({
        receivedAt: new Date().toISOString(),
        status: a.status === "resolved" ? "resolved" : "firing",
        labels,
        fingerprint: String(a.fingerprint || "").slice(0, 80),
      }) + "\n",
    );
  }
}
function inbox() {
  try {
    return fs
      .readFileSync(path.join(state, "alerts.jsonl"), "utf8")
      .trim()
      .split("\n")
      .slice(-300)
      .filter(Boolean)
      .map((s) => JSON.parse(s))
      .reverse();
  } catch {
    return [];
  }
}
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
http
  .createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" && req.url === "/health") return res.end("ok");
    if (req.method === "GET" && req.url === "/metrics") {
      res.setHeader("Content-Type", "text/plain");
      return res.end(metrics());
    }
    if (req.method === "GET" && req.url === "/alerts") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(inbox()));
    }
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>Cảnh báo vận hành</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:12px}td,th{padding:12px;border:1px solid #ddd}table{border-collapse:collapse;width:100%}</style><h1>Cảnh báo vận hành localhost</h1><p>Chưa thay thế kênh thông báo ngoài máy. Tải lại trang để cập nhật; 300 lần gửi gần nhất. Người phụ trách cần được chủ dự án xác nhận.</p><table><tr><th>Nhận lúc</th><th>Trạng thái</th><th>Nội dung</th></tr>' +
          inbox()
            .map(
              (a) =>
                "<tr><td>" +
                esc(a.receivedAt) +
                "</td><td>" +
                esc(a.status) +
                "</td><td>" +
                esc(JSON.stringify(a.labels)) +
                "</td></tr>",
            )
            .join("") +
          "</table>",
      );
    }
    if (req.method === "POST" && req.url === "/webhook") {
      let chunks = [],
        size = 0;
      try {
        for await (const c of req) {
          size += c.length;
          if (size > 131072) {
            res.writeHead(413);
            return res.end();
          }
          chunks.push(c);
        }
        const body = JSON.parse(Buffer.concat(chunks));
        if (!Array.isArray(body.alerts) || body.alerts.length > 100)
          throw Error();
        save(body.alerts);
        res.writeHead(200);
        return res.end("received");
      } catch {
        res.writeHead(400);
        return res.end("invalid");
      }
    }
    res.writeHead(404);
    res.end();
  })
  .listen(9094, "0.0.0.0");
probe();
setInterval(probe, 15000).unref();
