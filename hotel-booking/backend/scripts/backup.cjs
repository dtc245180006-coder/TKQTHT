const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse } = require('dotenv');
const cwd = path.join(__dirname,'../..');
const config = parse(fs.readFileSync(path.join(cwd,process.env.HOTEL_ENV_FILE || '.env')));
const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const observation=path.join(cwd,'output/operations/backup.json');
function record(success){
  fs.mkdirSync(path.dirname(observation),{recursive:true});
  let prior={};try{prior=JSON.parse(fs.readFileSync(observation,'utf8'));}catch{}
  const now=Date.now()/1000;
  fs.writeFileSync(observation+'.tmp',JSON.stringify({lastAttempt:now,lastSuccess:success?now:Number(prior.lastSuccess)||0,success}));
  fs.renameSync(observation+'.tmp',observation);
}
try {
const dump = execFileSync(docker,['compose',...(process.env.HOTEL_ENV_FILE?['--env-file',process.env.HOTEL_ENV_FILE]:[]),'exec','-T','postgres','pg_dump','-U',config.POSTGRES_USER,'-d',config.POSTGRES_DB], {cwd,maxBuffer:64*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe']});
// Set HOTEL_BACKUP_DIR to keep a manual safety copy outside the source tree.
const directory = process.env.HOTEL_BACKUP_DIR
  ? path.resolve(process.env.HOTEL_BACKUP_DIR)
  : path.join(cwd,'backups');
fs.mkdirSync(directory,{recursive:true});
const target = path.join(directory,`hotel-${new Date().toISOString().replace(/[:.]/g,'-')}.sql`);
fs.writeFileSync(target,dump,{flag:'wx'});
record(true);
console.log(`Backup saved: ${target}`);
}catch{try{record(false);}catch{}console.error('Backup failed; inspect Docker/database/storage. No successful backup recorded.');process.exitCode=1;}
