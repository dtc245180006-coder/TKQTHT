const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `scrypt$32768$8$3$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, hash] = String(encoded).split('$');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '3' ||
      !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const candidate = await derive(password, salt, 64, options);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

module.exports = { hashPassword, verifyPassword };
