const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('./secrets')();
const operationsLog=require('./operations/logging');
operationsLog.install();
const { timingSafeEqual } = require('node:crypto');

const db = require('./db');
const auth = require('./auth');
const { register, metricsMiddleware } = require('./metrics');
const roomRoutes = require('./routes/rooms');
const bookingRoutes = require('./routes/bookings');
const systemRoutes = require('./routes/system');

const app = express();
const PORT = process.env.PORT || 5000;
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middleware
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);
if (process.env.REQUIRE_HTTPS === 'true' && process.env.SESSION_COOKIE_SECURE !== 'true') {
  throw new Error('HTTPS deployments require Secure session cookies');
}
app.use((req,res,next) => {
  if (process.env.REQUIRE_HTTPS === 'true' && !req.secure && !['/live','/ready','/health','/metrics'].includes(req.path)) {
    return res.status(400).json({success:false,code:'HTTPS_REQUIRED'});
  }
  next();
});
if (process.env.NODE_ENV !== 'production') app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

app.use(operationsLog.http);

// Prometheus Monitoring Middleware
app.use(metricsMiddleware);
const health=require('./operations/health')(db);
app.get('/live',health.live);
app.get('/ready',health.ready);
app.get('/health',health.ready);

// Static Web Assets (Frontend UI)
app.use(express.static(path.join(__dirname, '../public')));

// Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  const supplied = req.get('authorization') || '';
  const wanted = `Bearer ${expected}`;
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(wanted) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(wanted))) {
    return res.sendStatus(403);
  }
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// API Routes
app.use(auth.middleware);
app.use('/api/auth', require('./routes/auth'));
app.use(auth.requirePasswordChange);
app.use('/api/staff',require('./routes/staff'));
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/finance',require('./routes/finance'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/system', systemRoutes);

// Each frontend page has its own template and browser module.
app.use((req, res, next) => {
  res.locals.csrfToken = auth.csrfToken(req);
  next();
});
app.use('/', require('./routes/pages'));
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint không tồn tại' });
});
app.use((error, req, res, next) => {
  console.error('[Error] Request failed:', error.message);
  res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
});

// Start Server
async function startServer() {
  await db.initDatabase();
  await auth.initialize();
  await db.expirePendingBookings();
  let sweeping = false;
  const expiryTimer = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try { await db.expirePendingBookings(); }
    catch (error) { console.error('[Booking expiry]', error.message); }
    finally { sweeping = false; }
  }, 30000);
  expiryTimer.unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🏨 HOTEL BOOKING MANAGEMENT SYSTEM STARTED`);
    console.log(`🌐 Website URL: http://localhost:${PORT}`);
    console.log(`📊 Metrics URL: http://localhost:${PORT}/metrics`);
    console.log(`❤️ Healthcheck: http://localhost:${PORT}/health`);
    console.log(`====================================================`);
  });
}

startServer();
