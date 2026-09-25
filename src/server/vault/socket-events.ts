export function emitVaultSideEffects(input: {
  treeChanged?: boolean;
  fileUpdated?: { path: string; content: string; kind?: "log_form" | "app_data" | "spreadsheet"; originSocketId?: string; originClientId?: string };
  notebookUpdated?: { path: string; contentHash: string };
  /**
   * SN-270: a Deep Work workspace-source write landed on disk. Carries the
   * server-resolved real root so only the shell whose live session owns that
   * exact root reacts, and never the capability that authorized the write.
   */
  workspaceSourceUpdated?: { rootPath: string; path: string; revision: string };
}) {
  try {
    const io = (global as Record<string, unknown>)["_smartNotesIo"];
    if (!io || typeof (io as { emit: (event: string, data: unknown) => void }).emit !== "function") {
      return;
    }
    const emitter = io as {
      emit: (event: string, data: unknown) => void;
      except?: (room: string) => { emit: (event: string, data: unknown) => void };
    };
    if (input.fileUpdated) {
      const originSocketId = input.fileUpdated.originSocketId?.trim();
      if (originSocketId && typeof emitter.except === "function") {
        emitter.except(originSocketId).emit("file_updated", input.fileUpdated);
      } else {
        emitter.emit("file_updated", input.fileUpdated);
      }
    }
    if (input.notebookUpdated) {
      emitter.emit("jupyter_notebook_updated", input.notebookUpdated);
    }
    if (input.workspaceSourceUpdated) {
      emitter.emit("workspace_source_updated", input.workspaceSourceUpdated);
    }
    if (input.treeChanged) {
      emitter.emit("vault_updated", { reason: "agent_vault_tool" });
    }
  } catch {
    // Non-fatal — clients can refresh manually.
  }
}
