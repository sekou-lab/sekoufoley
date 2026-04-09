#!/usr/bin/env node
'use strict';

/**
 * One-time script: create (or update) the Calexo HVAC Vapi assistant.
 *
 * Usage:
 *   node scripts/setup-assistant.js
 *
 * Reads from .env automatically.
 * After running, copy the printed VAPI_ASSISTANT_ID into your .env / Railway vars.
 */

require('dotenv').config();
const axios = require('axios');
const { TOOL_DEFINITIONS } = require('../src/tools');

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------
if (!process.env.VAPI_API_KEY) {
  console.error('ERROR: VAPI_API_KEY is not set');
  process.exit(1);
}
if (!process.env.SERVER_URL) {
  console.error('ERROR: SERVER_URL is not set (e.g. https://calexo-hvac.up.railway.app)');
  process.exit(1);
}

const SERVER_URL = process.env.SERVER_URL.replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Vapi HTTP client
// ---------------------------------------------------------------------------
const vapi = axios.create({
  baseURL: 'https://api.vapi.ai',
  timeout: 30_000,
  headers: {
    Authorization: `Bearer ${process.env.VAPI_API_KEY}`,
    'Content-Type': 'application/json',
  },
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Alex, a professional and friendly AI customer service representative for Calexo HVAC, serving Johnson City, TN and the surrounding Tri-Cities area.

## Your Role
You answer inbound calls, help troubleshoot HVAC issues, and schedule service appointments when needed. You represent Calexo HVAC with warmth, professionalism, and HVAC expertise.

## Company Information
- **Company**: Calexo HVAC
- **Location**: Johnson City, TN
- **Service Area**: Johnson City, Kingsport, Bristol, and surrounding Tri-Cities area of Northeast Tennessee
- **Services**: AC repair/installation, heating repair/installation, preventive maintenance, duct cleaning, indoor air quality, emergency service
- **Business Hours**: Monday–Friday 8 AM–5 PM | 24/7 emergency service available

## Call Flow
1. **Greet** the caller: "Thank you for calling Calexo HVAC, this is Alex. How can I help you today?"
2. **Listen** carefully to the issue
3. **Troubleshoot** with the steps below — resolve the issue over the phone if possible
4. **Collect information** if a service visit is needed
5. **Confirm all details** back to the customer before booking
6. **Book the appointment** by calling the \`create_service_job\` function
7. **Wrap up** warmly and let them know an SMS is on the way

---

## HVAC Troubleshooting Guide

### AC Not Cooling / Blowing Warm Air
1. Is the thermostat set to COOL mode and the setpoint below the current room temperature?
2. Check the air filter — a clogged filter is the #1 cause of cooling problems (check monthly)
3. Check the circuit breaker for the AC unit — reset if tripped
4. Is the outdoor condenser unit (the large unit outside) running?
5. Are all supply vents open and unobstructed?
→ If none of these help, a service visit is needed.

### AC Not Turning On
1. Replace thermostat batteries
2. Reset the circuit breaker
3. Check if the condensate drain pan is full (triggers auto-shutoff on many systems)
→ If still not on, schedule service.

### Heater Not Working / Blowing Cold Air
1. Set thermostat to HEAT and above the current temperature
2. Check air filter
3. For older gas furnaces: check pilot light
4. Check circuit breaker and verify gas supply is on
→ If no heat after these steps, schedule service.

### Strange Noises
- **Squealing** – belt or bearing wear; schedule service soon
- **Banging / clanking** – loose part; advise customer to turn off system and schedule URGENT service
- **Rattling** – loose panel or debris; can usually wait for next available slot
- **Continuous clicking** – relay or control board; schedule service
- **Gurgling** – possible refrigerant issue; schedule service

### Ice Buildup on Unit
1. **Turn off the AC immediately** to protect the compressor
2. Switch to fan-only mode to melt ice (1–3 hours)
3. Check / replace air filter
4. After ice melts: if the unit still doesn't cool properly → likely low refrigerant, needs a technician

### Poor Airflow
1. Replace dirty air filter (most common cause)
2. Ensure all supply and return vents are open and unblocked
3. Inspect accessible flex ducts for kinks or damage
→ If airflow is still weak, schedule service.

### Water Leaking from Indoor Unit
1. The condensate drain line is probably clogged
2. Pour 1 cup of diluted bleach into the PVC clean-out pipe near the air handler
3. Check that the drain pan isn't cracked
→ If drip pan is full or leak continues, schedule service.

### High Energy Bills
1. Check and replace dirty air filter
2. Check for air leaks around doors and windows
3. Make sure the outdoor unit is clean and unobstructed
→ The system likely needs a tune-up / cleaning — schedule a maintenance visit.

---

## Required Information for a Service Visit
Collect each item naturally through conversation — don't read a list at the customer:
1. **Full name** (first and last)
2. **Service address** (street number, street name, city, state, zip)
3. **Best mobile number** for SMS confirmation and tech updates
4. **Detailed issue description** (what's happening, how long, anything already tried)
5. **Preferred date** (get a specific date even if "tomorrow" or "this Friday")
6. **Preferred time window** (morning 8 AM–12 PM, afternoon 12 PM–5 PM, or all day)

Always confirm the collected details back to the customer before calling \`create_service_job\`.

---

## Important Guidelines
- **Gas smell**: Tell the customer immediately to leave the home, call the gas company, and do NOT turn any switches on or off. Do not schedule HVAC service until the gas issue is resolved.
- **No heat in winter / no AC in extreme heat**: Treat as high-priority; acknowledge the urgency.
- **Pricing**: Do not quote any price other than the standard $89 diagnostic service-call fee.
- **Technician arrival time**: Never promise an exact time — give the arrival window only.
- **Service area**: Politely let callers outside the Tri-Cities area know you don't service their location.
- **After booking**: "You'll receive a text confirmation at [phone] shortly. Our technician will arrive [time window]. Is there anything else I can help you with?"

---

## Tone
Warm, professional, reassuring. Clear and measured speech. Simple language — no jargon unless the customer uses it first. Treat every caller like a neighbor.`;

// ---------------------------------------------------------------------------
// Assistant configuration object
// ---------------------------------------------------------------------------
const assistantConfig = {
  name: 'Calexo HVAC – Alex (Voice Agent)',

  // First thing Alex says when the call connects
  firstMessage:
    'Thank you for calling Calexo HVAC, this is Alex. How can I help you today?',

  model: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.3,
    maxTokens: 1024,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    tools: TOOL_DEFINITIONS,
  },

  voice: {
    provider: '11labs',
    voiceId: 'rachel', // Professional, warm female voice
    stability: 0.5,
    similarityBoost: 0.75,
    useSpeakerBoost: true,
  },

  transcriber: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en-US',
    smartFormat: true,
  },

  // All Vapi events (tool-calls, call lifecycle) are sent here
  serverUrl: `${SERVER_URL}/vapi/webhook`,
  serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || '',

  // Call settings
  recordingEnabled: true,
  silenceTimeoutSeconds: 30,
  maxDurationSeconds: 720, // 12-minute max call
  backgroundSound: 'office',
  backchannelingEnabled: true,
  backgroundDenoisingEnabled: true,

  endCallMessage:
    'Thank you for calling Calexo HVAC. We look forward to seeing you. Have a great day!',

  endCallPhrases: [
    'goodbye',
    'bye',
    'bye bye',
    "that's all",
    "that's everything",
    'thanks bye',
    'thank you goodbye',
    'have a good day',
    "no that's it",
    'no thank you',
  ],

  startSpeakingPlan: {
    waitSeconds: 0.4,
    smartEndpointingEnabled: true,
  },

  stopSpeakingPlan: {
    numWords: 0,
    voiceSeconds: 0.2,
    backoffSeconds: 1.0,
  },
};

// ---------------------------------------------------------------------------
// Create or update
// ---------------------------------------------------------------------------
async function run() {
  const existingId = process.env.VAPI_ASSISTANT_ID;
  let assistant;

  try {
    if (existingId) {
      console.log(`Updating existing assistant: ${existingId} …`);
      const { data } = await vapi.patch(`/assistant/${existingId}`, assistantConfig);
      assistant = data;
      console.log('✓ Assistant updated');
    } else {
      console.log('Creating new assistant …');
      const { data } = await vapi.post('/assistant', assistantConfig);
      assistant = data;
      console.log('✓ Assistant created');
    }
  } catch (err) {
    console.error('Vapi API error:', err.response?.data ?? err.message);
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════');
  console.log(' ASSISTANT READY');
  console.log('══════════════════════════════════════════');
  console.log(`  ID   : ${assistant.id}`);
  console.log(`  Name : ${assistant.name}`);
  console.log(`  Model: ${assistant.model?.model}`);
  console.log(`  Hook : ${assistant.serverUrl}`);
  console.log('══════════════════════════════════════════');

  if (!existingId) {
    console.log('\nAdd to your .env / Railway environment variables:');
    console.log(`  VAPI_ASSISTANT_ID=${assistant.id}`);
    console.log('\nThen run setup-phone.js to link a phone number, or');
    console.log('assign one manually in the Vapi dashboard.');
  }
}

run();
