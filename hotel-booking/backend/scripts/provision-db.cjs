// Local Docker operator tool. SQL/passwords travel over stdin, never CLI arguments/logs.
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {parse} = require('dotenv');
const root = path.resolve(__dirname,'../..');
const config = {...parse(fs.readFileSync(path.join(root,process.env.HOTEL_ENV_FILE || '.env'))),...process.env};
const database = process.argv[2] || config.POSTGRES_DB;
if (database !== config.POSTGRES_DB && !/^hotel_stay_test_\d+$/.test(database)) throw Error('Unexpected target database');
const directory = path.resolve(root,config.SECRETS_DIR || 'secrets/local');
const identifier = value => '"'+value.replace(/"/g,'""')+'"';
const literal = value => "'"+value.replace(/'/g,"''")+"'";
let sql = 'BEGIN;\n';
for (const [role,file] of [['hotel_app','app_password'],['hotel_migrator','migration_password'],['hotel_monitor','monitor_password']]) {
  const password = fs.readFileSync(path.join(directory,file),'utf8').trim();
  sql += `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=${literal(role)}) THEN CREATE ROLE ${role}; END IF; END $$;\n`;
  sql += `ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)};\n`;
}
sql += `ALTER DATABASE ${identifier(database)} OWNER TO hotel_migrator;
REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${identifier(database)} TO hotel_app,hotel_monitor;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO hotel_migrator;
GRANT USAGE ON SCHEMA public TO hotel_app;
GRANT pg_monitor TO hotel_monitor;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','S') ORDER BY c.relkind DESC LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO hotel_migrator',CASE WHEN item.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,item.relname);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,hotel_app,hotel_monitor;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,hotel_app,hotel_monitor;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO hotel_app;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['rooms','customers','staff_sessions'] LOOP
    IF to_regclass('public.'||name) IS NOT NULL THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO hotel_app',name); END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['staff_users','bookings'] LOOP
    IF to_regclass('public.'||name) IS NOT NULL THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO hotel_app',name); END IF;
  END LOOP;
  FOREACH name IN ARRAY ARRAY['staff_audit_events','booking_events','booking_payments','booking_requests','booking_revisions','finance_requests','finance_decisions','finance_reconciliations'] LOOP
    IF to_regclass('public.'||name) IS NOT NULL THEN EXECUTE format('GRANT SELECT,INSERT ON public.%I TO hotel_app',name); END IF;
  END LOOP;
  IF to_regclass('public.app_migrations') IS NOT NULL THEN GRANT SELECT ON app_migrations TO hotel_app; END IF;
  IF to_regclass('public.booking_current') IS NOT NULL THEN GRANT SELECT ON booking_current TO hotel_app; END IF;
END $$;
COMMIT;`;
const docker = process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker';
const args=['compose',...(process.env.HOTEL_ENV_FILE?['--env-file',process.env.HOTEL_ENV_FILE]:[]),'exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-U',config.POSTGRES_USER,'-d',database];
try {
  execFileSync(docker,args,{cwd:root,input:sql,stdio:['pipe','pipe','pipe'],timeout:30000});
  console.log('Database ownership and least-privilege grants applied.');
} catch { console.error('Database provisioning failed. SQL output suppressed to protect credentials; check connectivity and database ownership.'); process.exitCode=1; }
