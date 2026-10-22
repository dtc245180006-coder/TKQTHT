const express = require('express');
const router = express.Router();
const os = require('os');
const db = require('../db');
const { requireRoles } = require('../auth');

// Healthcheck endpoint for Docker / Nginx
router.get('/health', require('../operations/health')(db).ready);

// System info endpoint (for UI status badge and debugging)
router.get('/status', requireRoles('admin'), async (req, res) => {
  const actual=await require('../operations/health')(db).check();
  const dbStatus = {...db.getDbStatus(),connected:actual.database};
  res.json({
    appName: 'Hotel Booking System',
    version: require('../../package.json').version,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    platform: process.platform,
    hostname: os.hostname(),
    uptimeSeconds: Math.floor(process.uptime()),
    memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    database: dbStatus
  });
});

module.exports = router;
