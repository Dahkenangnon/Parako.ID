import { once } from 'node:events';
import { createServer } from 'node:net';

function decodeBase64(value) {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function parseMailbox(command) {
  const match = command.match(/<([^>]*)>/);
  return match?.[1] ?? '';
}

/**
 * Minimal authenticated SMTP server used by browser E2E tests.
 *
 * It implements only the protocol surface exercised by Nodemailer's pooled
 * SMTP transport and stores raw messages in memory for deterministic assertions.
 */
export class SmtpCaptureServer {
  /** @type {import('node:net').Server | undefined} */
  #server;

  /** @type {Set<import('node:net').Socket>} */
  #sockets = new Set();

  /**
   * @param {{ host?: string; port?: number; username: string; password: string }} options
   */
  constructor({ host = '127.0.0.1', port = 0, username, password }) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    /** @type {Array<{ mailFrom: string; rcptTo: string[]; source: string }>} */
    this.messages = [];
  }

  async start() {
    if (this.#server) throw new Error('SMTP capture server is already started');

    this.#server = createServer(socket => this.#handleConnection(socket));
    this.#server.listen(this.port, this.host);
    await once(this.#server, 'listening');

    const address = this.#server.address();
    if (!address || typeof address === 'string') {
      throw new Error('SMTP capture server did not expose a TCP address');
    }
    this.port = address.port;
  }

  clear() {
    this.messages.length = 0;
  }

  async close() {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;

    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();

    if (!server.listening) return;
    server.close();
    await once(server, 'close');
  }

  /** @param {import('node:net').Socket} socket */
  #handleConnection(socket) {
    this.#sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('close', () => this.#sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    let buffer = '';
    let authenticated = false;
    let authLoginStep = '';
    let authLoginUsername = '';
    let collectingData = false;
    /** @type {string[]} */
    let dataLines = [];
    let mailFrom = '';
    /** @type {string[]} */
    let rcptTo = [];

    const reply = line => socket.write(`${line}\r\n`);
    const resetEnvelope = () => {
      collectingData = false;
      dataLines = [];
      mailFrom = '';
      rcptTo = [];
    };

    reply('220 parako-e2e.local ESMTP ready');

    socket.on('data', chunk => {
      buffer += chunk;
      let separator;
      while ((separator = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, separator).replace(/\r$/, '');
        buffer = buffer.slice(separator + 1);

        if (collectingData) {
          if (line === '.') {
            this.messages.push({
              mailFrom,
              rcptTo: [...rcptTo],
              source: dataLines.join('\r\n'),
            });
            resetEnvelope();
            reply('250 2.0.0 Message accepted');
          } else {
            dataLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }

        if (authLoginStep === 'username') {
          authLoginUsername = decodeBase64(line);
          authLoginStep = 'password';
          reply('334 UGFzc3dvcmQ6');
          continue;
        }
        if (authLoginStep === 'password') {
          authenticated =
            authLoginUsername === this.username &&
            decodeBase64(line) === this.password;
          authLoginStep = '';
          reply(
            authenticated
              ? '235 2.7.0 Authentication successful'
              : '535 5.7.8 Authentication credentials invalid'
          );
          continue;
        }

        const [verb = '', ...parts] = line.split(' ');
        const upperVerb = verb.toUpperCase();
        const argument = parts.join(' ');

        switch (upperVerb) {
          case 'EHLO':
          case 'HELO':
            reply('250-parako-e2e.local');
            reply('250-PIPELINING');
            reply('250-AUTH PLAIN LOGIN');
            reply('250 8BITMIME');
            break;
          case 'AUTH': {
            const [mechanism = '', initialResponse = ''] = parts;
            if (mechanism.toUpperCase() === 'PLAIN') {
              if (!initialResponse) {
                reply('334');
                break;
              }
              const [, username = '', password = ''] =
                decodeBase64(initialResponse).split('\0');
              authenticated =
                username === this.username && password === this.password;
              reply(
                authenticated
                  ? '235 2.7.0 Authentication successful'
                  : '535 5.7.8 Authentication credentials invalid'
              );
            } else if (mechanism.toUpperCase() === 'LOGIN') {
              if (initialResponse) {
                authLoginUsername = decodeBase64(initialResponse);
                authLoginStep = 'password';
                reply('334 UGFzc3dvcmQ6');
              } else {
                authLoginStep = 'username';
                reply('334 VXNlcm5hbWU6');
              }
            } else {
              reply('504 5.5.4 Unsupported authentication mechanism');
            }
            break;
          }
          case 'MAIL':
            if (!authenticated) {
              reply('530 5.7.0 Authentication required');
              break;
            }
            mailFrom = parseMailbox(argument);
            rcptTo = [];
            reply(
              mailFrom ? '250 2.1.0 Sender accepted' : '501 5.1.7 Bad sender'
            );
            break;
          case 'RCPT': {
            const recipient = parseMailbox(argument);
            if (!mailFrom || !recipient) {
              reply('503 5.5.1 MAIL command required');
              break;
            }
            rcptTo.push(recipient);
            reply('250 2.1.5 Recipient accepted');
            break;
          }
          case 'DATA':
            if (!mailFrom || rcptTo.length === 0) {
              reply('503 5.5.1 MAIL and RCPT required');
              break;
            }
            collectingData = true;
            dataLines = [];
            reply('354 End data with <CR><LF>.<CR><LF>');
            break;
          case 'RSET':
            resetEnvelope();
            reply('250 2.0.0 Reset');
            break;
          case 'NOOP':
            reply('250 2.0.0 OK');
            break;
          case 'QUIT':
            reply('221 2.0.0 Bye');
            socket.end();
            break;
          default:
            reply('502 5.5.2 Command not implemented');
        }
      }
    });
  }
}
