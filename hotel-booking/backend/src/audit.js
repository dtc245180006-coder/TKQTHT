const memory = [];
let queue = Promise.resolve();
const getPool = () => require('./db').getPool();

async function initialize() {
  const pool = getPool();
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(80462028)');
    await client.query(`CREATE TABLE IF NOT EXISTS staff_audit_events (
    id BIGSERIAL PRIMARY KEY, actor_user_id INTEGER, actor_name VARCHAR(120) NOT NULL,
    action VARCHAR(64) NOT NULL, entity_type VARCHAR(32) NOT NULL, entity_id INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  ); CREATE INDEX IF NOT EXISTS idx_staff_audit_created ON staff_audit_events (id DESC);
    INSERT INTO app_migrations (id) VALUES ('staff_audit_v1') ON CONFLICT (id) DO NOTHING;`);
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function record(actor, action, entity, entityId, metadata = {}, client) {
  const values = [actor?.id || null, actor?.name || 'Hệ thống', action, entity, entityId || null, JSON.stringify(metadata)];
  if (client || getPool()) await (client || getPool()).query(`INSERT INTO staff_audit_events
    (actor_user_id,actor_name,action,entity_type,entity_id,metadata) VALUES ($1,$2,$3,$4,$5,$6)`, values);
  else memory.push({ id:memory.length+1, actor_user_id:values[0], actor_name:values[1], action, entity_type:entity,
    entity_id:values[4], metadata, created_at:new Date().toISOString() });
}
// Mutation and audit row commit together. No request body or password is logged.
async function run(options, work) {
  async function execute(client) {
    if (client && options.staffLock) await client.query('SELECT pg_advisory_xact_lock(80462027)');
    const result = await work(client);
    if (result && !result.conflict) await record(options.actor,options.action,options.entity,
      options.entityId || result.id || result.user?.id,options.metadata || {},client);
    return result;
  }
  const pool = getPool();
  if (!pool) {
    const task = queue.then(()=>execute(null));
    queue = task.catch(()=>{});
    return task;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await execute(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function list(before) {
  const pool = getPool();
  const rows = pool ? (await pool.query(`SELECT * FROM staff_audit_events
    WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT 101`, [before || null])).rows :
    memory.filter(e=>!before || e.id<before).slice().reverse().slice(0,101);
  return { events:rows.slice(0,100), nextCursor:rows.length>100 ? String(rows[99].id) : null };
}
module.exports = { initialize, record, run, list };
