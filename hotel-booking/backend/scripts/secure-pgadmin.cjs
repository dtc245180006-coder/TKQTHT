// Upgrade desktop-mode volumes without resetting any existing operator's password.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const docker=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker';
const source=`import os, sqlite3, sys, runpy, contextlib, io
email=os.environ['PGADMIN_DEFAULT_EMAIL']
db=sqlite3.connect('/var/lib/pgadmin/pgadmin4.db')
exists=db.execute('select id from user where email=?',(email,)).fetchone()
db.close()
def invoke(args):
    sys.argv=['/pgadmin4/setup.py']+args
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            runpy.run_path('/pgadmin4/setup.py',run_name='__main__')
        except SystemExit as error:
            if error.code not in (None,0): raise RuntimeError('pgAdmin CLI failed')
if not exists:
    password=open('/run/secrets/pgadmin_password').read().strip()
    invoke(['add-user',email,password,'--admin'])
db=sqlite3.connect('/var/lib/pgadmin/pgadmin4.db')
operator=db.execute('select id from user where email=? and active=1',(email,)).fetchone()
if not operator: raise RuntimeError('Configured operator is missing or locked')
servers=db.execute('select count(*) from server where user_id=?',(operator[0],)).fetchone()[0]
db.close()
if not servers: invoke(['load-servers','/pgadmin4/servers.json','--user',email])
if email != 'pgadmin4@pgadmin.org':
    db=sqlite3.connect('/var/lib/pgadmin/pgadmin4.db')
    db.execute('update user set active=0 where email=?',('pgadmin4@pgadmin.org',))
    db.commit()
    db.close()
print('pgAdmin authenticated operator ready; desktop auto-login account disabled.')
`;
try {
  const output=execFileSync(docker,['compose',...(process.env.HOTEL_ENV_FILE?['--env-file',process.env.HOTEL_ENV_FILE]:[]),'exec','-T','pgadmin','/venv/bin/python3','-'],
    {cwd:root,input:source,stdio:['pipe','pipe','pipe'],timeout:60000});
  process.stdout.write(output);
}catch {console.error('pgAdmin operator migration failed. Output suppressed to protect credentials.');process.exitCode=1;}
