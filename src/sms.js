'use strict';

/**
 * Twilio SMS helper
 * Handles job confirmations and job-status update messages.
 */

const twilio = require('twilio');
const config = require('./config');

let _client;
function getClient() {
  if (!_client) {
    _client = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return _client;
}

// ---------------------------------------------------------------------------
// sendJobConfirmation
//   Fires immediately after a job is created.
// ---------------------------------------------------------------------------
async function sendJobConfirmation({
  to,
  customerName,
  confirmationNumber,
  address,
  timeWindow,
  issueDescription,
}) {
  const preview =
    issueDescription.length > 60
      ? issueDescription.substring(0, 57) + '…'
      : issueDescription;

  const body =
    `Hi ${customerName}! Your Calexo HVAC appointment is confirmed.\n\n` +
    `Confirmation: #${confirmationNumber}\n` +
    `Address: ${address}\n` +
    `Issue: ${preview}\n` +
    `Scheduled: ${timeWindow}\n\n` +
    `Questions? Reply to this text or call us back.\n` +
    `— Calexo HVAC, Johnson City TN`;

  const msg = await getClient().messages.create({
    body,
    from: config.twilio.fromNumber,
    to,
  });

  console.log(`[SMS] Confirmation sent → ${to}  SID: ${msg.sid}`);
  return msg.sid;
}

// ---------------------------------------------------------------------------
// sendStatusUpdate
//   Fired by the HCP webhook handler when a job changes status.
// ---------------------------------------------------------------------------
async function sendStatusUpdate({ to, customerName, status, jobId }) {
  const templates = {
    dispatched:
      `Hi ${customerName}, your Calexo HVAC technician is on the way! ` +
      `Job #${jobId}. — Calexo HVAC`,
    in_progress:
      `Hi ${customerName}, your Calexo HVAC technician has arrived and is working on your system. ` +
      `Job #${jobId}. — Calexo HVAC`,
    completed:
      `Hi ${customerName}, your Calexo HVAC service is complete! ` +
      `Job #${jobId}. Thank you for choosing Calexo HVAC! — Calexo HVAC`,
    cancelled:
      `Hi ${customerName}, your Calexo HVAC appointment (Job #${jobId}) has been cancelled. ` +
      `Please call us to reschedule. — Calexo HVAC`,
  };

  const body =
    templates[status] ??
    `Hi ${customerName}, update on your Calexo HVAC job #${jobId}: ${status}. — Calexo HVAC`;

  const msg = await getClient().messages.create({
    body,
    from: config.twilio.fromNumber,
    to,
  });

  console.log(`[SMS] Status update (${status}) → ${to}  SID: ${msg.sid}`);
  return msg.sid;
}

module.exports = { sendJobConfirmation, sendStatusUpdate };
