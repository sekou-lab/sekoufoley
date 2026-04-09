'use strict';

/**
 * Calexo HVAC Voice Agent – Express entry point
 *
 * Routes:
 *   GET  /health        → liveness probe (Railway)
 *   POST /vapi/webhook  → Vapi events (tool-calls, call lifecycle)
 *   POST /hcp/webhook   → HouseCall Pro job status updates
 */

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const vapiRoutes = require('./routes/vapi');
const hcpRoutes = require('./routes/hcp');

const app = express();

// ---------------------------------------------------------------------------
// Security + parsing middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1); // Railway sits behind a proxy

app.use(helmet());

// Parse JSON and capture raw body for signature verification
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const webhookLimiter = rateLimit({
  windowMs: 60_000,      // 1 minute
  max: 120,              // generous for concurrent calls
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

app.use('/vapi', webhookLimiter);
app.use('/hcp', webhookLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Calexo HVAC Voice Agent',
    company: config.company.name,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

app.use('/vapi', vapiRoutes);
app.use('/hcp', hcpRoutes);

// ---------------------------------------------------------------------------
// 404 + global error handler
// ---------------------------------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[App] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(config.port, () => {
  console.log(`[App] Calexo HVAC Voice Agent running on port ${config.port}`);
  console.log(`[App] Environment: ${config.nodeEnv}`);
  console.log(`[App] Server URL:   ${config.serverUrl}`);
  console.log(`[App] Vapi webhook: ${config.serverUrl}/vapi/webhook`);
  console.log(`[App] HCP webhook:  ${config.serverUrl}/hcp/webhook`);
});

module.exports = app;
