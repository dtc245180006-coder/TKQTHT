// Localhost deployment only. See README.md for deployment requirements.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
if(process.env.HOTEL_ENV_FILE && process.env.HOTEL_ENV_FILE!=='.env') throw Error('This script is for localhost .env only');
const docker=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker';
function compose(...args){execFileSync(docker,['compose',...args],{cwd:root,stdio:'inherit',timeout:180000});}
function script(name){execFileSync(process.execPath,[path.join(__dirname,name)],{cwd:root,stdio:'inherit',timeout:60000});}
try {
  script('prepare-secrets.cjs');
  compose('config','--quiet');
  if(!process.argv.includes('--no-build')) compose('build','backend');
  compose('stop','nginx','backend');
  compose('up','-d','--wait','postgres');
  script('backup.cjs');
  script('provision-db.cjs');
  compose('run','--rm','--no-deps','migrate');
  script('provision-db.cjs');
  // Stop previously-enabled host collectors; preserve volumes and positions.
  compose('--profile','host-observability','stop','cadvisor');
  compose('run','--rm','--no-deps','--user','0','--cap-add','CHOWN','backend','chown','1000:1000','/var/log/hotel');
  compose('up','-d','--no-build','--wait');
  script('secure-pgadmin.cjs');
  compose('restart','nginx');
  console.log('Local deployment updated. Website and operator ports bind to 127.0.0.1 only.');
} catch {
  console.error('Deployment stopped on error. Do not remove volumes. Resolve the failed step before restarting the application.');
  process.exitCode=1;
}
