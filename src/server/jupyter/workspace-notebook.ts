import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { atomicReplaceFile, withFileMutation } from "@/server/atomic-file";
import {
  announceWorkspaceSourceWrite,
  resolveFile,
  revision,
  validateWorkspaceNotebookDocument,
  WORKSPACE_FILE_MAX_BYTES,
  WORKSPACE_REPLACEMENT_MAX_BYTES,
} from "@/server/jupyter/workspace-files";
import type { ProjectWorkspaceRequest } from "@/server/jupyter/workspace-root";
import { VaultError } from "@/server/vault/errors";
import {
  NOTEBOOK_CONTEXT_DEFAULTS,
  normalizeCellId,
  normalizeCellType,
  normalizeSource,
  requireCellIndex,
  requireCellType,
  resolveCellSelector,
  serializeOutputs,
  sourceForNotebook,
  truncateText,
  type JupyterCellType,
  type NotebookCell,
  type SerializedNotebookCell,
} from "@/server/vault/jupyter-notebook";

/**
 * SN-359: capability-scoped notebook cell tools for Deep Work.
 *
 * These operate on one repository-relative .ipynb beneath the live Deep Work
 * capability root, never on vault Jupyter folders. Every mutation requires the
 * strong sha256 revision returned by a prior read, rejects index/cellId
 * disagreement, preserves unrelated cells/outputs/metadata, and publishes the
 * result through the same atomic replace path as workspace_source_edit. Kernel
 * lifecycle and execution are never touched.
 */

export type WorkspaceCellOperation = "cell_create" | "cell_edit" | "cell_reorder" | "cell_delete";

export const WORKSPACE_CELL_OPERATIONS: readonly WorkspaceCellOperation[] = [
  "cell_create",
  "cell_edit",
  "cell_reorder",
  "cell_delete",
];

export interface WorkspaceNotebookContext {
  path: string;
  revision: string;
  size: number;
  nbformat: number;
  nbformatMinor: number;
  cellCount: number;
  startIndex: number;
  includedCellCount: number;
  truncated: boolean;
  cells: SerializedNotebookCell[];
  warnings: string[];
  focusedCell: { requestedIndex: number | null; requestedId: string | null; resolvedIndex: number; resolvedId: string | null } | null;
}

export interface WorkspaceNotebookMutation {
  path: string;
  revision: string;
  size: number;
  cellCount: number;
  mutation: Record<string, unknown>;
  hint: string;
}

interface WorkspaceNotebookDocument {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
  [key: string]: unknown;
}

const STRONG_REVISION = /^sha256:[a-f0-9]{64}$/;

function requireNotebookPath(value: unknown): void {
  if (typeof value !== "string" || !/\.ipynb$/i.test(value.trim())) {
    throw new VaultError("WORKSPACE_NOT_NOTEBOOK", "Workspace cell tools require one repository-relative .ipynb file.", 400);
  }
}

async function resolveNotebookFile(request: ProjectWorkspaceRequest, relativePath: unknown) {
  requireNotebookPath(relativePath);
  const resolved = await resolveFile(request, relativePath);
  // Re-check the normalized path so a crafted value cannot slip a non-notebook through.
  requireNotebookPath(resolved.relativePath);
  return resolved;
}

function parseNotebook(bytes: Buffer): WorkspaceNotebookDocument {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "The notebook is not valid UTF-8 JSON.", 422);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "The notebook could not be parsed as JSON.", 422);
  }
  const record = value as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || Array.isArray(record) || !Array.isArray(record.cells)) {
    throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "The notebook is missing a cells array.", 422);
  }
  if (record.nbformat !== 4) {
    throw new VaultError("INVALID_WORKSPACE_NOTEBOOK", "Only nbformat v4 notebooks are supported.", 422);
  }
  return record as WorkspaceNotebookDocument;
}

/** Keep the file's existing JSON indentation and trailing newline so diffs stay focused. */
function serializeNotebook(notebook: WorkspaceNotebookDocument, original: string): string {
  const indentMatch = original.match(/^\{\r?\n([ \t]+)"/);
  const indent = indentMatch ? indentMatch[1] : original.trimStart().startsWith("{\"") ? undefined : 1;
  const json = JSON.stringify(notebook, null, indent);
  return /\n$/.test(original) ? `${json}\n` : json;
}

function serializeCell(cell: NotebookCell, index: number): SerializedNotebookCell {
  const source = truncateText(normalizeSource(cell.source), NOTEBOOK_CONTEXT_DEFAULTS.maxSourceCharsPerCell);
  return {
    index,
    id: normalizeCellId(cell.id),
    cellType: normalizeCellType(cell.cell_type),
    source: source.text,
    sourceTruncated: source.truncated,
    executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null,
    outputs: serializeOutputs(cell.outputs, NOTEBOOK_CONTEXT_DEFAULTS.maxOutputCharsPerCell),
  };
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) throw new VaultError("INVALID_INPUT", `"${field}" must be an integer.`);
  return value as number;
}

function optionalCellId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new VaultError("INVALID_INPUT", '"cellId" must be a string.');
  return value;
}

function optionalSource(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.includes("\u0000")) {
    throw new VaultError("INVALID_INPUT", '"source" must be UTF-8 text.');
  }
  if (Buffer.byteLength(value, "utf8") > WORKSPACE_REPLACEMENT_MAX_BYTES) {
    throw new VaultError("WORKSPACE_EDITS_TOO_LARGE", "Cell source may not exceed 64 KiB.", 413);
  }
  return value;
}

export async function readWorkspaceNotebookContext(
  request: ProjectWorkspaceRequest,
  relativePath: unknown,
  selector: { index?: unknown; cellId?: unknown; startIndex?: unknown } = {}
): Promise<WorkspaceNotebookContext> {
  const index = optionalInteger(selector.index, "index");
  const cellId = optionalCellId(selector.cellId);
  const startIndex = optionalInteger(selector.startIndex, "startIndex") ?? 0;
  if (startIndex < 0) throw new VaultError("INVALID_INPUT", '"startIndex" must be zero or greater.');

  const resolved = await resolveNotebookFile(request, relativePath);
  const bytes = await fs.readFile(resolved.absolutePath);
  const notebook = parseNotebook(bytes);
  const cells = notebook.cells;
  const warnings: string[] = [];

  if (index !== undefined || cellId !== undefined) {
    const resolvedIndex = resolveCellSelector(cells, { index, cellId }, { required: true })!;
    return {
      path: resolved.relativePath,
      revision: revision(bytes),
      size: bytes.length,
      nbformat: notebook.nbformat,
      nbformatMinor: Number.isInteger(notebook.nbformat_minor) ? notebook.nbformat_minor : 0,
      cellCount: cells.length,
      startIndex: resolvedIndex,
      includedCellCount: 1,
      truncated: false,
      cells: [serializeCell(cells[resolvedIndex]!, resolvedIndex)],
      warnings,
      focusedCell: {
        requestedIndex: index ?? null,
        requestedId: normalizeCellId(cellId),
        resolvedIndex,
        resolvedId: normalizeCellId(cells[resolvedIndex]!.id),
      },
    };
  }

  const serialized: SerializedNotebookCell[] = [];
  let totalChars = 0;
  let truncated = startIndex > 0;
  for (let position = startIndex; position < cells.length; position += 1) {
    if (serialized.length >= NOTEBOOK_CONTEXT_DEFAULTS.maxCells) break;
    const cell = serializeCell(cells[position]!, position);
    const chars = cell.source.length + cell.outputs.reduce((sum, output) => sum + output.text.length, 0);
    if (serialized.length > 0 && totalChars + chars > NOTEBOOK_CONTEXT_DEFAULTS.maxTotalChars) break;
    totalChars += chars;
    serialized.push(cell);
    if (cell.sourceTruncated || cell.outputs.some((output) => output.truncated)) truncated = true;
  }
  const lastIncluded = startIndex + serialized.length;
  if (lastIncluded < cells.length) {
    truncated = true;
    warnings.push(
      `Notebook context truncated: showing cells ${startIndex}-${Math.max(startIndex, lastIncluded - 1)} of ${cells.length}. `
      + `Pass startIndex=${lastIncluded} to read the next page.`
    );
  }
  return {
    path: resolved.relativePath,
    revision: revision(bytes),
    size: bytes.length,
    nbformat: notebook.nbformat,
    nbformatMinor: Number.isInteger(notebook.nbformat_minor) ? notebook.nbformat_minor : 0,
    cellCount: cells.length,
    startIndex,
    includedCellCount: serialized.length,
    truncated,
    cells: serialized,
    warnings,
    focusedCell: null,
  };
}

function createWorkspaceCell(notebook: WorkspaceNotebookDocument, cellType: JupyterCellType, source: string): NotebookCell {
  const cell: NotebookCell = {};
  // nbformat 4.5+ requires stable cell ids; earlier minors forbid them, so
  // only mint one when the notebook's own schema expects it.
  if (Number.isInteger(notebook.nbformat_minor) && notebook.nbformat_minor >= 5) {
    cell.id = randomUUID();
  }
  cell.cell_type = cellType;
  cell.metadata = {};
  cell.source = sourceForNotebook(source);
  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }
  return cell;
}

function applyCellOperation(
  notebook: WorkspaceNotebookDocument,
  operation: WorkspaceCellOperation,
  args: Record<string, unknown>
): Record<string, unknown> {
  const cells = notebook.cells;
  switch (operation) {
    case "cell_create": {
      const cellType = requireCellType(args.cellType ?? "code");
      const source = optionalSource(args.source) ?? "";
      const requested = optionalInteger(args.index, "index");
      const index = requested ?? cells.length;
      if (index < 0 || index > cells.length) {
        throw new VaultError("CELL_NOT_FOUND", `Insertion index ${index} is out of range 0-${cells.length}.`, 404);
      }
      const cell = createWorkspaceCell(notebook, cellType, source);
      cells.splice(index, 0, cell);
      return { action: "create", index, cellId: normalizeCellId(cell.id), cellType };
    }
    case "cell_edit": {
      const source = optionalSource(args.source);
      const cellType = args.cellType === undefined ? undefined : requireCellType(args.cellType);
      if (source === undefined && cellType === undefined) {
        throw new VaultError("INVALID_INPUT", 'Provide "source" and/or "cellType" to edit a cell.');
      }
      const index = resolveCellSelector(
        cells,
        { index: optionalInteger(args.index, "index"), cellId: optionalCellId(args.cellId) },
        { required: true }
      )!;
      const cell = cells[index]!;
      if (cellType && cellType !== cell.cell_type) {
        cell.cell_type = cellType;
        if (cellType === "code") {
          if (!Array.isArray(cell.outputs)) cell.outputs = [];
          if (cell.execution_count === undefined) cell.execution_count = null;
        } else {
          delete cell.outputs;
          delete cell.execution_count;
        }
      }
      if (source !== undefined) cell.source = sourceForNotebook(source);
      return { action: "edit", index, cellId: normalizeCellId(cell.id), cellType: normalizeCellType(cell.cell_type) };
    }
    case "cell_delete": {
      const index = resolveCellSelector(
        cells,
        { index: optionalInteger(args.index, "index"), cellId: optionalCellId(args.cellId) },
        { required: true }
      )!;
      const [removed] = cells.splice(index, 1);
      return { action: "delete", index, cellId: normalizeCellId(removed?.id) };
    }
    case "cell_reorder": {
      const fromIndex = resolveCellSelector(
        cells,
        { index: optionalInteger(args.fromIndex, "fromIndex"), cellId: optionalCellId(args.cellId) },
        { required: true }
      )!;
      const toIndex = requireCellIndex(cells, args.toIndex, "toIndex");
      const [cell] = cells.splice(fromIndex, 1);
      cells.splice(toIndex, 0, cell!);
      return { action: "reorder", fromIndex, toIndex, cellId: normalizeCellId(cell!.id) };
    }
  }
}

export async function mutateWorkspaceNotebook(
  request: ProjectWorkspaceRequest,
  relativePath: unknown,
  expectedRevision: unknown,
  operation: unknown,
  args: Record<string, unknown> = {}
): Promise<WorkspaceNotebookMutation> {
  if (typeof operation !== "string" || !WORKSPACE_CELL_OPERATIONS.includes(operation as WorkspaceCellOperation)) {
    throw new VaultError(
      "INVALID_INPUT",
      `"operation" must be one of ${WORKSPACE_CELL_OPERATIONS.join(", ")}.`
    );
  }
  if (typeof expectedRevision !== "string" || !STRONG_REVISION.test(expectedRevision)) {
    throw new VaultError(
      "INVALID_WORKSPACE_REVISION",
      "A strong expectedRevision from workspace_notebook_context or workspace_source_read is required."
    );
  }
  const resolved = await resolveNotebookFile(request, relativePath);
  if (resolved.workspace.accessMode !== "editable") {
    throw new VaultError("WORKSPACE_READ_ONLY", "This workspace is read-only.", 403);
  }

  const result = await withFileMutation(resolved.absolutePath, async () => {
    const currentBytes = await fs.readFile(resolved.absolutePath);
    if (revision(currentBytes) !== expectedRevision) {
      throw new VaultError(
        "WORKSPACE_REVISION_CONFLICT",
        "Notebook changed after it was read. Re-read workspace_notebook_context and retry.",
        409
      );
    }
    const original = currentBytes.toString("utf8");
    const notebook = parseNotebook(currentBytes);
    const mutation = applyCellOperation(notebook, operation as WorkspaceCellOperation, args);
    validateWorkspaceNotebookDocument(notebook);
    const nextBytes = Buffer.from(serializeNotebook(notebook, original), "utf8");
    if (nextBytes.length > WORKSPACE_FILE_MAX_BYTES) {
      throw new VaultError("WORKSPACE_FILE_TOO_LARGE", "The edited notebook would exceed 1 MiB.", 413);
    }
    const originalStat = await fs.stat(resolved.absolutePath);
    if (typeof originalStat.nlink === "number" && originalStat.nlink > 1) {
      throw new VaultError("WORKSPACE_HARD_LINK_BLOCKED", "Workspace source tools do not replace multiply-linked files.", 403);
    }
    await atomicReplaceFile(resolved.absolutePath, nextBytes, {
      mode: originalStat.mode,
      beforeReplace: async () => {
        const beforeRename = await fs.readFile(resolved.absolutePath);
        if (revision(beforeRename) !== expectedRevision) {
          throw new VaultError(
            "WORKSPACE_REVISION_CONFLICT",
            "Notebook changed while the cell edit was being applied.",
            409
          );
        }
      },
    });
    return {
      path: resolved.relativePath,
      revision: revision(nextBytes),
      size: nextBytes.length,
      cellCount: notebook.cells.length,
      mutation,
      hint:
        "Notebook saved on disk. Use the returned revision as expectedRevision for the next cell operation. "
        + "No kernel was started, stopped, or executed; an open JupyterLab view may prompt to reload.",
    };
  });
  announceWorkspaceSourceWrite(resolved.workspace.realRoot, result);
  return result;
}
