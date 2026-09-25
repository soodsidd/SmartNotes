import { NextResponse } from "next/server";
import {
  constantTimeTokenEqual,
  EMAIL_ENVELOPE_FROM_HEADER,
  EmailInboundError,
  logEmailInbound,
  MAX_RAW_EMAIL_BYTES,
  normalizeEnvelopeSender,
  parseAllowedSenders,
  processInboundEmail,
} from "@/server/email-inbound";

function errorResponse(error: EmailInboundError): NextResponse {
  return NextResponse.json(
    { code: error.code, error: error.message },
    {
      status: error.status,
      headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    }
  );
}

function configuredToken(): string {
  const token = process.env.SMART_NOTES_EMAIL_INBOUND_TOKEN?.trim();
  if (!token) {
    throw new EmailInboundError(
      "EMAIL_INBOUND_UNCONFIGURED",
      "Email inbound bearer authentication is not configured.",
      503
    );
  }
  return token;
}

function authorize(request: Request, expectedToken: string): void {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1] || !constantTimeTokenEqual(match[1], expectedToken)) {
    throw new EmailInboundError("UNAUTHORIZED", "A valid bearer token is required.", 401);
  }
}

function validateContentType(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "message/rfc822") {
    throw new EmailInboundError("INVALID_MIME", "Content-Type must be message/rfc822.", 400);
  }
}

function validateDeclaredSize(request: Request): void {
  const declared = request.headers.get("content-length");
  if (!declared) return;
  const bytes = Number(declared);
  if (Number.isFinite(bytes) && bytes > MAX_RAW_EMAIL_BYTES) {
    throw new EmailInboundError("EMAIL_TOO_LARGE", "Raw email exceeds the 5 MiB limit.", 413);
  }
}

/** POST /api/email/inbound — Cloudflare Email Routing raw-MIME ingress. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const expectedToken = configuredToken();
    authorize(request, expectedToken);
    validateContentType(request);
    validateDeclaredSize(request);

    const allowedSenders = parseAllowedSenders(process.env.SMART_NOTES_EMAIL_ALLOWED_SENDERS);
    if (allowedSenders.size === 0) {
      throw new EmailInboundError(
        "EMAIL_ALLOWED_SENDERS_UNCONFIGURED",
        "Email inbound sender allowlist is not configured.",
        503
      );
    }

    const envelopeSender = normalizeEnvelopeSender(request.headers.get(EMAIL_ENVELOPE_FROM_HEADER));
    const rawMime = Buffer.from(await request.arrayBuffer());
    if (rawMime.length === 0) {
      throw new EmailInboundError("INVALID_MIME", "Raw MIME body is empty.", 400);
    }
    if (rawMime.length > MAX_RAW_EMAIL_BYTES) {
      throw new EmailInboundError("EMAIL_TOO_LARGE", "Raw email exceeds the 5 MiB limit.", 413);
    }

    const result = await processInboundEmail(rawMime, allowedSenders, envelopeSender);
    return NextResponse.json(
      { status: "ok", ...result },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    const normalized = error instanceof EmailInboundError
      ? error
      : new EmailInboundError("INTERNAL_ERROR", "Unexpected email inbound failure.", 500);
    logEmailInbound(normalized.status >= 500 ? "error" : "warn", "request-rejected", {
      code: normalized.code,
      status: normalized.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(normalized);
  }
}
