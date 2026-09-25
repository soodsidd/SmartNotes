export type SpreadsheetWorkbook = {
  Workbook: Record<string, unknown> & {
    activeSheetIndex?: number;
    sheets?: SpreadsheetSheet[];
  };
};

type SpreadsheetCell = {
  index?: number;
  value?: unknown;
  formula?: string;
  [key: string]: unknown;
};

type SpreadsheetRow = {
  index?: number;
  cells?: SpreadsheetCell[];
  [key: string]: unknown;
};

type SpreadsheetSheet = {
  name?: string;
  rows?: SpreadsheetRow[];
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createEmptySpreadsheetWorkbook(): SpreadsheetWorkbook {
  return {
    Workbook: {
      activeSheetIndex: 0,
      sheets: [{ name: "Sheet1", rows: [] }],
    },
  };
}

export function normalizeSpreadsheetWorkbook(value: unknown): SpreadsheetWorkbook {
  if (isRecord(value) && isRecord(value.Workbook)) {
    return value as SpreadsheetWorkbook;
  }

  // Syncfusion 34.2.2 saveAsJson() resolves with an API envelope shaped as
  // { jsonObject: { Workbook: ... } }, while openFromJson() consumes the
  // inner { Workbook: ... } model. Persist that inner native model so reads,
  // CSV adapters, versions, and legacy SN-208 sidecars share one shape.
  if (
    isRecord(value) &&
    isRecord(value.jsonObject) &&
    isRecord(value.jsonObject.Workbook)
  ) {
    return value.jsonObject as SpreadsheetWorkbook;
  }

  throw new Error("Spreadsheet data must be Syncfusion native workbook JSON.");
}

function inferCsvCell(raw: string): SpreadsheetCell {
  if (raw.startsWith("=")) return { formula: raw };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return { value: Number(raw) };
  if (/^(?:true|false)$/i.test(raw)) return { value: raw.toLowerCase() === "true" };
  return { value: raw };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0 || (text.length > 0 && !text.endsWith("\n"))) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function csvToSpreadsheetWorkbook(text: string, sheetName = "Sheet1"): SpreadsheetWorkbook {
  const rows = parseCsv(text).map((cells, index) => ({
    index,
    cells: cells.map((value, cellIndex) => ({ index: cellIndex, ...inferCsvCell(value) })),
  }));

  return {
    Workbook: {
      activeSheetIndex: 0,
      sheets: [{ name: sheetName, rows }],
    },
  };
}

function csvValue(cell: SpreadsheetCell | undefined) {
  if (!cell) return "";
  const value = cell.value ?? cell.formula ?? "";
  return String(value);
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function spreadsheetWorkbookToCsv(value: unknown, sheetIndex?: number): string {
  const workbook = normalizeSpreadsheetWorkbook(value).Workbook;
  const sheets = Array.isArray(workbook.sheets) ? workbook.sheets : [];
  const selectedIndex = sheetIndex ?? (typeof workbook.activeSheetIndex === "number" ? workbook.activeSheetIndex : 0);
  const sheet = sheets[selectedIndex] ?? sheets[0];
  const sourceRows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const rowMap = new Map<number, SpreadsheetRow>();
  let lastRow = -1;
  let lastColumn = -1;

  sourceRows.forEach((row, rowPosition) => {
    const rowIndex = typeof row.index === "number" ? row.index : rowPosition;
    rowMap.set(rowIndex, row);
    lastRow = Math.max(lastRow, rowIndex);
    (Array.isArray(row.cells) ? row.cells : []).forEach((cell, cellPosition) => {
      lastColumn = Math.max(lastColumn, typeof cell.index === "number" ? cell.index : cellPosition);
    });
  });

  if (lastRow < 0 || lastColumn < 0) return "";

  const output: string[] = [];
  for (let rowIndex = 0; rowIndex <= lastRow; rowIndex += 1) {
    const row = rowMap.get(rowIndex);
    const cellMap = new Map<number, SpreadsheetCell>();
    (Array.isArray(row?.cells) ? row.cells : []).forEach((cell, cellPosition) => {
      cellMap.set(typeof cell.index === "number" ? cell.index : cellPosition, cell);
    });
    const values: string[] = [];
    for (let cellIndex = 0; cellIndex <= lastColumn; cellIndex += 1) {
      values.push(escapeCsvCell(csvValue(cellMap.get(cellIndex))));
    }
    output.push(values.join(","));
  }
  return output.join("\r\n");
}
