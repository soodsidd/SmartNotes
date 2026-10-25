import { NextResponse } from "next/server";

import {
  mutateWorkspaceNotebook,
  readWorkspaceNotebookContext,
} from "@/server/jupyter/workspace-notebook";
import { CELL_RUN_NOTE_MAX_CHARS, runWorkspaceJupyterCell } from "@/server/jupyter/cell-run";
import { registerCellRunWake } from "@/server/jupyter/cell-run-wake";
import {
  workspaceRequestFromValue,
  workspaceStorePathFromRequest,
} from "@/server/jupyter/workspace-request";
import { toErrorResponse, VaultError } from "@/server/vault/errors";

export const dynamic = "force-dynamic";

function optionalNumberParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  return value === null ? undefined : Number(value);
}

/** SN-359 workspace_notebook_context: bounded cell read of one capability-scoped .ipynb. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = workspaceRequestFromValue(workspaceStorePathFromRequest(request));
    const relativePath = url.searchParams.get("path");
    if (!relativePath) throw new VaultError("INVALID_PATH", 'Query parameter "path" is required.');
    return NextResponse.json(await readWorkspaceNotebookContext(workspace, relativePath, {
      index: optionalNumberParam(url, "index"),
      cellId: url.searchParams.get("cellId") ?? undefined,
      startIndex: optionalNumberParam(url, "startIndex"),
    }));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

/** SN-359 workspace_cell_create/edit/reorder/delete: one revision-checked cell mutation. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { workspace, path, expectedRevision, operation, ...args } = body;
    if (operation === "cell_run") {
      if (typeof path !== "string" || !path.trim()) throw new VaultError("INVALID_INPUT", '"path" is required.');
      if (args.index !== undefined && !Number.isInteger(args.index)) throw new VaultError("INVALID_INPUT", '"index" must be an integer.');
      if (args.cellId !== undefined && (typeof args.cellId !== "string" || !args.cellId.trim())) throw new VaultError("INVALID_INPUT", '"cellId" must be a non-empty string.');
      if (args.index === undefined && args.cellId === undefined) throw new VaultError("INVALID_INPUT", 'Provide "index" and/or "cellId".');
      if (args.note !== undefined && (typeof args.note !== "string" || args.note.length > CELL_RUN_NOTE_MAX_CHARS)) throw new VaultError("INVALID_INPUT", `"note" must be at most ${CELL_RUN_NOTE_MAX_CHARS} characters.`);
      if (args.awaitSeconds !== undefined && (typeof args.awaitSeconds !== "number" || !Number.isFinite(args.awaitSeconds))) throw new VaultError("INVALID_INPUT", '"awaitSeconds" must be a number.');
      if (args.wakeTimeoutMinutes !== undefined && (typeof args.wakeTimeoutMinutes !== "number" || !Number.isFinite(args.wakeTimeoutMinutes))) throw new VaultError("INVALID_INPUT", '"wakeTimeoutMinutes" must be a number.');
      const capability = workspaceRequestFromValue(workspace);
      const suppliedTurnId = request.headers.get("x-smart-notes-turn-id") || args.turnId;
      const host = (globalThis as Record<string, unknown>)._smartNotesCompanionHost as {
        getTurn?: (turnId: string) => { status: string; threadKey: string; appContext: string } | null;
      } | undefined;
      const turn = typeof suppliedTurnId === "string" && /^[0-9a-f-]{36}$/i.test(suppliedTurnId)
        ? host?.getTurn?.(suppliedTurnId)
        : null;
      if (
        !turn || turn.status !== "running" || !turn.threadKey.startsWith(`${workspace}::`) ||
        !turn.appContext.includes(`- companionTurnId: ${suppliedTurnId}`) ||
        !turn.appContext.includes("- Deep Work notebook run: enabled.") ||
        !turn.appContext.split(/\r?\n/).includes(`- Active repository-relative file: ${path}`)
      ) {
        throw new VaultError("WORKSPACE_NOTEBOOK_RUN_UNAVAILABLE", "Only the active Deep Work notebook turn with a live session may run this cell.", 403);
      }
      const result = await runWorkspaceJupyterCell(capability, {
        path,
        index: args.index as number | undefined,
        cellId: args.cellId as string | undefined,
        note: args.note as string | undefined,
        awaitMs: typeof args.awaitSeconds === "number" ? args.awaitSeconds * 1000 : undefined,
      });
      if (!result.handoff) return NextResponse.json({ ok: true, result });
      const registered = await registerCellRunWake({
        handoff: result.handoff,
        runStartedAt: result.run.startedAt,
        turnId: typeof suppliedTurnId === "string" && /^[0-9a-f-]{36}$/i.test(suppliedTurnId) ? suppliedTurnId : null,
        timeoutMinutes: args.wakeTimeoutMinutes as number | undefined,
        workspaceCapability: workspace as string,
      });
      return NextResponse.json({
        ok: true,
        result: {
          ...result,
          wake: registered.wake ? { wakeId: registered.wake.wakeId, status: registered.wake.status, timeoutAt: registered.wake.timeoutAt } : null,
          hint: registered.wake
            ? `${result.hint} Wake ${registered.wake.wakeId} is registered on this Deep Work thread. End your turn now; Smart Notes will resume it with outputs and your note. Do not poll or re-run the cell.`
            : `${result.hint} No auto-resume wake was registered (${registered.reason}); end your turn and tell the owner.`,
        },
      });
    }
    return NextResponse.json(
      await mutateWorkspaceNotebook(
        workspaceRequestFromValue(workspace),
        path,
        expectedRevision,
        operation,
        args
      )
    );
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
