import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { handleInboundEmail } from "./index.js";

const originalFetch = globalThis.fetch;
const validEnv = {
  INBOUND_URL: "https://notes-inbound.lucidrss.com",
  SMART_NOTES_EMAIL_INBOUND_TOKEN: "test-token",
};

function message(overrides = {}) {
  const rejections = [];
  return {
    input: {
      from: "sender@example.com",
      to: "notes@lucidrss.com",
      raw: new TextEncoder().encode("From: sender@example.com\r\n\r\nBody"),
      setReject(reason) {
        rejections.push(reason);
      },
      ...overrides,
    },
    rejections,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("rejects SMTP delivery when the Smart Notes endpoint is unavailable", async () => {
  globalThis.fetch = async () => {
    throw new Error("endpoint unavailable");
  };
  const delivery = message();

  await handleInboundEmail(delivery.input, validEnv);

  assert.deepEqual(delivery.rejections, ["Could not reach Smart Notes email ingress"]);
});

test("rejects SMTP delivery when Smart Notes returns a non-2xx response", async () => {
  globalThis.fetch = async () => new Response('{"code":"UNAVAILABLE"}', { status: 503 });
  const delivery = message();

  await handleInboundEmail(delivery.input, validEnv);

  assert.deepEqual(delivery.rejections, ["Smart Notes email ingress failed (503)"]);
});

test("accepts SMTP delivery only after a successful raw-MIME POST", async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response('{"created":true,"id":"AI/Inbox/example.html"}', { status: 201 });
  };
  const delivery = message();

  await handleInboundEmail(delivery.input, validEnv);

  assert.deepEqual(delivery.rejections, []);
  assert.equal(request.url, "https://notes-inbound.lucidrss.com/api/email/inbound");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["Content-Type"], "message/rfc822");
  assert.equal(request.init.headers["X-Smart-Notes-Envelope-From"], "sender@example.com");
  assert.ok(request.init.body instanceof ArrayBuffer);
});

test("rejects a missing envelope sender before contacting Smart Notes", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };
  const delivery = message({ from: "" });

  await handleInboundEmail(delivery.input, validEnv);

  assert.equal(called, false);
  assert.deepEqual(delivery.rejections, ["Invalid Smart Notes envelope sender"]);
});

test("normalizes the Cloudflare envelope sender forwarded to Smart Notes", async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(null, { status: 204 });
  };
  const delivery = message({ from: " Sender@Example.COM " });

  await handleInboundEmail(delivery.input, validEnv);

  assert.deepEqual(delivery.rejections, []);
  assert.equal(request.init.headers["X-Smart-Notes-Envelope-From"], "sender@example.com");
});

test("rejects unexpected recipients before contacting Smart Notes", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };
  const delivery = message({ to: "jobs@lucidrss.com" });

  await handleInboundEmail(delivery.input, validEnv);

  assert.equal(called, false);
  assert.deepEqual(delivery.rejections, ["Unexpected Smart Notes recipient"]);
});
