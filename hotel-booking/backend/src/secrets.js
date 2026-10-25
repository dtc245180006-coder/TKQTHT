const fs = require('node:fs');
// Mounted secrets override environment values, including inherited development values.
module.exports = function loadSecrets() {
  for (const key of ['DB_PASSWORD','SESSION_SECRET','METRICS_TOKEN','STAFF_ADMIN_PASSWORD','STAFF_RECEPTION_PASSWORD']) {
    if (process.env[`${key}_FILE`]) process.env[key] = fs.readFileSync(process.env[`${key}_FILE`], 'utf8').trim();
  }
};
