require('../src/secrets')();
if (process.env.DB_AUTO_MIGRATE !== 'true') throw Error('Migration job requires DB_AUTO_MIGRATE=true');
const db = require('../src/db');
(async()=>{
  await db.initDatabase();
  if (!db.getPool()) throw Error('Migration requires PostgreSQL');
  await require('../src/auth').initialize();
  await db.getPool().query(`CREATE TABLE IF NOT EXISTS staff_sessions (
    sid VARCHAR PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP(6) NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_staff_sessions_expire ON staff_sessions(expire);
    INSERT INTO app_migrations(id) VALUES('deployment_roles_v1') ON CONFLICT DO NOTHING;`);
  await db.getPool().end();
  console.log('Schema migration and missing bootstrap accounts completed. Existing accounts preserved.');
  process.exit(0);
})().catch(()=>{console.error('Migration failed; application must remain stopped until resolved.');process.exit(1);});
