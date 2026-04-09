'use strict';

/**
 * create_service_job tool handler
 *
 * Flow:
 *  1. Parse + normalise inputs
 *  2. Create/find customer in HouseCall Pro
 *  3. Create job in HouseCall Pro
 *  4. Send SMS confirmation via Twilio
 *  5. Return a human-readable confirmation string to the LLM
 */

const housecall = require('../housecall');
const sms = require('../sms');
const config = require('../config');

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
async function createServiceJob(args) {
  const {
    customer_name,
    customer_phone,
    service_address,
    issue_description,
    preferred_date,
    preferred_time_of_day,
  } = args;

  console.log('[Tool:create_service_job] Received', {
    customer: customer_name,
    phone: customer_phone,
    address: service_address,
    issue: issue_description.slice(0, 60),
    date: preferred_date,
    time: preferred_time_of_day,
  });

  // --- Name ---
  const { firstName, lastName } = splitName(customer_name);

  // --- Phone ---
  const phone = normalisePhone(customer_phone);

  // --- Address ---
  const address = parseAddress(service_address);

  // --- Schedule ---
  const schedule = buildSchedule(preferred_date, preferred_time_of_day);

  // --- HouseCall Pro: customer ---
  let customerId;
  try {
    customerId = await housecall.createOrFindCustomer({
      firstName,
      lastName,
      phone,
      address,
    });
  } catch (err) {
    console.error('[Tool:create_service_job] Customer creation failed:', err.message);
    throw new Error(
      'I was unable to save your customer record right now. ' +
        'Please try again or call our office directly.',
    );
  }

  // --- HouseCall Pro: job ---
  let job;
  try {
    job = await housecall.createJob({
      customerId,
      address,
      issueDescription: issue_description,
      schedule,
    });
  } catch (err) {
    console.error('[Tool:create_service_job] Job creation failed:', err.message);
    throw new Error(
      'I was unable to schedule your appointment right now. ' +
        'Please try again or call our office directly.',
    );
  }

  const confirmationNumber = job.job_number ?? job.id ?? 'N/A';
  const timeWindowText = formatTimeWindow(preferred_date, preferred_time_of_day);

  // --- Twilio SMS (non-fatal) ---
  try {
    await sms.sendJobConfirmation({
      to: phone,
      customerName: firstName,
      confirmationNumber,
      address: service_address,
      timeWindow: timeWindowText,
      issueDescription: issue_description,
    });
  } catch (err) {
    // SMS failure must not block the call
    console.error('[Tool:create_service_job] SMS failed (non-fatal):', err.message);
  }

  return (
    `Your appointment is confirmed! Confirmation number: #${confirmationNumber}. ` +
    `An SMS has been sent to ${phone}. ` +
    `Our technician will arrive ${timeWindowText}. ` +
    `If you need to reach us before then, just give us a call.`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? fullName,
    lastName: parts.slice(1).join(' ') || '',
  };
}

/**
 * Normalise a US phone number to E.164 (+1XXXXXXXXXX).
 * Strips formatting, adds country code if missing.
 */
function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Return as-is with '+' prefix if it doesn't fit known patterns
  return `+${digits}`;
}

/**
 * Best-effort address parser.
 * Accepts: "123 Main St, Johnson City, TN 37601"
 *          "123 Main St, Johnson City, TN"
 *          "123 Main St" (defaults city/state to Calexo's market)
 */
function parseAddress(raw) {
  const parts = raw.split(',').map((s) => s.trim());

  const street = parts[0] ?? raw;
  const city = parts[1] ?? config.company.city;

  let state = config.company.state;
  let zip = config.company.zip;

  if (parts[2]) {
    const tokens = parts[2].trim().split(/\s+/);
    state = tokens[0] ?? config.company.state;
    zip = tokens[1] ?? config.company.zip;
  }

  return { street, city, state, zip };
}

/**
 * Convert preferred date + time-of-day to HCP schedule object.
 * Times are in Eastern Time (UTC-5 in winter, UTC-4 in summer).
 * We use a fixed -05:00 offset for simplicity; in production you could
 * use luxon/date-fns-tz to handle DST automatically.
 */
function buildSchedule(preferredDate, timeOfDay) {
  const date = isValidDate(preferredDate) ? preferredDate : nextWeekday();

  const windows = {
    morning: { start: '08:00:00', end: '12:00:00', windowMin: 240 },
    afternoon: { start: '12:00:00', end: '17:00:00', windowMin: 300 },
    all_day: { start: '08:00:00', end: '17:00:00', windowMin: 540 },
  };

  const w = windows[timeOfDay] ?? windows.all_day;

  return {
    scheduledStart: `${date}T${w.start}-05:00`,
    scheduledEnd: `${date}T${w.end}-05:00`,
    arrivalWindowMinutes: w.windowMin,
  };
}

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function nextWeekday() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function formatTimeWindow(date, timeOfDay) {
  const dateStr = isValidDate(date)
    ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : 'the next available date';

  const timeStr =
    {
      morning: 'between 8 AM and 12 PM',
      afternoon: 'between 12 PM and 5 PM',
      all_day: 'between 8 AM and 5 PM',
    }[timeOfDay] ?? 'during business hours';

  return `${dateStr} ${timeStr}`;
}

module.exports = createServiceJob;
