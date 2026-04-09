'use strict';

/**
 * HouseCall Pro webhook router
 *
 * HCP POSTs job lifecycle events here.  We parse the event and fire an
 * SMS update to the customer via Twilio.
 *
 * Configure the webhook URL in the HCP Settings → Integrations panel:
 *   https://<your-domain>/hcp/webhook
 *
 * Supported event types (HCP uses both formats depending on API version):
 *   job.dispatched / job_dispatched
 *   job.on_my_way  / pro_on_the_way
 *   job.started    / job_started
 *   job.completed  / job_completed
 *   job.cancelled  / job_cancelled
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const sms = require('../sms');

const router = express.Router();

// ---------------------------------------------------------------------------
// Optional HMAC verification (HCP uses x-hcp-signature or x-hub-signature-256)
// ---------------------------------------------------------------------------
function isValidHcpSignature(req) {
  if (!config.housecall.webhookSecret) return true;

  const sigHeader =
    req.headers['x-hcp-signature'] || req.headers['x-hub-signature-256'];
  if (!sigHeader) {
    console.warn('[HCP Webhook] Missing signature header');
    return false;
  }

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', config.housecall.webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(sigHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /hcp/webhook
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  // Respond immediately – HCP retries on non-2xx within ~30 s
  res.json({ received: true });

  if (!isValidHcpSignature(req)) {
    console.warn('[HCP Webhook] Invalid signature – ignoring event');
    return;
  }

  const event = req.body;
  const eventType = event.event_type ?? event.type ?? '';
  const job = event.job ?? event;
  const jobId = job?.id ?? job?.job_number ?? 'unknown';

  console.log(`[HCP Webhook] Event: ${eventType}  job=${jobId}`);

  try {
    await processHcpEvent(eventType, job);
  } catch (err) {
    console.error('[HCP Webhook] Error processing event:', err.message);
  }
});

// ---------------------------------------------------------------------------
// processHcpEvent
// ---------------------------------------------------------------------------
async function processHcpEvent(eventType, job) {
  if (!job) return;

  const customer = job.customer ?? {};
  const phone =
    customer.mobile_number ??
    customer.home_number ??
    customer.work_number ??
    null;

  if (!phone) {
    console.log('[HCP Webhook] No phone on customer – skipping SMS');
    return;
  }

  const customerName = customer.first_name ?? 'Customer';
  const jobId = job.job_number ?? job.id ?? 'N/A';

  const EVENT_TO_STATUS = {
    // v1 style
    'job.dispatched': 'dispatched',
    'job.on_my_way': 'dispatched',
    'job.started': 'in_progress',
    'job.completed': 'completed',
    'job.cancelled': 'cancelled',
    // v2 style
    job_dispatched: 'dispatched',
    pro_on_the_way: 'dispatched',
    job_started: 'in_progress',
    job_completed: 'completed',
    job_cancelled: 'cancelled',
  };

  const status = EVENT_TO_STATUS[eventType];

  if (!status) {
    console.log(`[HCP Webhook] No SMS mapping for event type: ${eventType}`);
    return;
  }

  await sms.sendStatusUpdate({ to: phone, customerName, status, jobId });
}

module.exports = router;
