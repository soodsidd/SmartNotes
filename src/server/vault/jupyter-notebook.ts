import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { VaultError } from "./errors";
import { readPage } from "./pages";
import { resolveVaultPath } from "./paths";
import { JUPYTER_NOTEBOOK_FILE_NAME, jupyterDirRelativePath } from "./page-format";

export type JupyterCellType = "code" | "markdown" | "raw";

interface NotebookCell {
  id?: unknown;
  cell_type?: unknown;
  source?: unknown;
  metadata?: unknown;
  outputs?: unknown;
  execution_count?: unknown;
  [key: string]: unknown;
}

interface NotebookDocument {
  cells?: unknown;
  metadata?: unknown;
  nbformat?: unknown;
  nbformat_minor?: unknown;
  [key: string]: unknown;
}

export interface SerializedNotebookCell {
  index: number;
  id: string | null;
  cellType: JupyterCellType;
  source: string;
  sourceTruncated: boolean;
  executionCount: number | null;
  outputs: Array<{
    kind: string;
    text: string;
    truncated: boolean;
  }>;
}

export interface NotebookContextSummary {
  path: string;
  notebookPath: string;
  cellCount: number;
  includedCellCount: number;
  truncated: boolean;
  cells: SerializedNotebookCell[];
  warnings: string[];
  focusedCell: {
    requestedIndex: number | null;
    requestedId: string | null;
    resolvedIndex: number | null;
    resolvedId: string | null;
  } | null;
}

export interface NotebookContextOptions extends Partial<typeof NOTEBOOK_CONTEXT_DEFAULTS> {
  focusedCellIndex?: number;
  focusedCellId?: string;
  focusedCellOnly?: boolean;
  strictFocusedCell?: boolean;
}

export const NOTEBOOK_CONTEXT_DEFAULTS = {
  maxCells: 20,
  maxSourceCharsPerCell: 4_000,
  maxOutputCharsPerCell: 2_000,
  maxTotalChars: 24_000,
} as const;

function normalizeSource(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }
  if (Array.isArray(source)) {
    return source.map((entry) => (typeof entry === "string" ? entry : String(entry ?? ""))).join("");
  }
  return "";
}

function sourceForNotebook(source: string): string[] {
  if (!source) {
    return [];
  }
  return (source.endsWith("\n") ? source : `${source}\n`).match(/.*\n/g) ?? [];
}

function normalizeCellType(value: unknown): JupyterCellType {
  if (value === "code" || value === "markdown" || value === "raw") {
    return value;
  }
  return "code";
}

export function requireCellType(value: unknown): JupyterCellType {
  if (value === "code" || value === "markdown" || value === "raw") {
    return value;
  }
  throw new VaultError("INVALID_INPUT", '"cellType" must be "code", "markdown", or "raw".');
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 48)).trimEnd()}\n[truncated to ${maxChars} characters]`,
    truncated: true,
  };
}

function textFromMimeBundle(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const bundle = data as Record<string, unknown>;
  const plain = bundle["text/plain"];
  if (typeof plain === "string") {
    return plain;
  }
  if (Array.isArray(plain)) {
    return plain.map((entry) => (typeof entry === "string" ? entry : String(entry ?? ""))).join("");
  }

  const imageMime = Object.keys(bundle).find((key) => key.startsWith("image/"));
  if (imageMime) {
    return `[${imageMime} output omitted]`;
  }
  return "";
}

function serializeOutputs(outputs: unknown, maxChars: number): SerializedNotebookCell["outputs"] {
  if (!Array.isArray(outputs)) {
    return [];
  }

  return outputs.slice(-3).map((output) => {
    const record = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
    const outputType = typeof record.output_type === "string" ? record.output_type : "output";
    let text = "";

    if (outputType === "stream") {
      text = normalizeSource(record.text);
    } else if (outputType === "error") {
      const traceback = normalizeSource(record.traceback);
      const summary = [record.ename, record.evalue].filter((entry) => typeof entry === "string").join(": ");
      text = traceback || summary;
    } else if (outputType === "execute_result" || outputType === "display_data") {
      text = textFromMimeBundle(record.data);
    }

    const truncated = truncateText(text, maxChars);
    return {
      kind: outputType,
      text: truncated.text,
      truncated: truncated.truncated,
    };
  });
}

function validateNotebookDocument(value: unknown): NotebookDocument {
  if (!value || typeof value !== "object") {
    throw new VaultError("INVALID_NOTEBOOK", "Notebook file is not a JSON object.", 422);
  }
  const notebook = value as NotebookDocument;
  if (!Array.isArray(notebook.cells)) {
    throw new VaultError("INVALID_NOTEBOOK", "Notebook file is missing a cells array.", 422);
  }
  if (notebook.nbformat !== 4) {
    throw new VaultError("INVALID_NOTEBOOK", "Only nbformat v4 notebooks are supported.", 422);
  }
  return notebook;
}

export async function resolveJupyterNotebookFile(pagePath: string) {
  const page = await readPage(pagePath);
  if (page.metadata.note_type !== "jupyter") {
    throw new VaultError("NOT_JUPYTER_PAGE", "Notebook cell tools require a Jupyter note.", 400);
  }

  const notebookDir = resolveVaultPath(jupyterDirRelativePath(page.path), "section");
  const notebookPath = path.join(notebookDir.absolutePath, JUPYTER_NOTEBOOK_FILE_NAME);
  return {
    page,
    absolutePath: notebookPath,
    relativePath: `${notebookDir.relativePath}/${JUPYTER_NOTEBOOK_FILE_NAME}`,
  };
}

async function readNotebookDocument(pagePath: string) {
  const resolved = await resolveJupyterNotebookFile(pagePath);
  let raw = "";
  try {
    raw = await fs.readFile(resolved.absolutePath, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError("NOTEBOOK_UNAVAILABLE", "Jupyter notebook file is missing.", 404);
    }
    throw error;
  }

  try {
    return {
      ...resolved,
      notebook: validateNotebookDocument(JSON.parse(raw)),
    };
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }
    throw new VaultError("INVALID_NOTEBOOK", "Jupyter notebook file could not be parsed as JSON.", 422);
  }
}

async function writeNotebookDocument(absolutePath: string, notebook: NotebookDocument) {
  validateNotebookDocument(notebook);
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(directory, `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(notebook, null, 1), "utf8");
  try {
    await fs.rename(tempPath, absolutePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function cellsOf(notebook: NotebookDocument): NotebookCell[] {
  return notebook.cells as NotebookCell[];
}

function normalizeCellId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function requireCellIndex(cells: NotebookCell[], value: unknown, field = "index") {
  if (!Number.isInteger(value)) {
    throw new VaultError("INVALID_INPUT", `"${field}" must be an integer.`);
  }
  const index = value as number;
  if (index < 0 || index >= cells.length) {
    throw new VaultError("CELL_NOT_FOUND", `Cell index ${index} is out of range.`, 404);
  }
  return index;
}

function resolveCellSelector(
  cells: NotebookCell[],
  selector: { index?: number; cellId?: string },
  options: { required?: boolean } = {}
) {
  const hasIndex = selector.index !== undefined;
  const cellId = normalizeCellId(selector.cellId);
  const hasCellId = selector.cellId !== undefined;
  if (!hasIndex && !hasCellId) {
    if (options.required) {
      throw new VaultError("INVALID_INPUT", 'Provide "index" and/or "cellId" to select a cell.');
    }
    return null;
  }
  if (hasIndex && !Number.isInteger(selector.index)) {
    throw new VaultError("INVALID_INPUT", '"index" must be an integer.');
  }
  if (hasCellId && !cellId) {
    throw new VaultError("INVALID_INPUT", '"cellId" must be a non-empty string of at most 200 characters.');
  }

  const indexFromId = cellId
    ? cells.findIndex((cell) => normalizeCellId(cell.id) === cellId)
    : -1;
  if (cellId && indexFromId < 0) {
    throw new VaultError("CELL_NOT_FOUND", `Cell id ${cellId} was not found.`, 404);
  }
  if (hasIndex && indexFromId >= 0 && selector.index !== indexFromId) {
    throw new VaultError(
      "CELL_SELECTOR_MISMATCH",
      `Cell index ${selector.index} does not match cell id ${cellId}. Reload notebook context before editing.`,
      409
    );
  }
  const indexFromNumber = hasIndex ? requireCellIndex(cells, selector.index) : null;
  return indexFromNumber ?? indexFromId;
}

function insertIndex(cells: NotebookCell[], value: unknown) {
  if (value === undefined || value === null) {
    return cells.length;
  }
  if (!Number.isInteger(value)) {
    throw new VaultError("INVALID_INPUT", '"index" must be an integer.');
  }
  return Math.min(Math.max(value as number, 0), cells.length);
}

function createCell(cellType: JupyterCellType, source: string): NotebookCell {
  const cell: NotebookCell = {
    id: randomUUID(),
    cell_type: cellType,
    metadata: {},
    source: sourceForNotebook(source),
  };
  if (cellType === "code") {
    cell.execution_count = null;
    cell.outputs = [];
  }
  return cell;
}

export async function readNotebookContext(
  pagePath: string,
  options: NotebookContextOptions = {}
): Promise<NotebookContextSummary> {
  const limits = {
    ...NOTEBOOK_CONTEXT_DEFAULTS,
    maxCells: options.maxCells ?? NOTEBOOK_CONTEXT_DEFAULTS.maxCells,
    maxSourceCharsPerCell: options.maxSourceCharsPerCell ?? NOTEBOOK_CONTEXT_DEFAULTS.maxSourceCharsPerCell,
    maxOutputCharsPerCell: options.maxOutputCharsPerCell ?? NOTEBOOK_CONTEXT_DEFAULTS.maxOutputCharsPerCell,
    maxTotalChars: options.maxTotalChars ?? NOTEBOOK_CONTEXT_DEFAULTS.maxTotalChars,
  };
  const { page, relativePath, notebook } = await readNotebookDocument(pagePath);
  const cells = cellsOf(notebook);
  const serialized: SerializedNotebookCell[] = [];
  const warnings: string[] = [];
  let totalChars = 0;
  let truncated = false;

  const requestedFocus = options.focusedCellIndex !== undefined || options.focusedCellId !== undefined;
  let focusedCellIndex: number | null = null;
  if (requestedFocus) {
    try {
      focusedCellIndex = resolveCellSelector(cells, {
        index: options.focusedCellIndex,
        cellId: options.focusedCellId,
      }, { required: true });
    } catch (error) {
      if (options.strictFocusedCell) throw error;
      const selector = [
        options.focusedCellIndex !== undefined ? `index=${options.focusedCellIndex}` : null,
        options.focusedCellId ? `id=${options.focusedCellId}` : null,
      ].filter(Boolean).join(", ");
      warnings.push(
        `Live focused cell (${selector || "unknown selector"}) is not present in the saved notebook. `
        + "Do not infer its contents; save it in JupyterLab or reload notebook context before answering or editing."
      );
    }
  }

  const orderedIndices = focusedCellIndex !== null
    ? [focusedCellIndex, ...cells.map((_cell, index) => index).filter((index) => index !== focusedCellIndex)]
    : cells.map((_cell, index) => index);
  const candidateIndices = options.focusedCellOnly && focusedCellIndex !== null
    ? [focusedCellIndex]
    : orderedIndices;

  for (const index of candidateIndices) {
    if (serialized.length >= limits.maxCells) break;
    const cell = cells[index]!;
    const source = truncateText(normalizeSource(cell.source), limits.maxSourceCharsPerCell);
    const outputs = serializeOutputs(cell.outputs, limits.maxOutputCharsPerCell);
    const nextChars = source.text.length + outputs.reduce((sum, output) => sum + output.text.length, 0);
    if (serialized.length > 0 && totalChars + nextChars > limits.maxTotalChars) {
      truncated = true;
      break;
    }
    totalChars += nextChars;
    serialized.push({
      index,
      id: normalizeCellId(cell.id),
      cellType: normalizeCellType(cell.cell_type),
      source: source.text,
      sourceTruncated: source.truncated,
      executionCount: typeof cell.execution_count === "number" ? cell.execution_count : null,
      outputs,
    });
    if (source.truncated || outputs.some((output) => output.truncated)) {
      truncated = true;
    }
  }

  serialized.sort((left, right) => left.index - right.index);

  if (cells.length > serialized.length && !(options.focusedCellOnly && focusedCellIndex !== null)) {
    truncated = true;
    warnings.push(`Notebook context truncated: showing ${serialized.length} of ${cells.length} cells.`);
  }

  return {
    path: page.path,
    notebookPath: relativePath,
    cellCount: cells.length,
    includedCellCount: serialized.length,
    truncated,
    cells: serialized,
    warnings,
    focusedCell: requestedFocus
      ? {
          requestedIndex: options.focusedCellIndex ?? null,
          requestedId: normalizeCellId(options.focusedCellId),
          resolvedIndex: focusedCellIndex,
          resolvedId: focusedCellIndex !== null ? normalizeCellId(cells[focusedCellIndex]?.id) : null,
        }
      : null,
  };
}

export function formatNotebookContext(summary: NotebookContextSummary) {
  const lines = [
    "## Jupyter notebook context",
    `Notebook file: ${summary.notebookPath}`,
    `Cells included: ${summary.includedCellCount}/${summary.cellCount}`,
  ];

  if (summary.focusedCell?.resolvedIndex !== null && summary.focusedCell?.resolvedIndex !== undefined) {
    lines.push(
      `Live focused saved cell: index=${summary.focusedCell.resolvedIndex} (zero-based), `
      + `id=${summary.focusedCell.resolvedId ?? "(unavailable)"}`
    );
  }

  for (const warning of summary.warnings) {
    lines.push(`Warning: ${warning}`);
  }

  for (const cell of summary.cells) {
    lines.push("", `### Cell ${cell.index} (${cell.cellType})`, `Cell id: ${cell.id ?? "(unavailable)"}`);
    if (cell.executionCount !== null) {
      lines.push(`Execution count: ${cell.executionCount}`);
    }
    lines.push("Source:", "```", cell.source, "```");
    if (cell.outputs.length > 0) {
      lines.push("Recent outputs:");
      for (const output of cell.outputs) {
        lines.push(`- ${output.kind}:`, "```", output.text, "```");
      }
    }
  }

  return lines.join("\n");
}

export async function createNotebookCell(input: {
  path: string;
  cellType: JupyterCellType;
  source: string;
  index?: number;
}) {
  const { absolutePath, relativePath, notebook } = await readNotebookDocument(input.path);
  const cells = cellsOf(notebook);
  const index = insertIndex(cells, input.index);
  const cell = createCell(input.cellType, input.source);
  cells.splice(index, 0, cell);
  await writeNotebookDocument(absolutePath, notebook);
  return notebookMutationResult(input.path, relativePath, notebook, { index, action: "create" });
}

export async function editNotebookCell(input: {
  path: string;
  index?: number;
  cellId?: string;
  source?: string;
  cellType?: JupyterCellType;
}) {
  const { absolutePath, relativePath, notebook } = await readNotebookDocument(input.path);
  const cells = cellsOf(notebook);
  const index = resolveCellSelector(cells, input, { required: true })!;
  const current = cells[index]!;
  if (input.cellType) {
    current.cell_type = input.cellType;
    if (input.cellType === "code" && !Array.isArray(current.outputs)) {
      current.outputs = [];
      current.execution_count = null;
    }
    if (input.cellType !== "code") {
      delete current.outputs;
      delete current.execution_count;
    }
  }
  if (typeof input.source === "string") {
    current.source = sourceForNotebook(input.source);
  }
  await writeNotebookDocument(absolutePath, notebook);
  return notebookMutationResult(input.path, relativePath, notebook, {
    index,
    cellId: normalizeCellId(current.id),
    action: "edit",
  });
}

export async function deleteNotebookCell(input: { path: string; index: number }) {
  const { absolutePath, relativePath, notebook } = await readNotebookDocument(input.path);
  const cells = cellsOf(notebook);
  const index = requireCellIndex(cells, input.index);
  cells.splice(index, 1);
  await writeNotebookDocument(absolutePath, notebook);
  return notebookMutationResult(input.path, relativePath, notebook, { index, action: "delete" });
}

export async function reorderNotebookCell(input: { path: string; fromIndex: number; toIndex: number }) {
  const { absolutePath, relativePath, notebook } = await readNotebookDocument(input.path);
  const cells = cellsOf(notebook);
  const fromIndex = requireCellIndex(cells, input.fromIndex, "fromIndex");
  if (!Number.isInteger(input.toIndex)) {
    throw new VaultError("INVALID_INPUT", '"toIndex" must be an integer.');
  }
  const toIndex = Math.min(Math.max(input.toIndex, 0), cells.length - 1);
  const [cell] = cells.splice(fromIndex, 1);
  cells.splice(toIndex, 0, cell!);
  await writeNotebookDocument(absolutePath, notebook);
  return notebookMutationResult(input.path, relativePath, notebook, { fromIndex, toIndex, action: "reorder" });
}

function notebookMutationResult(
  pagePath: string,
  notebookPath: string,
  notebook: NotebookDocument,
  mutation: Record<string, unknown>
) {
  const content = JSON.stringify(notebook);
  return {
    path: pagePath,
    notebookPath,
    cellCount: cellsOf(notebook).length,
    contentHash: createHash("sha256").update(content).digest("hex").slice(0, 16),
    mutation,
    hint:
      "Notebook file updated on disk. Jupyter owns the active runtime and may prompt to reload the open notebook before executing changed cells.",
  };
}

export const __testInternals = {
  normalizeSource,
  serializeOutputs,
  requireCellType,
  resolveCellSelector,
};
