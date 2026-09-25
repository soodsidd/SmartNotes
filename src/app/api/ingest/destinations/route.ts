import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/vault/errors";
import { requireIngestBearerToken } from "@/server/ingest-auth";
import {
  loadIngestDestinationCatalog,
  toIngestDestinationCatalogResponse,
} from "@/server/ingest-destinations";

// The catalog is read per request from environment configuration and must never
// be cached into the build output.
export const dynamic = "force-dynamic";

/**
 * GET /api/ingest/destinations
 *
 * Token-gated catalog of the operator-configured ingest allowlist (SN-234).
 * Returns `id` + `label` only: notebook paths stay server-side, and unlisted
 * notebooks — including registered portables — are never disclosed. This is not
 * a vault browser.
 */
export async function GET(request: Request) {
  try {
    requireIngestBearerToken(request);
    const catalog = loadIngestDestinationCatalog();
    return NextResponse.json(toIngestDestinationCatalogResponse(catalog), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: response.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
    });
  }
}
