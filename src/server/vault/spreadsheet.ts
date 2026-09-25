import fs from "node:fs/promises";
import path from "node:path";
import {
  createEmptySpreadsheetWorkbook,
  normalizeSpreadsheetWorkbook,
  type SpreadsheetWorkbook,
} from "@/lib/spreadsheet-workbook";
import { VaultError } from "./errors";
import { resolveVaultPath } from "./paths";

export const SPREADSHEET_SIDECAR_EXTENSION = ".spreadsheet.json";

export function spreadsheetSidecarAbsolutePath(pagePath: string) {
  const { absolutePath } = resolveVaultPath(pagePath, "page");
  return absolutePath.replace(/\.html$/i, SPREADSHEET_SIDECAR_EXTENSION);
}

async function renameFileAtomically(sourcePath: string, targetPath: string) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fs.rename(sourcePath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === "EPERM" || code === "EXDEV") && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      if (code === "EPERM" || code === "EXDEV") {
        await fs.copyFile(sourcePath, targetPath);
        await fs.rm(sourcePath, { force: true });
        return;
      }
      throw error;
    }
  }
}

async function writeAtomically(targetPath: string, content: string) {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  await fs.writeFile(temporaryPath, content, "utf8");
  try {
    await renameFileAtomically(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readSpreadsheetWorkbook(pagePath: string): Promise<SpreadsheetWorkbook> {
  try {
    const raw = await fs.readFile(spreadsheetSidecarAbsolutePath(pagePath), "utf8");
    return normalizeSpreadsheetWorkbook(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return createEmptySpreadsheetWorkbook();
    }
    throw error;
  }
}

export async function writeSpreadsheetWorkbook(pagePath: string, value: unknown) {
  let workbook: SpreadsheetWorkbook;
  try {
    workbook = normalizeSpreadsheetWorkbook(value);
  } catch {
    throw new VaultError(
      "INVALID_SPREADSHEET_WORKBOOK",
      "Spreadsheet data must be Syncfusion native workbook JSON.",
      400
    );
  }
  await writeAtomically(
    spreadsheetSidecarAbsolutePath(pagePath),
    `${JSON.stringify(workbook, null, 2)}\n`
  );
  return workbook;
}
