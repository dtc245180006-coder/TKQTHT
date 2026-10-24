module.exports = function health(db) {
  let pending;
  async function check() {
    if (pending) return pending;
    pending = (async () => {
      const pool = db.getPool();
      if (!pool)
        return {
          ready: process.env.NODE_ENV !== "production",
          database: false,
          mode: "memory",
        };
      let timer;
      try {
        await Promise.race([
          pool.query({
            text: "SELECT 1 FROM public.rooms LIMIT 1",
            query_timeout: 1500,
          }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Readiness deadline")),
              1800,
            );
          }),
        ]);
        return { ready: true, database: true, mode: "postgres" };
      } catch {
        return { ready: false, database: false, mode: "postgres" };
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }
  return {
    check,
    live: (req, res) =>
      res.set("Cache-Control", "no-store").json({ status: "alive" }),
    ready: async (req, res) => {
      const result = await check();
      res
        .set("Cache-Control", "no-store")
        .status(result.ready ? 200 : 503)
        .json({
          status: result.ready ? "ready" : "unavailable",
          database: result.database,
          mode: result.mode,
        });
    },
  };
};
