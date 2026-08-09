import { Agent, MockAgent, fetch, setGlobalDispatcher } from 'undici';

const BACKCHANNEL_ORIGIN = 'https://client.example.com';
const BACKCHANNEL_PATH = '/backchannel_logout';
const captureUrl = process.env.PARAKO_E2E_BACKCHANNEL_CAPTURE_URL;

if (!captureUrl) {
  throw new Error('PARAKO_E2E_BACKCHANNEL_CAPTURE_URL is required');
}

async function consumeBody(body) {
  if (typeof body === 'string') return body;
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

class SharedMockAgent extends MockAgent {
  constructor() {
    super();
    this.disableNetConnect();
    this.get(BACKCHANNEL_ORIGIN)
      .intercept({ method: 'POST', path: BACKCHANNEL_PATH })
      .reply(204, async options => {
        const body = await consumeBody(options.body);
        const response = await fetch(captureUrl, {
          body,
          dispatcher: new Agent(),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(
            `Back-channel capture failed with status ${response.status}`
          );
        }
        return '';
      })
      .persist();
  }
}

setGlobalDispatcher(new SharedMockAgent());
