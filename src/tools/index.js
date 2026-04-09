'use strict';

/**
 * Tool registry
 *
 * Each key maps a Vapi function name to its async handler.
 * Handlers receive (parsedArgs, vapiMessage) and return a string result
 * that is fed back to the LLM.
 */

const createServiceJob = require('./create-job');

const HANDLERS = {
  create_service_job: createServiceJob,
};

// ---------------------------------------------------------------------------
// handleToolCall – dispatches a single Vapi tool-call object
// ---------------------------------------------------------------------------
async function handleToolCall(toolCall, vapiMessage) {
  const name = toolCall.function?.name;
  let args = toolCall.function?.arguments ?? {};

  // Vapi sometimes serialises arguments as a JSON string
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      throw new Error(`Could not parse tool arguments for ${name}`);
    }
  }

  const handler = HANDLERS[name];
  if (!handler) {
    throw new Error(`Unknown tool: "${name}"`);
  }

  return handler(args, vapiMessage);
}

// ---------------------------------------------------------------------------
// TOOL_DEFINITIONS
//   Passed to the Vapi assistant's model.tools array during setup.
//   These match exactly what Claude sees as available function signatures.
// ---------------------------------------------------------------------------
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'create_service_job',
      description:
        'Creates a service appointment in HouseCall Pro and sends the customer an SMS confirmation. ' +
        'Call this ONLY after you have confirmed all six required fields with the customer. ' +
        'Do not guess any field — ask if unsure.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: 'Customer full name (first and last).',
          },
          customer_phone: {
            type: 'string',
            description:
              'Customer mobile number for SMS confirmation. ' +
              'Normalize to E.164 format, e.g. +14235551234.',
          },
          service_address: {
            type: 'string',
            description:
              'Full service address as a single string, e.g. ' +
              '"123 Oak Street, Johnson City, TN 37601".',
          },
          issue_description: {
            type: 'string',
            description:
              'Detailed description of the HVAC problem including any troubleshooting already attempted.',
          },
          preferred_date: {
            type: 'string',
            description:
              'Preferred service date in YYYY-MM-DD format. ' +
              'If the customer says "tomorrow" or a weekday name, convert it to an ISO date. ' +
              'Use the next weekday if no date is given.',
          },
          preferred_time_of_day: {
            type: 'string',
            enum: ['morning', 'afternoon', 'all_day'],
            description:
              'morning = 8 AM–12 PM, afternoon = 12 PM–5 PM, all_day = 8 AM–5 PM.',
          },
        },
        required: [
          'customer_name',
          'customer_phone',
          'service_address',
          'issue_description',
          'preferred_date',
          'preferred_time_of_day',
        ],
      },
    },
    // No per-tool server URL — Vapi routes to the assistant's serverUrl
    async: false,
  },
];

module.exports = { handleToolCall, TOOL_DEFINITIONS };
