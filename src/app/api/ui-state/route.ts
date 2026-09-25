import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/vault/errors";
import { readVaultUiState, writeVaultUiState } from "@/server/vault/ui-state";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const state = await readVaultUiState();
    return NextResponse.json({ state });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      expandedNotebooks?: string[];
      expandedSections?: string[];
      closedNotebooks?: string[];
      expandedPages?: string[];
      accordionMode?: boolean;
      pinnedNotebooks?: string[];
      pinnedPages?: string[];
      notebookOrder?: string[];
      notebookGroups?: import("@/lib/notebook-sidebar-organization").NotebookGroup[];
      archivedNotebooks?: string[];
      companionPersist?: boolean;
    };
    const state = await writeVaultUiState(body);
    return NextResponse.json({ state });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
