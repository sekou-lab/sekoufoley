#!/usr/bin/env node
'use strict';

/**
 * setup-phone.js
 *
 * Imports an existing Twilio number into Vapi and links it to the assistant,
 * OR lists your existing Vapi phone numbers so you can pick one.
 *
 * Usage:
 *   node scripts/setup-phone.js              # list existing Vapi numbers
 *   node scripts/setup-phone.js import       # import TWILIO_FROM_NUMBER into Vapi
 *   node scripts/setup-phone.js link <phoneId>  # link a Vapi number to the assistant
 *
 * Requires in .env:
 *   VAPI_API_KEY, VAPI_ASSISTANT_ID
 *   For import: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */

require('dotenv').config();
const axios = require('axios');

const vapi = axios.create({
  baseURL: 'https://api.vapi.ai',
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

const [, , command, arg] = process.argv;

async function listNumbers() {
  const { data } = await vapi.get('/phone-number');
  const numbers = Array.isArray(data) ? data : data?.results ?? [];
  if (numbers.length === 0) {
    console.log('No phone numbers found in your Vapi account.');
    return;
  }
  console.log('\nYour Vapi phone numbers:');
  numbers.forEach((n) => {
    console.log(`  ID: ${n.id}  Number: ${n.number}  Provider: ${n.provider}`);
  });
  console.log('\nTo link one to the assistant:');
  console.log('  node scripts/setup-phone.js link <phoneId>');
}

async function importFromTwilio() {
  const required = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'VAPI_ASSISTANT_ID',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  console.log(`Importing ${process.env.TWILIO_FROM_NUMBER} into Vapi…`);

  const { data } = await vapi.post('/phone-number', {
    provider: 'twilio',
    number: process.env.TWILIO_FROM_NUMBER,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    assistantId: process.env.VAPI_ASSISTANT_ID,
    name: 'Calexo HVAC Main Line',
  });

  console.log('✓ Phone number imported and linked!');
  console.log(`  Vapi Phone ID: ${data.id}`);
  console.log(`  Number: ${data.number}`);
  console.log(`\nAdd to .env: VAPI_PHONE_NUMBER_ID=${data.id}`);
}

async function linkNumber(phoneId) {
  if (!process.env.VAPI_ASSISTANT_ID) {
    console.error('VAPI_ASSISTANT_ID is not set');
    process.exit(1);
  }

  const { data } = await vapi.patch(`/phone-number/${phoneId}`, {
    assistantId: process.env.VAPI_ASSISTANT_ID,
  });

  console.log(`✓ Phone number ${data.number} linked to assistant ${data.assistantId}`);
}

async function run() {
  try {
    if (command === 'import') {
      await importFromTwilio();
    } else if (command === 'link' && arg) {
      await linkNumber(arg);
    } else {
      await listNumbers();
    }
  } catch (err) {
    console.error('Error:', err.response?.data ?? err.message);
    process.exit(1);
  }
}

run();
