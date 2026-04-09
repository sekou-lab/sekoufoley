'use strict';

/**
 * Vapi webhook router
 *
 * Handles all inbound events from Vapi:
 *   • tool-calls      – LLM wants to invoke a server-side function
 *   • call-started    – informational
 *   • call-ended      – informational
 *   • status-update   – informational
 *   • hang            – keep-alive nudge
 *
 * Vapi requires a response within ~29 s for tool-calls; we process them
 * synchronously so the LLM gets the result before speaking.
 */

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { handleToolCall } = require('../tools');

const router = express.Router();

// ---------------------------------------------------------------------------
// Optional webhook signature verification
// Vapi signs requests with HMAC-SHA256 when a webhookSecret is configured.
// ---------------------------------------------------------------------------
function isValidSignature(req) {
  if (!config.vapi.webhookSecret) return true; // Skip if no secret configured

  const sig = req.headers['x-vapi-signature'];
  if (!sig) {
    console.warn('[Vapi] Missing x-vapi-signature header');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', config.vapi.webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /vapi/webhook
// ---------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
  if (!isValidSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { message } = req.body;
  if (!message?.type) {
    return res.status(400).json({ error: 'Missing message.type' });
  }

  const { type } = message;
  const callId = message.call?.id ?? 'unknown';

  console.log(`[Vapi] Event: ${type}  call=${callId}`);

  switch (type) {
    // -----------------------------------------------------------------------
    case 'tool-calls': {
      const { toolCallList = [] } = message;

      if (toolCallList.length === 0) {
        return res.json({ results: [] });
      }

      // Execute all tool calls in parallel (usually just one at a time)
      const results = await Promise.all(
        toolCallList.map(async (toolCall) => {
          const fnName = toolCall.function?.name ?? 'unknown';
          try {
            console.log(`[Vapi] Tool call: ${fnName}  id=${toolCall.id}`);
            const result = await handleToolCall(toolCall, message);
            return { toolCallId: toolCall.id, result };
          } catch (err) {
            console.error(`[Vapi] Tool error (${fnName}):`, err.message);
            return {
              toolCallId: toolCall.id,
              result: `I'm sorry, there was a problem completing that request: ${err.message}`,
            };
          }
        }),
      );

      return res.json({ results });
    }

    // -----------------------------------------------------------------------
    case 'call-started':
      console.log(`[Vapi] Call started  id=${callId}`);
      return res.json({ message: 'ok' });

    // -----------------------------------------------------------------------
    case 'call-ended':
      console.log(`[Vapi] Call ended  id=${callId}`, {
        endedReason: message.call?.endedReason,
        durationSeconds: message.call?.duration,
      });
      return res.json({ message: 'ok' });

    // -----------------------------------------------------------------------
    case 'status-update':
      console.log(`[Vapi] Status: ${message.status}  call=${callId}`);
      return res.json({ message: 'ok' });

    // -----------------------------------------------------------------------
    case 'hang':
      // Vapi fires this when the call has been silent for a while
      return res.json({
        action: 'say',
        text: "I'm sorry, are you still there? Take your time — I'm here to help.",
      });

    // -----------------------------------------------------------------------
    case 'speech-update':
    case 'transcript':
    case 'conversation-update':
      // High-frequency events — acknowledge silently
      return res.json({ message: 'ok' });

    // -----------------------------------------------------------------------
    default:
      console.log(`[Vapi] Unhandled event type: ${type}`);
      return res.json({ message: 'ok' });
  }
});

module.exports = router;
