import type { SpreadsheetWorkbook } from "@/lib/spreadsheet-workbook";

/**
 * Syncfusion 34.x only registers the workbookOpen/open modules when allowOpen is true.
 * With allowOpen=false, openFromJson is a silent no-op (SN-214) — vault JSON never paints.
 * Keep remote openUrl empty so the ribbon File→Open path stays disabled without a converter.
 */
export const SPREADSHEET_ALLOW_OPEN = true as const;

/** Args for SpreadsheetComponent.openFromJson after normalizeSpreadsheetWorkbook. */
export function toSpreadsheetOpenFromJsonArgs(workbook: SpreadsheetWorkbook) {
  return { file: workbook };
}
