const client = require('prom-client');

// Initialize Prometheus Register
const register = new client.Registry();

// Add default metrics (CPU, Memory, Event Loop, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'hotel_'
});

// Custom metric: Total HTTP Requests
const httpRequestCounter = new client.Counter({
  name: 'hotel_http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// Custom metric: HTTP Request Duration in Seconds
const httpRequestDuration = new client.Histogram({
  name: 'hotel_http_request_duration_seconds',
  help: 'Histogram of HTTP request durations in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register]
});

// Custom metric: Bookings created counter
const bookingsTotal = new client.Counter({
  name: 'hotel_bookings_created_total',
  help: 'Total number of hotel bookings created',
  labelNames: ['room_type'],
  registers: [register]
});

// Middleware to measure request duration
function metricsMiddleware(req, res, next) {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const route = require('./operations/logging').routeLabel(req);

    httpRequestCounter.inc({
      method: req.method,
      route,
      status_code: res.statusCode
    });

    httpRequestDuration.observe({
      method: req.method,
      route,
      status_code: res.statusCode
    }, durationInSeconds);
  });

  next();
}

module.exports = {
  register,
  metricsMiddleware,
  bookingsTotal
};
