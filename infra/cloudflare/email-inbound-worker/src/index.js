/**
 * Cloudflare Email Worker for Smart Notes (SN-212).
 *
 * Delivery is deliberately online-only. A missing setting, wrong recipient,
 * empty/oversized message, network error, or non-2xx app response rejects the
 * SMTP delivery. There is no queue or retry store in this Worker.
 */

const EXPECTED_RECIPIENT = "notes@lucidrss.com";
const MAX_RAW_EMAIL_BYTES = 5 * 1024 * 1024;
const ENVELOPE_FROM_HEADER = "X-Smart-Notes-Envelope-From";

export async function handleInboundEmail(message, env) {
  const inboundUrl = String(env.INBOUND_URL || "").trim().replace(/\/$/, "");
  const token = String(env.SMART_NOTES_EMAIL_INBOUND_TOKEN || "").trim();

  if (!inboundUrl || !token) {
    console.error("smart-notes-email-inbound: missing required configuration");
    message.setReject("Smart Notes email ingress is not configured");
    return;
  }

  const recipient = String(message.to || "").trim().toLowerCase();
  if (recipient !== EXPECTED_RECIPIENT) {
    console.warn(`smart-notes-email-inbound: rejected unexpected recipient ${recipient}`);
    message.setReject("Unexpected Smart Notes recipient");
    return;
  }

  const envelopeSender = String(message.from || "").trim().toLowerCase();
  if (!envelopeSender || !/^[^@\s<>,]+@[^@\s<>,]+$/.test(envelopeSender)) {
    console.warn("smart-notes-email-inbound: rejected missing or invalid envelope sender");
    message.setReject("Invalid Smart Notes envelope sender");
    return;
  }

  const rawBytes = await new Response(message.raw).arrayBuffer();
  if (!rawBytes.byteLength) {
    message.setReject("Empty email payload");
    return;
  }
  if (rawBytes.byteLength > MAX_RAW_EMAIL_BYTES) {
    message.setReject("Email exceeds the Smart Notes 5 MiB limit");
    return;
  }

  const target = `${inboundUrl}/api/email/inbound`;
  let response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "message/rfc822",
        [ENVELOPE_FROM_HEADER]: envelopeSender,
      },
      body: rawBytes,
    });
  } catch (error) {
    console.error(`smart-notes-email-inbound: endpoint fetch failed: ${error}`);
    message.setReject("Could not reach Smart Notes email ingress");
    return;
  }

  const responseText = await response.text();
  if (!response.ok) {
    console.error(
      `smart-notes-email-inbound: endpoint returned ${response.status}: ${responseText.slice(0, 500)}`,
    );
    message.setReject(`Smart Notes email ingress failed (${response.status})`);
    return;
  }

  let result = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    // A 2xx response is authoritative even if diagnostics are not JSON.
  }
  console.log(
    `smart-notes-email-inbound: delivered to=${recipient} status=${response.status} ` +
      `created=${result.created ?? "?"} id=${result.id ?? "?"}`,
  );
}

export default {
  async email(message, env) {
    await handleInboundEmail(message, env);
  },
};
