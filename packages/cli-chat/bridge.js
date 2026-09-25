#!/usr/bin/env node

'use strict';

const { PassThrough } = require('stream');
const { createChatModule } = require('./index');

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseInput(raw) {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function createRequest(command) {
  const req = new PassThrough();
  req.method = command.method || 'GET';
  req.url = `${command.urlPrefix || '/api/chat'}${command.path || ''}`;
  req.headers = command.headers || {};
  return req;
}

function createResponse(onEnd) {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(chunk) {
      if (chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      onEnd({
        status: this.statusCode,
        headers: this.headers,
        body: Buffer.concat(this.chunks),
      });
    },
  };
}

async function main() {
  const command = parseInput(await readStdin());
  const io = {
    emit(event, payload) {
      writeMessage({ type: 'socket', event, payload });
      if (event === 'chat_event' && payload && payload.type === 'done') {
        setImmediate(() => process.exit(0));
      }
    },
  };

  const chat = createChatModule(null, io, {
    ...(command.config || {}),
    recoverInterruptedOnStartup: false,
  });
  const req = createRequest(command);
  const body = command.bodyBase64 ? Buffer.from(command.bodyBase64, 'base64') : Buffer.alloc(0);

  const response = await new Promise((resolve) => {
    const res = createResponse(resolve);
    chat.handleRequest(req, res);
    req.end(body);
  });

  writeMessage({
    type: 'response',
    status: response.status,
    headers: response.headers,
    bodyBase64: response.body.toString('base64'),
  });

  const keepAlive = !!command.stream && response.status >= 200 && response.status < 300;
  if (!keepAlive) {
    process.exit(0);
  }
}

main().catch((error) => {
  writeMessage({
    type: 'bridge_error',
    error: error.message,
    stack: error.stack || '',
  });
  process.exit(1);
});