'use strict';

/**
 * HouseCall Pro API client
 *
 * Docs: https://developer.housecallpro.com/
 * Auth: Authorization: Token token=<API_KEY>
 */

const axios = require('axios');
const config = require('./config');

const hcp = axios.create({
  baseURL: config.housecall.baseUrl,
  timeout: 20_000,
  headers: {
    Authorization: `Token token=${config.housecall.apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Request / response logging (non-production only)
hcp.interceptors.request.use((req) => {
  if (config.nodeEnv !== 'production') {
    console.log(`[HCP] → ${req.method.toUpperCase()} ${req.url}`);
  }
  return req;
});

hcp.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error(`[HCP] Error ${status}:`, JSON.stringify(data ?? err.message));
    return Promise.reject(err);
  },
);

// ---------------------------------------------------------------------------
// createOrFindCustomer
//   Searches for an existing customer by mobile number; creates one if absent.
//   Returns the HCP customer ID string.
// ---------------------------------------------------------------------------
async function createOrFindCustomer({ firstName, lastName, phone, address }) {
  // 1) Try to find by mobile number
  try {
    const { data } = await hcp.get('/api/v1/customers', {
      params: { mobile_number: phone, page: 1, page_size: 1 },
    });
    const list = data?.customers ?? data;
    if (Array.isArray(list) && list.length > 0) {
      console.log('[HCP] Found existing customer:', list[0].id);
      return list[0].id;
    }
  } catch (err) {
    // Search failure is non-fatal; fall through to create
    console.warn('[HCP] Customer search failed, creating new:', err.message);
  }

  // 2) Create new customer
  const payload = {
    customer: {
      first_name: firstName,
      last_name: lastName,
      mobile_number: phone,
      notifications_enabled: true,
      address: {
        street: address.street,
        street_line_2: address.street2 || '',
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: 'US',
      },
      tags: [{ name: 'voice-agent-lead' }],
    },
  };

  const { data } = await hcp.post('/api/v1/customers', payload);
  const customer = data?.customer ?? data;
  console.log('[HCP] Created customer:', customer.id);
  return customer.id;
}

// ---------------------------------------------------------------------------
// createJob
//   Creates a new job in HouseCall Pro and returns the full job object.
// ---------------------------------------------------------------------------
async function createJob({ customerId, address, issueDescription, schedule }) {
  const payload = {
    job: {
      customer_id: customerId,
      address: {
        street: address.street,
        street_line_2: address.street2 || '',
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: 'US',
      },
      schedule: {
        scheduled_start: schedule.scheduledStart,
        scheduled_end: schedule.scheduledEnd,
        arrival_window_minutes: schedule.arrivalWindowMinutes,
      },
      line_items: [
        {
          name: 'HVAC Service Call',
          description: issueDescription,
          unit_price: config.housecall.serviceCallPriceCents,
          quantity: 1,
          unit_cost: 0,
          taxable: false,
        },
      ],
      notes: `Customer reported: ${issueDescription}\n\nBooked via Calexo AI Voice Agent`,
      lead_source: 'Phone',
      tags: [{ name: 'voice-agent' }],
    },
  };

  const { data } = await hcp.post('/api/v1/jobs', payload);
  const job = data?.job ?? data;
  console.log('[HCP] Created job:', job.id);
  return job;
}

// ---------------------------------------------------------------------------
// getJob
// ---------------------------------------------------------------------------
async function getJob(jobId) {
  const { data } = await hcp.get(`/api/v1/jobs/${jobId}`);
  return data?.job ?? data;
}

module.exports = { createOrFindCustomer, createJob, getJob };
