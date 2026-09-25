"use client";

import "@/lib/syncfusion-license";

import * as React from "react";
import { AlertTriangle, FileDown, FileUp, Menu, Sheet } from "lucide-react";
import {
  SheetDirective,
  SheetsDirective,
  SpreadsheetComponent,
} from "@syncfusion/ej2-react-spreadsheet";
import { Button } from "@/components/ui/button";
import { fetchSpreadsheetWorkbook, saveSpreadsheetWorkbook } from "@/lib/api/spreadsheet";
import {
  csvToSpreadsheetWorkbook,
  normalizeSpreadsheetWorkbook,
  spreadsheetWorkbookToCsv,
} from "@/lib/spreadsheet-workbook";
import {
  SPREADSHEET_ALLOW_OPEN,
  toSpreadsheetOpenFromJsonArgs,
} from "@/lib/spreadsheet-open";
import { syncfusionLicenseRegistered } from "@/lib/syncfusion-license";
import { createSpreadsheetAutosaveController } from "@/lib/spreadsheet-autosave";

export interface SpreadsheetPageHandle {
  flush: () => Promise<void>;
  hasPendingChanges: () => boolean;
  pauseForExternalUpdate: () => void;
  discardPendingChanges: () => void;
}

export interface SpreadsheetPageViewProps {
  pagePath: string;
  title: string;
  readOnly?: boolean;
  previewWorkbookJson?: string;
  onOpenSidebar: () => void;
  onSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  handleRef?: React.Ref<SpreadsheetPageHandle>;
}

const AUTOSAVE_DELAY_MS = 800;

function safeFileStem(title: string) {
  return title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "Spreadsheet";
}

function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function SpreadsheetPageView({
  pagePath,
  title,
  readOnly = false,
  previewWorkbookJson,
  onOpenSidebar,
  onSaveStatusChange,
  handleRef,
}: SpreadsheetPageViewProps) {
  const spreadsheetRef = React.useRef<SpreadsheetComponent | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const hydratingRef = React.useRef(true);
  const persistRef = React.useRef<() => Promise<void>>(async () => undefined);
  const autosaveRef = React.useRef<ReturnType<typeof createSpreadsheetAutosaveController> | null>(null);
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [statusMessage, setStatusMessage] = React.useState("Opening workbook…");

  persistRef.current = async () => {
    if (readOnly || hydratingRef.current || !spreadsheetRef.current) return;
    onSaveStatusChange?.("saving");
    setStatusMessage("Saving…");
    try {
      const saved = await spreadsheetRef.current.saveAsJson();
      await saveSpreadsheetWorkbook(pagePath, saved);
      onSaveStatusChange?.("saved");
      setStatusMessage("Saved");
    } catch (error) {
      onSaveStatusChange?.("error");
      setStatusMessage(error instanceof Error ? error.message : "Workbook save failed");
      throw error;
    }
  };

  if (!autosaveRef.current) {
    autosaveRef.current = createSpreadsheetAutosaveController({
      delayMs: AUTOSAVE_DELAY_MS,
      save: () => persistRef.current(),
    });
  }

  const flush = React.useCallback(async () => {
    if (readOnly || hydratingRef.current) return;
    await autosaveRef.current?.flush();
  }, [readOnly]);

  React.useImperativeHandle(
    handleRef,
    () => ({
      flush,
      hasPendingChanges: () => autosaveRef.current?.hasPendingWork() ?? false,
      pauseForExternalUpdate: () => autosaveRef.current?.pauseForExternalUpdate(),
      discardPendingChanges: () => autosaveRef.current?.discardPendingChanges(),
    }),
    [flush]
  );

  const scheduleSave = React.useCallback(() => {
    if (readOnly || hydratingRef.current) return;
    autosaveRef.current?.markDirty();
    onSaveStatusChange?.("idle");
    setStatusMessage("Unsaved changes");
  }, [onSaveStatusChange, readOnly]);

  const handleCreated = React.useCallback(async () => {
    const spreadsheet = spreadsheetRef.current;
    if (!spreadsheet) return;
    hydratingRef.current = true;
    setLoadState("loading");
    try {
      const workbook = previewWorkbookJson
        ? normalizeSpreadsheetWorkbook(JSON.parse(previewWorkbookJson))
        : await fetchSpreadsheetWorkbook(pagePath);
      // allowOpen must be true or this is a silent no-op (SN-214).
      await Promise.resolve(spreadsheet.openFromJson(toSpreadsheetOpenFromJsonArgs(workbook)));
      setLoadState("ready");
      setStatusMessage(readOnly ? "Read-only version" : "Saved");
      onSaveStatusChange?.(readOnly ? "idle" : "saved");
    } catch (error) {
      setLoadState("error");
      setStatusMessage(error instanceof Error ? error.message : "Workbook failed to open");
      onSaveStatusChange?.("error");
    } finally {
      hydratingRef.current = false;
    }
  }, [onSaveStatusChange, pagePath, previewWorkbookJson, readOnly]);

  React.useEffect(() => {
    return () => {
      autosaveRef.current?.dispose();
    };
  }, []);

  const handleCsvImport = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !spreadsheetRef.current || readOnly) return;
      try {
        hydratingRef.current = true;
        const workbook = csvToSpreadsheetWorkbook(await file.text(), file.name.replace(/\.csv$/i, "") || "Sheet1");
        await Promise.resolve(
          spreadsheetRef.current.openFromJson(toSpreadsheetOpenFromJsonArgs(workbook))
        );
        hydratingRef.current = false;
        autosaveRef.current?.markDirty();
        await flush();
      } catch (error) {
        hydratingRef.current = false;
        onSaveStatusChange?.("error");
        setStatusMessage(error instanceof Error ? error.message : "CSV import failed");
      }
    },
    [flush, onSaveStatusChange, readOnly]
  );

  const handleCsvExport = React.useCallback(async () => {
    if (!spreadsheetRef.current) return;
    try {
      const workbook = await spreadsheetRef.current.saveAsJson();
      downloadCsv(`${safeFileStem(title)}.csv`, spreadsheetWorkbookToCsv(workbook));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "CSV export failed");
    }
  }, [title]);

  return (
    <section className="spreadsheet-page" data-testid="spreadsheet-page" aria-label={`${title} spreadsheet`}>
      <header className="spreadsheet-page__utility" data-print-chrome="true">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="Open sidebar"
          data-testid="spreadsheet-sidebar-toggle"
        >
          <Menu className="size-4" />
        </Button>
        <Sheet className="size-4 shrink-0 text-chart-2" aria-hidden />
        <span className="spreadsheet-page__title">{title}</span>
        <span className="spreadsheet-page__status" role="status">{statusMessage}</span>
        <div className="spreadsheet-page__actions">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => void handleCsvImport(event)}
            data-testid="spreadsheet-csv-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={readOnly || loadState !== "ready"}
            onClick={() => importInputRef.current?.click()}
            data-testid="spreadsheet-import-csv"
          >
            <FileUp className="size-3.5" />
            <span>Import CSV</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadState !== "ready"}
            onClick={() => void handleCsvExport()}
            data-testid="spreadsheet-export-csv"
          >
            <FileDown className="size-3.5" />
            <span>Export CSV</span>
          </Button>
          <span className="spreadsheet-page__xlsx-note" title="Full XLSX fidelity needs an optional local converter and is deferred from this MVP.">
            XLSX deferred
          </span>
        </div>
      </header>

      {!syncfusionLicenseRegistered ? (
        <div className="spreadsheet-page__warning" role="alert" data-testid="spreadsheet-license-warning">
          <AlertTriangle className="size-4 shrink-0" />
          Syncfusion Community License key is missing from this build.
        </div>
      ) : null}

      <div className="spreadsheet-page__canvas" data-testid="spreadsheet-canvas" data-load-state={loadState}>
        <SpreadsheetComponent
          ref={spreadsheetRef}
          height="100%"
          width="100%"
          allowEditing={!readOnly}
          allowOpen={SPREADSHEET_ALLOW_OPEN}
          allowSave
          showFormulaBar
          showRibbon
          showSheetTabs
          created={() => void handleCreated()}
          actionComplete={scheduleSave}
        >
          <SheetsDirective>
            <SheetDirective name="Sheet1" />
          </SheetsDirective>
        </SpreadsheetComponent>
      </div>
    </section>
  );
}
