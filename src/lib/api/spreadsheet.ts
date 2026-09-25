import { vaultWriteFetch } from "@/lib/connection-status";
import { normalizeSpreadsheetWorkbook, type SpreadsheetWorkbook } from "@/lib/spreadsheet-workbook";
import { ApiError } from "./pages";

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    workbook?: unknown;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new ApiError(payload.error ?? response.statusText, response.status, payload.code ?? "API_ERROR");
  }
  return payload;
}

export async function fetchSpreadsheetWorkbook(path: string): Promise<SpreadsheetWorkbook> {
  const response = await fetch(`/api/page/spreadsheet?path=${encodeURIComponent(path)}`, {
    cache: "no-store",
  });
  const payload = await readJson(response);
  return normalizeSpreadsheetWorkbook(payload.workbook);
}

export async function saveSpreadsheetWorkbook(path: string, workbook: unknown) {
  const response = await vaultWriteFetch("/api/page/spreadsheet", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, workbook }),
  });
  const payload = await readJson(response);
  return normalizeSpreadsheetWorkbook(payload.workbook);
}
