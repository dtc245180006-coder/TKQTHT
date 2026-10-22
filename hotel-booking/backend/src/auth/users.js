const db = require('../db');
const memoryUsers = [];

async function initialize() {
  const pool = db.getPool();
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(80462027)');
    await client.query(`CREATE TABLE IF NOT EXISTS staff_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'receptionist')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS temporary_password_expires_at TIMESTAMPTZ;
    ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
    INSERT INTO app_migrations (id) VALUES ('staff_accounts_v1') ON CONFLICT (id) DO NOTHING;`);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function findByUsername(username, client) {
  const pool = client || db.getPool();
  if (pool) return (await pool.query('SELECT * FROM staff_users WHERE username=$1', [username])).rows[0];
  const found = memoryUsers.find(user => user.username === username);
  return found && { ...found };
}

async function findById(id, client) {
  const pool = client || db.getPool();
  if (pool) return (await pool.query('SELECT * FROM staff_users WHERE id=$1', [id])).rows[0];
  const found = memoryUsers.find(user => user.id === id);
  return found && { ...found };
}

async function create(user, client) {
  const pool = client || db.getPool();
  if (pool) {
    return (await pool.query(`INSERT INTO staff_users (username,display_name,password_hash,role,must_change_password,temporary_password_expires_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (username) DO NOTHING RETURNING *`,
    [user.username, user.display_name, user.password_hash, user.role, !!user.must_change_password,
      user.must_change_password ? new Date(Date.now()+24*60*60*1000) : null])).rows[0];
  } else if (!await findByUsername(user.username)) {
    const created = { ...user, id: memoryUsers.length + 1, active:true, session_version:1,
      must_change_password:!!user.must_change_password, created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
    created.temporary_password_expires_at = user.must_change_password ? new Date(Date.now()+24*60*60*1000).toISOString() : null;
    memoryUsers.push(created);
    return { ...created };
  }
}

async function all(client) {
  const pool = client || db.getPool();
  return pool ? (await pool.query('SELECT * FROM staff_users ORDER BY id')).rows : memoryUsers.map(user=>({...user}));
}
async function update(id, changes, client) {
  const allowed = ['display_name','role','active','password_hash','must_change_password','session_version','temporary_password_expires_at'];
  const keys = allowed.filter(key=>Object.hasOwn(changes,key));
  const pool = client || db.getPool();
  if (pool) return (await pool.query(`UPDATE staff_users SET ${keys.map((key,i)=>`${key}=$${i+2}`).join(',')},updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[id,...keys.map(key=>changes[key])])).rows[0];
  const user = memoryUsers.find(user=>user.id===id);
  if (!user) return null;
  for (const key of keys) user[key] = changes[key];
  user.updated_at = new Date().toISOString();
  return { ...user };
}
function safe(user) {
  return { id:user.id, username:user.username, displayName:user.display_name, role:user.role, active:user.active,
    mustChangePassword:user.must_change_password, temporaryPasswordExpiresAt:user.temporary_password_expires_at,
    createdAt:user.created_at, updatedAt:user.updated_at };
}
module.exports = { initialize, findByUsername, findById, create, all, update, safe };
