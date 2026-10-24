// Read-only pre-commit check. Reports paths and rule names, never secret values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse } = require('dotenv');
const cwd = path.resolve(__dirname, '../..');
const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' });
const envPath = path.join(cwd, '.env');
const config = fs.existsSync(envPath) ? parse(fs.readFileSync(envPath)) : {};
const secrets = Object.entries(config).filter(([key, value]) =>
  /PASSWORD|SECRET|TOKEN|PRIVATE_KEY/i.test(key) && value.length >= 8 && !value.startsWith('CHANGE_ME'));
for (const environment of ['local','production']) {
  const directory=path.join(cwd,'secrets',environment);
  if(fs.existsSync(directory)) for(const file of fs.readdirSync(directory)) {
    const value=fs.readFileSync(path.join(directory,file),'utf8').trim();
    if(value.length>=8) secrets.push([`${environment}/${file}`,value]);
  }
}
const files = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))];
const findings = [];
let checked = 0;
for (const file of files) {
  if (!fs.existsSync(path.join(cwd, file))) continue; // Deleted tracked files are not published.
  if (/(^|\/)(node_modules|output|backups|data|secrets)(\/|$)|(^|\/)\.env(?:\..+)?$|\.(?:sql|dump|backup|log|key|pem)$/i.test(file) && !/(^|\/)\.env\.example$/.test(file)) {
    findings.push({ file, rule: 'sensitive-or-generated-path' });
    continue;
  }
  const buffer = fs.readFileSync(path.join(cwd, file));
  checked++;
  // Exact known secrets are checked even in binary assets.
  for (const [key, value] of secrets) {
    if (buffer.includes(Buffer.from(value))) findings.push({ file, rule: `local-secret:${key}` });
  }
  if (buffer.includes(0)) continue;
  const content = buffer.toString('utf8');
  const patterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
    ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/]
  ];
  for (const [rule, pattern] of patterns) if (pattern.test(content)) findings.push({ file, rule });
}
const ignored = ['.env', 'backend/.env', '.env.production', 'backend/node_modules/example',
  'backups/example.sql', 'output/example.json', 'example.log', 'certs/example.key','secrets/local/app_password','secrets/production/app_password'];
for (const file of ignored) {
  try { git(['check-ignore', '--no-index', '-q', '--', file]); }
  catch { findings.push({ file, rule: 'missing-ignore-rule' }); }
}
console.log(JSON.stringify({ checked, knownSecretCount: secrets.length, findings,
  scope: 'Current source candidates only; checks local configured secrets and selected credential formats, not Git history or all possible secrets.' }, null, 2));
if (findings.length) process.exitCode = 1;
