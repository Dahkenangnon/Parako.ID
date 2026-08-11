import { randomUUID } from 'node:crypto';

import { Agent, fetch } from 'undici';

/**
 * Test-only substitute for the narrow Twilio client surface used by Parako.
 * It delivers messages to the disposable RP capture endpoint, leaving the
 * production SMS service and its provider selection untouched.
 */
export default function createTwilioClient() {
  return {
    messages: {
      async create(message) {
        const captureUrl = process.env.PARAKO_E2E_SMS_CAPTURE_URL;
        if (!captureUrl) {
          throw new Error('PARAKO_E2E_SMS_CAPTURE_URL is not configured');
        }

        const dispatcher = new Agent();
        try {
          const response = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
            dispatcher,
          });
          if (!response.ok) {
            throw new Error(
              `SMS capture endpoint returned HTTP ${response.status}`
            );
          }
        } finally {
          await dispatcher.close();
        }

        return { sid: `SM${randomUUID().replaceAll('-', '')}` };
      },
    },
  };
}
