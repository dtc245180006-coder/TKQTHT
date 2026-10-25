// Run on the deployment host. Never prints secret contents or overwrites existing files.
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {parse} = require('dotenv');
const root = path.resolve(__dirname,'../..');
const environment = process.argv[2] || 'local';
if (!['local','production'].includes(environment)) throw Error('Use local or production');
const configPath = path.join(root,environment==='local'?'.env':'.env.production');
const config = parse(fs.readFileSync(configPath));
const directory = path.join(root,'secrets',environment);
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const values = {
  postgres_password:config.POSTGRES_PASSWORD,
  app_password:randomBytes(32).toString('hex'),
  migration_password:randomBytes(32).toString('hex'),
  monitor_password:randomBytes(32).toString('hex'),
  session_secret:config.SESSION_SECRET,
  metrics_token:randomBytes(32).toString('hex'),
  admin_password:config.STAFF_ADMIN_PASSWORD,
  reception_password:config.STAFF_RECEPTION_PASSWORD,
  pgadmin_password:config.PGADMIN_PASSWORD,
  grafana_password:config.GRAFANA_PASSWORD
};
for (const [key,value] of Object.entries(values)) {
  const target = path.join(directory,key);
  if (fs.existsSync(target)) continue;
  if (!value || value.startsWith('CHANGE_ME')) throw Error(`Configure ${key} in ${path.basename(configPath)}`);
  fs.writeFileSync(target,value+'\n',{flag:'wx',mode:0o600});
}
console.log(`Secret files ready: secrets/${environment}. Existing values preserved. Protect this directory with host ACLs.`);
