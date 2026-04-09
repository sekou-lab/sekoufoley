#!/usr/bin/env node
'use strict';

/**
 * demo.js — Terminal simulation of a full Calexo HVAC inbound call
 *
 * What this does:
 *   • Plays through a scripted HVAC customer conversation in the terminal
 *   • Uses the real Claude API (claude-opus-4-6) to generate Alex's responses
 *   • Intercepts the create_service_job tool call — no real HCP or Twilio calls
 *   • Prints the HCP job object and Twilio SMS body that would be created
 *
 * Usage:
 *   node scripts/demo.js
 *
 * Requires ANTHROPIC_API_KEY in .env or the environment.
 * HCP_API_KEY / Twilio credentials are NOT needed.
 */

require('dotenv').config();
const axios = require('axios');

// ─── Guard ─────────────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    '\n  ERROR: ANTHROPIC_API_KEY is not set.\n' +
    '  Add it to .env or prefix the command:\n\n' +
    '    ANTHROPIC_API_KEY=sk-ant-... node scripts/demo.js\n',
  );
  process.exit(1);
}

// ─── ANSI helpers ──────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
};

const clr  = (c, s) => `${c}${s}${C.reset}`;
const bold = (s) => clr(C.bold, s);
const dim  = (s) => clr(C.dim, s);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Word-wrap text to `width` columns, preserving existing newlines. */
function wrap(text, width = 68) {
  const out = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const w of words) {
      if (line.length + w.length + 1 > width) {
        out.push(line);
        line = w;
      } else {
        line = line ? `${line} ${w}` : w;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Stream text word-by-word, simulating TTS output lag. */
async function streamWords(text, { color = C.green, indentStr = '  ', msPerWord = 28 } = {}) {
  const wrapped = wrap(text, 68);
  const lines = wrapped.split('\n');
  for (let li = 0; li < lines.length; li++) {
    process.stdout.write(li === 0 ? indentStr : indentStr);
    const words = lines[li].split(' ');
    for (let wi = 0; wi < words.length; wi++) {
      process.stdout.write(clr(color, words[wi]));
      if (wi < words.length - 1) process.stdout.write(' ');
      await sleep(msPerWord);
    }
    process.stdout.write('\n');
  }
}

// ─── Pre-scripted caller utterances ───────────────────────────────────────────
// The "customer" side is scripted so the demo is deterministic and reproducible.
// Alex's responses are generated live by Claude each run.
const CALLER_SCRIPT = [
  // Turn 1 – initial complaint
  "Hi, my central AC stopped cooling. It's been running all morning but just blowing warm air. " +
  "It's 96 degrees outside right now.",

  // Turn 2 – already tried the basics
  "I already checked the thermostat — it's set to cool at 72 but the house is 86. " +
  "I put in a brand-new filter last week and the circuit breaker isn't tripped.",

  // Turn 3 – answers question about outdoor unit
  "I just walked outside to look. The outdoor condenser fan is NOT spinning at all. " +
  "The unit is humming but the fan blade isn't moving.",

  // Turn 4 – provides customer info
  "Sure. My name is Sarah Johnson. Address is 412 Maple Drive, Johnson City, TN 37601. " +
  "Best number is 423-555-0178.",

  // Turn 5 – preferred appointment time
  "Tomorrow morning would be perfect if you have anything available.",

  // Turn 6 – sign-off
  "No, that's everything. Thank you so much.",
];

// ─── System prompt (condensed version of the Vapi assistant prompt) ────────────
const SYSTEM_PROMPT = `You are Alex, a professional and friendly AI customer service rep for Calexo HVAC in Johnson City, TN.

## Role
Answer inbound calls, troubleshoot HVAC issues, and schedule service visits. Be warm, efficient, and concise — this is a phone call.

## Troubleshooting — AC blowing warm air / outdoor unit not running
A non-spinning outdoor fan with a humming compressor is a classic failed run capacitor or locked-out compressor. This requires a technician; do not attempt further self-diagnosis after this is confirmed. Proceed directly to scheduling.

## Scheduling flow
Once the issue is confirmed and needs a tech, collect:
  1. Full name (first + last)
  2. Full service address (street, city, state, zip)
  3. Mobile number for SMS confirmation
  4. Detailed issue description (include what troubleshooting was done)
  5. Preferred date (convert "tomorrow" / weekday names to YYYY-MM-DD)
  6. Preferred time of day: morning (8 AM–12 PM), afternoon (12 PM–5 PM), or all_day

Confirm all six fields back to the customer, then call create_service_job immediately. Do not ask for anything you already have.

## After tool call
Tell the customer their confirmation number, that an SMS is on its way, and the arrival window. Then wrap up warmly.`;

// ─── Tool definition (Anthropic messages API format) ───────────────────────────
const TOOLS = [
  {
    name: 'create_service_job',
    description:
      'Creates a service appointment and sends an SMS confirmation. ' +
      'Call ONLY once all six required fields are confirmed with the customer.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name:         { type: 'string',  description: 'Full name (first and last).' },
        customer_phone:        { type: 'string',  description: 'Mobile number in E.164 format, e.g. +14235550178.' },
        service_address:       { type: 'string',  description: 'Full address including street, city, state, zip.' },
        issue_description:     { type: 'string',  description: 'Detailed description of the HVAC problem and troubleshooting done.' },
        preferred_date:        { type: 'string',  description: 'Preferred service date in YYYY-MM-DD.' },
        preferred_time_of_day: { type: 'string',  enum: ['morning', 'afternoon', 'all_day'],
                                 description: 'morning=8AM-12PM, afternoon=12PM-5PM, all_day=8AM-5PM.' },
      },
      required: ['customer_name','customer_phone','service_address',
                 'issue_description','preferred_date','preferred_time_of_day'],
    },
  },
];

// ─── Claude API wrapper ────────────────────────────────────────────────────────
async function callClaude(messages) {
  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-opus-4-6', max_tokens: 512, system: SYSTEM_PROMPT, messages, tools: TOOLS },
    {
      headers: {
        'x-api-key':        process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 40_000,
    },
  );
  return data;
}

// ─── Mock HCP job builder ──────────────────────────────────────────────────────
function nextWeekday() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function mockHcpJob(args) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(args.preferred_date)
    ? args.preferred_date : nextWeekday();
  const windows = {
    morning:   { start: '08:00', end: '12:00', arrivalMin: 240 },
    afternoon: { start: '12:00', end: '17:00', arrivalMin: 300 },
    all_day:   { start: '08:00', end: '17:00', arrivalMin: 540 },
  };
  const w = windows[args.preferred_time_of_day] ?? windows.all_day;
  const jobNum  = `JOB-${Math.floor(Math.random() * 90000 + 10000)}`;
  const jobId   = `hcp_demo_${date.replace(/-/g,'')}${Math.floor(Math.random()*900+100)}`;
  const custId  = `cust_demo_${Math.floor(Math.random()*9000+1000)}`;
  const [fn, ...lnParts] = (args.customer_name || 'Customer').split(' ');

  return {
    id: jobId,
    job_number: jobNum,
    status: 'scheduled',
    created_at: new Date().toISOString(),
    customer: {
      id: custId,
      first_name: fn,
      last_name:  lnParts.join(' '),
      mobile_number: args.customer_phone,
    },
    address: {
      full_address: args.service_address,
    },
    schedule: {
      scheduled_start:       `${date}T${w.start}:00-05:00`,
      scheduled_end:         `${date}T${w.end}:00-05:00`,
      arrival_window_minutes: w.arrivalMin,
    },
    line_items: [{
      name:        'HVAC Service Call',
      description: args.issue_description,
      unit_price:  8900,
      quantity:    1,
    }],
    notes:       `Customer reported: ${args.issue_description}\n\nBooked via Calexo AI Voice Agent (demo)`,
    lead_source: 'Phone',
    tags:        ['voice-agent', 'demo'],
  };
}

// ─── Mock Twilio SMS body ──────────────────────────────────────────────────────
function mockSmsBody(args, job) {
  const [fn] = (args.customer_name || '').split(' ');
  const d = args.preferred_date;
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : 'the next available date';
  const timeLabel = { morning: '8 AM – 12 PM', afternoon: '12 PM – 5 PM', all_day: '8 AM – 5 PM' }
    [args.preferred_time_of_day] ?? 'business hours';
  const preview = args.issue_description.length > 60
    ? args.issue_description.slice(0, 57) + '…'
    : args.issue_description;

  return [
    `Hi ${fn}! Your Calexo HVAC appointment is confirmed.`,
    ``,
    `Confirmation: #${job.job_number}`,
    `Address: ${args.service_address}`,
    `Issue: ${preview}`,
    `Scheduled: ${dateLabel}, ${timeLabel}`,
    ``,
    `Questions? Reply to this text or call us back.`,
    `— Calexo HVAC, Johnson City TN`,
  ].join('\n');
}

// ─── Terminal print helpers ────────────────────────────────────────────────────
const W   = 66;
const SEP = clr(C.gray, '─'.repeat(W));

function printBanner() {
  const bar = '═'.repeat(W);
  console.log();
  console.log(clr(C.cyan,  `╔${bar}╗`));
  console.log(clr(C.cyan,  `║`) +
              bold('       CALEXO HVAC  ·  AI VOICE AGENT  ·  DEMO MODE'.padEnd(W)) +
              clr(C.cyan,  `║`));
  console.log(clr(C.cyan,  `║`) +
              dim( '       Simulated Inbound Call  ·  Johnson City, TN'.padEnd(W)) +
              clr(C.cyan,  `║`));
  console.log(clr(C.cyan,  `╚${bar}╝`));
  console.log();
  console.log(dim(`  Stack : Claude claude-opus-4-6 (live) · Vapi · HouseCall Pro · Twilio`));
  console.log(dim(`  Demo  : HouseCall Pro and Twilio are MOCKED — no real data created`));
  console.log();
}

function printCallerTurn(text) {
  console.log(SEP);
  console.log();
  console.log(clr(C.yellow, bold('  📞 CALLER')));
  const lines = wrap(text, 66).split('\n');
  for (const ln of lines) console.log(`  ${ln}`);
  console.log();
}

async function printAlexTurn(text) {
  process.stdout.write(clr(C.green, bold('  🤖 ALEX  ')) + dim('(Calexo HVAC)\n'));
  await streamWords(text, { color: C.green, indentStr: '  ', msPerWord: 25 });
  console.log();
}

function printToolCallBlock(name, args) {
  console.log();
  const bar = '─'.repeat(W - 2);
  console.log(clr(C.magenta, `  ┌${bar}┐`));
  console.log(clr(C.magenta, `  │`) + bold(` ⚙️  TOOL CALL  →  ${name}`.padEnd(W - 1)) + clr(C.magenta, `│`));
  console.log(clr(C.magenta, `  └${bar}┘`));
  const jsonLines = JSON.stringify(args, null, 2).split('\n');
  for (const ln of jsonLines) {
    console.log(clr(C.gray, `  ${ln}`));
  }
  console.log();
}

function printHcpBlock(job) {
  const bar  = '─'.repeat(W - 2);
  const rows = JSON.stringify(job, null, 2).split('\n');
  console.log(clr(C.blue, `  ┌${bar}┐`));
  console.log(clr(C.blue, `  │`) + bold(` ✅  MOCK HouseCall Pro  —  Job Created`.padEnd(W - 1)) + clr(C.blue, `│`));
  console.log(clr(C.blue, `  ├${bar}┤`));
  for (const row of rows) {
    const padded = ` ${row}`.padEnd(W - 1);
    console.log(clr(C.blue, `  │`) + clr(C.gray, padded) + clr(C.blue, `│`));
  }
  console.log(clr(C.blue, `  └${bar}┘`));
  console.log();
}

function printSmsBlock(to, body) {
  const bar  = '─'.repeat(W - 2);
  const rows = body.split('\n');
  console.log(clr(C.cyan, `  ┌${bar}┐`));
  console.log(clr(C.cyan, `  │`) + bold(` 📱  MOCK Twilio SMS  →  ${to}`.padEnd(W - 1)) + clr(C.cyan, `│`));
  console.log(clr(C.cyan, `  ├${bar}┤`));
  for (const row of rows) {
    const padded = ` ${row}`.padEnd(W - 1);
    console.log(clr(C.cyan, `  │`) + padded + clr(C.cyan, `│`));
  }
  console.log(clr(C.cyan, `  └${bar}┘`));
  console.log();
}

function printSummary(durationMs, jobBooked) {
  console.log(SEP);
  console.log();
  const secs = (durationMs / 1000).toFixed(1);
  console.log(clr(C.gray,  `  📴 Call ended  ·  Simulated duration: ${secs}s`));
  console.log();
  if (jobBooked) {
    console.log(clr(C.green, bold('  ✓ Demo complete — 1 job booked, 1 SMS confirmation sent')));
  } else {
    console.log(clr(C.yellow, bold('  ✓ Demo complete — no booking made during this call')));
  }
  console.log();
  console.log(dim('  In production:'));
  console.log(dim('    Vapi handles the voice layer (STT → LLM → TTS)'));
  console.log(dim('    Claude powers every response and tool decision'));
  console.log(dim('    HouseCall Pro stores the customer + job record'));
  console.log(dim('    Twilio delivers the SMS confirmation + status updates'));
  console.log();
}

// ─── Main conversation loop ────────────────────────────────────────────────────
async function main() {
  printBanner();
  await sleep(300);

  console.log(clr(C.yellow, '  📞 Incoming call...'));
  await sleep(1000);
  const now = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  console.log(clr(C.green, `  ☎️  Call connected at ${now}`));
  console.log();
  await sleep(500);

  const messages = [];
  const startMs = Date.now();
  let jobBooked = false;

  for (const callerText of CALLER_SCRIPT) {
    // ── Caller speaks ───────────────────────────────────────────────────────
    printCallerTurn(callerText);
    await sleep(400);

    messages.push({ role: 'user', content: callerText });

    // ── Claude generates Alex's response ───────────────────────────────────
    let response;
    try {
      response = await callClaude(messages);
    } catch (err) {
      const msg = err.response?.data?.error?.message ?? err.message;
      console.error(clr(C.magenta, `\n  Claude API error: ${msg}\n`));
      process.exit(1);
    }

    const textBlocks = response.content.filter((b) => b.type === 'text');
    const toolBlocks = response.content.filter((b) => b.type === 'tool_use');
    const alexText   = textBlocks.map((b) => b.text).join(' ').trim();

    // Print any spoken text first
    if (alexText) await printAlexTurn(alexText);

    // Add assistant message to history (preserves full content incl. tool_use)
    messages.push({ role: 'assistant', content: response.content });

    // ── Handle tool calls ───────────────────────────────────────────────────
    for (const tc of toolBlocks) {
      if (tc.name !== 'create_service_job') continue;

      const args = tc.input;
      printToolCallBlock(tc.name, args);
      await sleep(600);

      // Mock HCP
      const job = mockHcpJob(args);
      printHcpBlock(job);
      await sleep(300);

      // Mock Twilio SMS
      const smsBody = mockSmsBody(args, job);
      printSmsBlock(args.customer_phone, smsBody);
      await sleep(300);

      jobBooked = true;

      // Feed tool result back so Claude can close the call
      const toolResult =
        `Job created successfully. Confirmation number: #${job.job_number}. ` +
        `SMS confirmation sent to ${args.customer_phone}.`;

      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tc.id, content: toolResult }],
      });

      // Get Alex's closing line (the confirmation read-back to the customer)
      let closeResp;
      try {
        closeResp = await callClaude(messages);
      } catch (err) {
        console.error(clr(C.magenta, `\n  Claude API error (closing): ${err.message}\n`));
        break;
      }

      const closeText = closeResp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();

      if (closeText) await printAlexTurn(closeText);
      messages.push({ role: 'assistant', content: closeResp.content });
    }
  }

  printSummary(Date.now() - startMs, jobBooked);
}

main().catch((err) => {
  console.error(clr(C.magenta, `\nFatal: ${err.message}\n`));
  process.exit(1);
});
