import { NextResponse } from "next/server";
import { getAppStateDir } from "@/server/app-state";
import { readVaultTree } from "@/server/vault/pages";
import { toErrorResponse } from "@/server/vault/errors";
import {
  loadIngestDestinationsSettings,
  saveIngestDestinationsSettings,
  type IngestDestination,
} from "@/server/ingest-destinations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET/PUT /api/ingest/settings
 *
 * In-app (session-trusted, no bearer token) CRUD surface for the ingest
 * destination allowlist, backed by the same settings-store file `POST
 * /api/ingest` and `GET /api/ingest/destinations` read from
 * (SN-235). Distinct from the token-gated public catalog route: this one
 * returns full destination rows including `notebookPath`.
 */
export async function GET() {
  const stateDir = getAppStateDir();
  const settings = loadIngestDestinationsSettings(stateDir);
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      destinations?: IngestDestination[];
      defaultId?: string | null;
    };

    const stateDir = getAppStateDir();
    const { tree } = await readVaultTree();
    const knownNotebookPaths = new Set(tree.map((notebook) => notebook.path.trim().toLowerCase()));

    const saved = saveIngestDestinationsSettings(
      stateDir,
      { destinations: body.destinations ?? [], defaultId: body.defaultId ?? null },
      knownNotebookPaths
    );

    return NextResponse.json(saved);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
