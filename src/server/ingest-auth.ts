import crypto from "node:crypto";
import { VaultError } from "@/server/vault/errors";

/**
 * How an ingest request proved it was allowed in.
 *
 * - `bearer` — an external sender presenting `SMART_NOTES_INGEST_TOKEN`.
 * - `same-origin` — the installed Android share target posting directly to the
 *   app over loopback/LAN/tailnet. Never granted over public ingress.
 */
export type IngestAuthMode = "bearer" | "same-origin";

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasValidIngestBearerToken(request: Request) {
  const expected = process.env.SMART_NOTES_INGEST_TOKEN?.trim();
  if (!expected) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match?.[1] && constantTimeEqual(match[1], expected));
}

function isSameOriginRequest(request: Request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin === requestOrigin) {
    return true;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/**
 * Headers injected by the Cloudflare edge on any proxied request. A client
 * cannot suppress these on a request that actually traversed the edge, and any
 * client-supplied value is overwritten there.
 */
const PUBLIC_EDGE_HEADERS = ["cf-ray", "cf-connecting-ip"] as const;

function normalizeHostname(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  // Strip the port, tolerating bracketed IPv6 literals.
  const withoutPort = trimmed.startsWith("[")
    ? trimmed.slice(0, trimmed.indexOf("]") + 1)
    : trimmed.split(":")[0];
  return withoutPort || undefined;
}

function publicIngressHostnames() {
  return new Set(
    (process.env.SMART_NOTES_PUBLIC_INGRESS_HOSTS ?? "")
      .split(",")
      .map((entry) => normalizeHostname(entry))
      .filter((entry): entry is string => Boolean(entry))
  );
}

/**
 * True when the request reached us through the public path-scoped ingress
 * (SN-166) rather than directly over loopback/LAN/tailnet.
 *
 * The `sec-fetch-site` / `Origin` same-origin exemption below is trivially
 * spoofable by a non-browser client, so it must never be honoured for traffic
 * that came in over the public hostname — otherwise the bearer token stops
 * being an auth gate at all.
 */
export function arrivedViaPublicIngress(request: Request) {
  if (PUBLIC_EDGE_HEADERS.some((header) => request.headers.get(header))) {
    return true;
  }

  const publicHosts = publicIngressHostnames();
  if (publicHosts.size === 0) {
    return false;
  }

  const candidates = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  try {
    candidates.push(new URL(request.url).host);
  } catch {
    // Ignore an unparseable request URL; the header candidates still apply.
  }

  return candidates.some((candidate) => {
    const hostname = normalizeHostname(candidate);
    return Boolean(hostname && publicHosts.has(hostname));
  });
}

function unauthorized() {
  return new VaultError(
    "UNAUTHORIZED",
    "A valid bearer token is required for external ingest requests.",
    401
  );
}

/**
 * Authorize an ingest request and report which credential it used.
 *
 * The returned mode matters for SN-234: only `same-origin` share-target posts
 * keep the legacy global-Inbox capture behavior. Every `bearer` request is an
 * external sender and is held to the destination allowlist.
 */
export function authorizeIngestRequest(request: Request): IngestAuthMode {
  if (hasValidIngestBearerToken(request)) {
    return "bearer";
  }
  // Same-origin exemption exists for the installed Android share target, which
  // only ever reaches the app directly. It is not trustworthy over public
  // ingress, where a bearer token is always required.
  if (!arrivedViaPublicIngress(request) && isSameOriginRequest(request)) {
    return "same-origin";
  }
  throw unauthorized();
}

/**
 * Bearer-only gate for the destination catalog. The catalog is a read surface
 * for external senders, so it does not carry the share-target exemption.
 */
export function requireIngestBearerToken(request: Request) {
  if (!hasValidIngestBearerToken(request)) {
    throw unauthorized();
  }
}
