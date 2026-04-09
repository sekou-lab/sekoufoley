'use strict';
require('dotenv').config();

// ---------------------------------------------------------------------------
// Validate required environment variables at startup
// ---------------------------------------------------------------------------
const REQUIRED_VARS = [
  'VAPI_API_KEY',
  'HCP_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
];

const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[Config] FATAL – missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

if (!process.env.SERVER_URL && process.env.NODE_ENV === 'production') {
  console.error('[Config] FATAL – SERVER_URL is required in production');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exported config object
// ---------------------------------------------------------------------------
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // The public HTTPS base URL of this service (set by Railway at deploy time)
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',

  vapi: {
    apiKey: process.env.VAPI_API_KEY,
    webhookSecret: process.env.VAPI_WEBHOOK_SECRET || '',
    assistantId: process.env.VAPI_ASSISTANT_ID || '',
    phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '',
  },

  housecall: {
    apiKey: process.env.HCP_API_KEY,
    baseUrl: 'https://api.housecallpro.com',
    webhookSecret: process.env.HCP_WEBHOOK_SECRET || '',
    // Service-call diagnostic fee in cents (default $89.00)
    serviceCallPriceCents: parseInt(process.env.HCP_SERVICE_CALL_PRICE_CENTS || '8900', 10),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  },

  company: {
    name: 'Calexo HVAC',
    city: 'Johnson City',
    state: 'TN',
    zip: '37601',
    serviceArea: 'Johnson City, Kingsport, Bristol, and surrounding Tri-Cities area',
    phone: process.env.COMPANY_PHONE || '',
    timezone: 'America/New_York',
  },
};

module.exports = config;
