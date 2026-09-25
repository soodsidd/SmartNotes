"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  History,
  LoaderCircle,
  PenLine,
  Plus,
  SquareArrowOutUpRight,
  Table2,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { JsonFormsCore } from "@jsonforms/core";
import { io, type Socket } from "socket.io-client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LogJsonForms } from "@/components/log-jsonforms";
import { LogHistoryView } from "@/components/log-history-view";
import { cn } from "@/lib/utils";
import {
  appendLogRow,
  deleteLogRow,
  fetchLogDocument,
  focusedLogHistoryUrl,
  focusedLogUrl,
  saveLogForm,
  updateLogRow,
} from "@/lib/api/log";
import {
  missingRequiredFields,
  type LogDocument,
  type LogField,
  type LogRow,
  type LogValue,
} from "@/lib/log-contract";
import {
  defaultLogFormDefinition,
  initializeFormData,
  parseLogFormSource,
  serializeLogFormSource,
  type LogFormDefinition,
} from "@/lib/log-form-contract";
import {
  applyLogHistorySuggestion,
  findLogHistorySuggestion,
  type LogHistorySuggestion,
} from "@/lib/log-history-suggestion";
import {
  acceptFocusedLogEntry,
  clearFocusedLogDraft,
  emptyFocusedLogState,
  flushFocusedLogOutbox,
  focusedLogStorageKey,
  mergeFocusedLogDocument,
  mergeFocusedLogStates,
  readFocusedLogStateResult,
  saveFocusedLogDraft,
  saveFocusedLogSnapshot,
  writeFocusedLogState,
  type FocusedLogLocalState,
} from "@/lib/focused-log-local-state";

export interface LogPageViewProps {
  pagePath: string;
  title?: string;
  /** Leading slot in the header bar (e.g. sidebar toggle or back link). */
  leading?: React.ReactNode;
  /** Trailing slot in the header bar (e.g. install-to-home-screen button). */
  trailing?: React.ReactNode;
  /** Notebook-hosted bridge into the focused shell where local-first behavior lives. */
  focusedShellHref?: string;
  /** Enables the focused shortcut's device-local draft and submit outbox. */
  focusedLocalFirst?: boolean;
  /** Initial focused-shell tab resolved from the stable URL. */
  initialTab?: "form" | "history" | "table" | "source";
  /** Initial named History view resolved from the stable URL. */
  initialViewId?: string | null;
  className?: string;
}

type Tab = "form" | "history" | "table" | "source";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; document: LogDocument; form: LogFormDefinition }
  | { phase: "error"; message: string };

type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

const FOCUSED_DRAFT_DEBOUNCE_MS = 400;
const FOCUSED_SYNC_RETRY_MS = 5_000;

function displayValue(field: LogField, value: LogValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ImageCell({ value }: { value: LogValue }) {
  const urls = (Array.isArray(value) ? value : [value]).filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.startsWith("/vault/")
  );
  return urls.length ? (
    <div className="flex flex-wrap gap-1.5" data-testid="log-image-cell">
      {urls.map((url) => <img key={url} src={url} alt="" className="size-10 rounded border border-border object-cover" />)}
    </div>
  ) : <span>—</span>;
}

function historyValueText(value: LogValue): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function historyDateLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Previous entry";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
}

function LogHistorySuggestionCard({
  suggestion,
  onCopyAll,
  onCopyField,
}: {
  suggestion: LogHistorySuggestion;
  onCopyAll: () => void;
  onCopyField: (fieldId: string, label: string) => void;
}) {
  const headingId = React.useId();
  return (
    <section
      data-testid="log-history-suggestion"
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface p-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <History className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-foreground">
              Latest match
            </h2>
            <p className="text-xs text-muted-foreground">
              From <time dateTime={suggestion.createdAt}>{historyDateLabel(suggestion.createdAt)}</time>.
              Nothing changes until you copy it.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          data-testid="log-history-copy-all"
          onClick={onCopyAll}
          className="min-h-11 w-full sm:min-h-7 sm:w-auto"
        >
          <Copy className="size-3.5" aria-hidden="true" />
          Copy all
        </Button>
      </div>
      <dl className="mt-3 divide-y divide-border/60 border-t border-border/60">
        {suggestion.values.map((item) => (
          <div
            key={item.fieldId}
            className="flex min-w-0 flex-col gap-2 py-2.5 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm text-foreground [overflow-wrap:anywhere]">
                {historyValueText(item.value)}
              </dd>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`log-history-copy-${item.fieldId}`}
              aria-label={`Copy previous ${item.label}`}
              onClick={() => onCopyField(item.fieldId, item.label)}
              className="min-h-11 w-full sm:min-h-7 sm:w-auto"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              Copy
            </Button>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A typed input for one schema field in the Table editor. */
function FieldInput({
  field,
  value,
  onChange,
  testIdPrefix,
  autoFocus,
}: {
  field: LogField;
  value: LogValue;
  onChange: (next: LogValue) => void;
  testIdPrefix: string;
  autoFocus?: boolean;
}) {
  const testId = `${testIdPrefix}-${field.id}`;
  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        data-testid={testId}
        checked={value === true}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--accent)]"
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        data-testid={testId}
        value={value === null || value === undefined ? "" : String(value)}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">Select…</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <Textarea
        data-testid={testId}
        value={JSON.stringify(value, null, 2)}
        autoFocus={autoFocus}
        onChange={(event) => {
          try {
            onChange(JSON.parse(event.target.value) as object);
          } catch {
            onChange(event.target.value);
          }
        }}
        className="min-h-16 font-mono text-xs"
      />
    );
  }
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
  return (
    <Input
      type={inputType}
      data-testid={testId}
      value={value === null || value === undefined ? "" : String(value)}
      autoFocus={autoFocus}
      onChange={(event) =>
        onChange(
          field.type === "number"
            ? event.target.value === ""
              ? null
              : Number(event.target.value)
            : event.target.value
        )
      }
      placeholder={field.name}
    />
  );
}

/**
 * Form | History | Table | Source view over a log page.
 * Form appends, History reads, Table corrects rows, and Source edits the script.
 * Rows persist in `.log.json`; the script lives in `.form.json`.
 */
export function LogPageView({
  pagePath,
  title,
  leading,
  trailing,
  focusedShellHref,
  focusedLocalFirst = false,
  initialTab,
  initialViewId = null,
  className,
}: LogPageViewProps) {
  const [state, setState] = React.useState<LoadState>({ phase: "loading" });
  const [tab, setTab] = React.useState<Tab>(
    initialViewId ? "history" : initialTab ?? "form"
  );
  const [historyViewId, setHistoryViewId] = React.useState<string | null>(initialViewId);
  const [formData, setFormData] = React.useState<Record<string, unknown>>({});
  const [formErrors, setFormErrors] = React.useState<JsonFormsCore["errors"]>([]);
  const [showFormErrors, setShowFormErrors] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = React.useState<DraftSaveStatus>("idle");
  const [focusedState, setFocusedState] = React.useState<FocusedLogLocalState | null>(null);
  const [editingRowId, setEditingRowId] = React.useState<string | null>(null);
  const [editValues, setEditValues] = React.useState<Record<string, LogValue>>({});
  const [sourceText, setSourceText] = React.useState("");
  const [savingSource, setSavingSource] = React.useState(false);
  const localStateRef = React.useRef<FocusedLogLocalState | null>(null);
  const localStorageWritableRef = React.useRef(true);
  const mountedRef = React.useRef(true);
  const viewRef = React.useRef<{ document: LogDocument; form: LogFormDefinition } | null>(null);
  const formDataRef = React.useRef<Record<string, unknown>>({});
  const sourceTextRef = React.useRef("");
  const sourceBaseTextRef = React.useRef("");
  const sourceDirtyRef = React.useRef(false);
  const draftPendingRef = React.useRef(false);
  const draftTimerRef = React.useRef<number | null>(null);
  const retryTimerRef = React.useRef<number | null>(null);
  const flushInFlightRef = React.useRef(false);
  const flushRef = React.useRef<() => Promise<void>>(async () => undefined);
  const tabRefs = React.useRef<Record<Tab, HTMLButtonElement | null>>({
    form: null,
    history: null,
    table: null,
    source: null,
  });
  const tabPanelId = React.useId();

  const document = state.phase === "ready" ? state.document : null;
  const form = state.phase === "ready" ? state.form : null;
  const fields = document?.schema.fields ?? [];
  const rows = document?.rows ?? [];
  const historySuggestion = React.useMemo(
    () => form
      ? findLogHistorySuggestion(
          form.historySuggestion,
          form.schema,
          formData,
          rows
        )
      : null,
    [form, formData, rows]
  );
  const pendingRowIds = React.useMemo(
    () => new Set(focusedState?.outbox.map((entry) => entry.row.id) ?? []),
    [focusedState]
  );

  const setReadyView = React.useCallback((nextDocument: LogDocument, nextForm: LogFormDefinition) => {
    if (!mountedRef.current) return;
    viewRef.current = { document: nextDocument, form: nextForm };
    setState({ phase: "ready", document: nextDocument, form: nextForm });
  }, []);

  const persistFocusedState = React.useCallback((next: FocusedLogLocalState) => {
    if (!localStorageWritableRef.current) {
      throw new Error("Focused log storage is unreadable");
    }
    const merged = writeFocusedLogState(window.localStorage, next);
    localStateRef.current = merged;
    if (mountedRef.current) setFocusedState(merged);
  }, []);

  const replaceSourceText = React.useCallback((next: string, preserveFocusedDirty = false) => {
    if (focusedLocalFirst && preserveFocusedDirty && sourceDirtyRef.current) {
      sourceBaseTextRef.current = next;
      sourceDirtyRef.current = sourceTextRef.current !== next;
      return;
    }
    sourceTextRef.current = next;
    sourceBaseTextRef.current = next;
    sourceDirtyRef.current = false;
    if (mountedRef.current) setSourceText(next);
  }, [focusedLocalFirst]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    setState({ phase: "loading" });
    const localRead = focusedLocalFirst && typeof window !== "undefined"
      ? readFocusedLogStateResult(window.localStorage, pagePath)
      : null;
    localStorageWritableRef.current = localRead?.status !== "unreadable";
    const local = localRead?.state ?? null;
    localStateRef.current = local;
    setFocusedState(local);
    if (local) {
      setDraftSaveStatus(local.draft ? "saved" : "idle");
    } else if (localRead?.status === "unreadable") {
      setDraftSaveStatus("error");
    }
    try {
      const response = await fetchLogDocument(pagePath);
      const nextForm = response.form ?? defaultLogFormDefinition();
      const remoteDocument: LogDocument = {
        version: response.version,
        schema: response.schema,
        rows: response.rows,
      };
      const nextDocument = local ? mergeFocusedLogDocument(remoteDocument, local.outbox) : remoteDocument;
      setReadyView(nextDocument, nextForm);
      const nextData = initializeFormData(nextForm.schema, local?.draft?.values);
      formDataRef.current = nextData;
      setFormData(nextData);
      if (localRead?.status !== "unreadable") setDraftSaveStatus(local?.draft ? "saved" : "idle");
      setFormErrors([]);
      setShowFormErrors(false);
      replaceSourceText(serializeLogFormSource(nextForm));
      if (local) {
        try {
          persistFocusedState(saveFocusedLogSnapshot(local, remoteDocument, nextForm));
        } catch {
          // The fetched view is still usable; draft writes report storage failures separately.
        }
      }
    } catch (error) {
      if (local?.snapshot) {
        const snapshotDocument = mergeFocusedLogDocument(local.snapshot.document, local.outbox);
        setReadyView(snapshotDocument, local.snapshot.form);
        const nextData = initializeFormData(
          local.snapshot.form.schema,
          local.draft?.values
        );
        formDataRef.current = nextData;
        setFormData(nextData);
        setDraftSaveStatus(local.draft ? "saved" : "idle");
        setFormErrors([]);
        setShowFormErrors(false);
        replaceSourceText(serializeLogFormSource(local.snapshot.form));
        return;
      }
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Failed to load this log.",
      });
    }
  }, [focusedLocalFirst, pagePath, persistFocusedState, replaceSourceText, setReadyView]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refreshFocusedFromServer = React.useCallback(async () => {
    if (!focusedLocalFirst) return;
    const response = await fetchLogDocument(pagePath);
    const nextForm = response.form ?? defaultLogFormDefinition();
    const remoteDocument: LogDocument = {
      version: response.version,
      schema: response.schema,
      rows: response.rows,
    };
    const local = localStateRef.current ?? emptyFocusedLogState(pagePath);
    setReadyView(mergeFocusedLogDocument(remoteDocument, local.outbox), nextForm);
    replaceSourceText(serializeLogFormSource(nextForm), true);
    try {
      persistFocusedState(saveFocusedLogSnapshot(local, remoteDocument, nextForm));
    } catch {
      // A remote refresh must never replace the in-memory draft when storage is unavailable.
    }
  }, [focusedLocalFirst, pagePath, persistFocusedState, replaceSourceText, setReadyView]);

  const flushOutbox = React.useCallback(async () => {
    if (!focusedLocalFirst || flushInFlightRef.current) return;
    const initial = localStateRef.current;
    if (!initial || initial.outbox.length === 0) return;
    flushInFlightRef.current = true;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    let drainedBeforeRefresh = false;
    try {
      const flushed = await flushFocusedLogOutbox(initial, {
        post: async (row) => {
          await appendLogRow(pagePath, row.values, row);
        },
        persist: persistFocusedState,
        getLatest: () => localStateRef.current ?? initial,
      });
      drainedBeforeRefresh = flushed.outbox.length === 0;
      if (flushed.outbox.length > 0) {
        if (mountedRef.current) {
          retryTimerRef.current = window.setTimeout(() => void flushRef.current(), FOCUSED_SYNC_RETRY_MS);
        }
      }
      try {
        await refreshFocusedFromServer();
      } catch {
        const currentView = viewRef.current;
        if (currentView) {
          setReadyView(mergeFocusedLogDocument(currentView.document, flushed.outbox), currentView.form);
        }
      }
    } finally {
      flushInFlightRef.current = false;
      if (mountedRef.current && drainedBeforeRefresh && (localStateRef.current?.outbox.length ?? 0) > 0) {
        void flushRef.current();
      }
    }
  }, [focusedLocalFirst, pagePath, persistFocusedState, refreshFocusedFromServer, setReadyView]);

  React.useEffect(() => {
    flushRef.current = flushOutbox;
  }, [flushOutbox]);

  React.useEffect(() => {
    if (focusedLocalFirst && state.phase === "ready" && (focusedState?.outbox.length ?? 0) > 0) {
      void flushRef.current();
    }
  }, [focusedLocalFirst, focusedState?.outbox.length, state.phase]);

  const persistCurrentDraft = React.useCallback(() => {
    if (!focusedLocalFirst || !draftPendingRef.current) return;
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    try {
      const local = localStateRef.current ?? emptyFocusedLogState(pagePath);
      persistFocusedState(saveFocusedLogDraft(local, formDataRef.current));
      draftPendingRef.current = false;
      setDraftSaveStatus("saved");
    } catch {
      setDraftSaveStatus("error");
      toast.error("Couldn’t save draft");
    }
  }, [focusedLocalFirst, pagePath, persistFocusedState]);

  const handleFormChange = React.useCallback((
    next: Record<string, unknown>,
    errors: JsonFormsCore["errors"]
  ) => {
    const changed = JSON.stringify(next) !== JSON.stringify(formDataRef.current);
    formDataRef.current = next;
    setFormData(next);
    setFormErrors(errors);
    if (!focusedLocalFirst || !changed) return;
    draftPendingRef.current = true;
    setDraftSaveStatus("saving");
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(persistCurrentDraft, FOCUSED_DRAFT_DEBOUNCE_MS);
  }, [focusedLocalFirst, persistCurrentDraft]);

  const copyHistoryValues = React.useCallback((
    suggestion: LogHistorySuggestion,
    fieldId?: string,
    label?: string
  ) => {
    const next = fieldId
      ? applyLogHistorySuggestion(formDataRef.current, suggestion, [fieldId])
      : applyLogHistorySuggestion(formDataRef.current, suggestion);
    handleFormChange(next, formErrors);
    toast.success(fieldId && label ? `${label} copied from latest match` : "Latest values copied");
  }, [formErrors, handleFormChange]);

  React.useEffect(() => {
    if (!focusedLocalFirst) return;
    const handleVisibility = () => {
      if (window.document.visibilityState === "hidden") persistCurrentDraft();
      if (window.document.visibilityState === "visible") {
        void refreshFocusedFromServer().catch(() => undefined);
        void flushRef.current();
      }
    };
    const handlePageHide = () => persistCurrentDraft();
    const handleOnline = () => {
      void refreshFocusedFromServer().catch(() => undefined);
      void flushRef.current();
    };
    window.document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    return () => {
      window.document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
    };
  }, [focusedLocalFirst, persistCurrentDraft, refreshFocusedFromServer]);

  React.useEffect(() => {
    if (!focusedLocalFirst) return;
    const socket: Socket = io();
    const reconcile = () => {
      void refreshFocusedFromServer().catch(() => undefined);
      void flushRef.current();
    };
    const handleFileUpdated = (payload: { path?: string }) => {
      if (payload?.path === pagePath) reconcile();
    };
    socket.on("connect", reconcile);
    socket.on("file_updated", handleFileUpdated);
    return () => {
      socket.off("connect", reconcile);
      socket.off("file_updated", handleFileUpdated);
      socket.disconnect();
    };
  }, [focusedLocalFirst, pagePath, refreshFocusedFromServer]);

  React.useEffect(() => {
    if (!focusedLocalFirst) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== focusedLogStorageKey(pagePath)) return;
      const external = readFocusedLogStateResult(window.localStorage, pagePath);
      if (external.status !== "ready") return;
      const previous = localStateRef.current ?? emptyFocusedLogState(pagePath);
      const hadPendingDraft = draftPendingRef.current;
      const pendingValues = hadPendingDraft ? formDataRef.current : null;
      let merged = mergeFocusedLogStates(previous, external.state);
      if (hadPendingDraft && pendingValues) {
        if (draftTimerRef.current !== null) {
          window.clearTimeout(draftTimerRef.current);
          draftTimerRef.current = null;
        }
        try {
          persistFocusedState(saveFocusedLogDraft(merged, pendingValues));
          merged = localStateRef.current ?? merged;
          draftPendingRef.current = false;
          setDraftSaveStatus("saved");
        } catch {
          setDraftSaveStatus("error");
        }
      }
      localStateRef.current = merged;
      setFocusedState(merged);
      if (!hadPendingDraft && merged.draft && merged.draft.updatedAt > (previous.draft?.updatedAt ?? "")) {
        formDataRef.current = merged.draft.values;
        setFormData(merged.draft.values);
        setDraftSaveStatus("saved");
      }
      const currentView = viewRef.current;
      if (currentView) {
        setReadyView(mergeFocusedLogDocument(currentView.document, merged.outbox), currentView.form);
      }
      if (merged.outbox.length > 0) void flushRef.current();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [focusedLocalFirst, pagePath, persistFocusedState, setReadyView]);

  React.useEffect(() => () => {
    persistCurrentDraft();
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
  }, [persistCurrentDraft]);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!document || !form) return;
      setShowFormErrors(true);
      if (formErrors && formErrors.length > 0) {
        toast.error("Fix form validation errors before adding an entry");
        return;
      }
      const missing = missingRequiredFields(
        document.schema.fields,
        formData as Record<string, LogValue>
      );
      if (missing.length > 0) {
        toast.error(
          `Fill in required field${missing.length > 1 ? "s" : ""}: ${missing.map((f) => f.name).join(", ")}`
        );
        return;
      }
      setSubmitting(true);
      if (focusedLocalFirst) {
        try {
          if (draftTimerRef.current !== null) {
            window.clearTimeout(draftTimerRef.current);
            draftTimerRef.current = null;
          }
          const local = localStateRef.current ?? emptyFocusedLogState(pagePath);
          const accepted = acceptFocusedLogEntry(local, formData as Record<string, LogValue>);
          persistFocusedState(accepted.state);
          const optimistic = mergeFocusedLogDocument(document, accepted.state.outbox);
          setReadyView(optimistic, form);
          const initialized = initializeFormData(form.schema);
          formDataRef.current = initialized;
          setFormData(initialized);
          setFormErrors([]);
          setShowFormErrors(false);
          draftPendingRef.current = false;
          setDraftSaveStatus("idle");
          toast.success("Entry saved on this device");
          void flushRef.current();
        } catch {
          setDraftSaveStatus("error");
          toast.error("Couldn’t save entry on this device");
        } finally {
          setSubmitting(false);
        }
        return;
      }
      try {
        const response = await appendLogRow(pagePath, formData as Record<string, LogValue>);
        setState({
          phase: "ready",
          document: {
            version: response.version,
            schema: response.schema,
            rows: response.rows,
          },
          form: response.form ?? form,
        });
        const initialized = initializeFormData((response.form ?? form).schema);
        formDataRef.current = initialized;
        setFormData(initialized);
        setFormErrors([]);
        setShowFormErrors(false);
        toast.success("Entry added");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to add entry");
      } finally {
        setSubmitting(false);
      }
    },
    [document, focusedLocalFirst, form, formData, formErrors, pagePath, persistFocusedState, setReadyView]
  );

  const startEditRow = React.useCallback((row: LogRow) => {
    setEditingRowId(row.id);
    setEditValues({ ...row.values });
  }, []);

  const cancelEdit = React.useCallback(() => {
    setEditingRowId(null);
    setEditValues({});
  }, []);

  const saveEditRow = React.useCallback(
    async (rowId: string) => {
      if (!form) return;
      try {
        const response = await updateLogRow(pagePath, rowId, editValues);
        const savedDocument: LogDocument = {
          version: response.version,
          schema: response.schema,
          rows: response.rows,
        };
        const local = focusedLocalFirst ? localStateRef.current : null;
        setReadyView(
          local ? mergeFocusedLogDocument(savedDocument, local.outbox) : savedDocument,
          response.form ?? form
        );
        setEditingRowId(null);
        setEditValues({});
        toast.success("Row updated");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update row");
      }
    },
    [editValues, focusedLocalFirst, form, pagePath, setReadyView]
  );

  const removeRow = React.useCallback(
    async (rowId: string) => {
      if (!form) return;
      try {
        const response = await deleteLogRow(pagePath, rowId);
        const savedDocument: LogDocument = {
          version: response.version,
          schema: response.schema,
          rows: response.rows,
        };
        const local = focusedLocalFirst ? localStateRef.current : null;
        setReadyView(
          local ? mergeFocusedLogDocument(savedDocument, local.outbox) : savedDocument,
          response.form ?? form
        );
        toast.success("Row deleted");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to delete row");
      }
    },
    [focusedLocalFirst, form, pagePath, setReadyView]
  );

  const openSourceTab = React.useCallback(() => {
    if (form && !(focusedLocalFirst && sourceDirtyRef.current)) {
      replaceSourceText(serializeLogFormSource(form));
    }
    setTab("source");
  }, [focusedLocalFirst, form, replaceSourceText]);

  const syncFocusedUrl = React.useCallback((nextTab: Tab, viewId: string | null = historyViewId) => {
    if (!focusedLocalFirst || typeof window === "undefined") return;
    const nextUrl = nextTab === "history"
      ? focusedLogHistoryUrl(pagePath, viewId ?? undefined)
      : nextTab === "form"
        ? focusedLogUrl(pagePath)
        : `${focusedLogUrl(pagePath)}&tab=${nextTab}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [focusedLocalFirst, historyViewId, pagePath]);

  const selectTab = React.useCallback((nextTab: Tab) => {
    if (nextTab === "source") {
      openSourceTab();
    } else {
      setTab(nextTab);
    }
    syncFocusedUrl(nextTab);
  }, [openSourceTab, syncFocusedUrl]);

  const selectHistoryView = React.useCallback((viewId: string | null) => {
    setHistoryViewId(viewId);
    syncFocusedUrl("history", viewId);
  }, [syncFocusedUrl]);

  const onTabKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const tabs: Tab[] = ["form", "history", "table", "source"];
    const currentIndex = tabs.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }, [selectTab]);

  const discardDraft = React.useCallback(() => {
    if (!focusedLocalFirst || !form) return;
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    try {
      const local = localStateRef.current ?? emptyFocusedLogState(pagePath);
      persistFocusedState(clearFocusedLogDraft(local));
      const initialized = initializeFormData(form.schema);
      formDataRef.current = initialized;
      setFormData(initialized);
      setFormErrors([]);
      setShowFormErrors(false);
      draftPendingRef.current = false;
      setDraftSaveStatus("idle");
    } catch {
      setDraftSaveStatus("error");
      toast.error("Couldn’t discard draft");
    }
  }, [focusedLocalFirst, form, pagePath, persistFocusedState]);

  const saveSource = React.useCallback(async () => {
    setSavingSource(true);
    try {
      const parsed = parseLogFormSource(sourceText);
      const response = await saveLogForm(pagePath, parsed);
      const nextForm = response.form ?? parsed;
      const savedDocument: LogDocument = {
        version: response.version,
        schema: response.schema,
        rows: response.rows,
      };
      const local = focusedLocalFirst
        ? localStateRef.current ?? emptyFocusedLogState(pagePath)
        : null;
      setReadyView(
        local ? mergeFocusedLogDocument(savedDocument, local.outbox) : savedDocument,
        nextForm
      );
      if (local) {
        try {
          persistFocusedState(saveFocusedLogSnapshot(local, savedDocument, nextForm));
        } catch {
          // The in-memory draft and pending rows remain authoritative until storage recovers.
        }
      }
      const nextData = initializeFormData(
        nextForm.schema,
        focusedLocalFirst ? formDataRef.current : undefined
      );
      formDataRef.current = nextData;
      setFormData(nextData);
      setFormErrors([]);
      replaceSourceText(serializeLogFormSource(nextForm));
      toast.success("Form source saved");
      setTab("form");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save form source");
    } finally {
      setSavingSource(false);
    }
  }, [focusedLocalFirst, pagePath, persistFocusedState, replaceSourceText, setReadyView, sourceText]);

  return (
    <div className={cn("flex h-full w-full flex-col bg-background", className)}>
      {/* Header bar: slots + tabs */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-2 backdrop-blur-sm">
        {leading}
        <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Log
        </span>
        {title ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
        ) : null}
        {trailing ? <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div> : null}
      </div>

      {focusedShellHref ? (
        <div
          data-testid="log-focused-bridge"
          className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-accent/5 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">Autosave + offline submit</p>
            <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
              Use the focused log to keep drafts and queue entries on this device.
            </p>
          </div>
          <a
            href={focusedShellHref}
            data-testid="log-open-focused"
            className={buttonVariants({ variant: "default", size: "sm" })}
          >
            <SquareArrowOutUpRight className="size-3.5" />
            Open focused log
          </a>
        </div>
      ) : null}

      {/* Peer-view tab strip. Roving focus follows the ARIA tabs keyboard pattern. */}
      <div
        role="tablist"
        aria-label="Log views"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2 py-1.5"
      >
        {([
          { id: "form" as const, label: "Form", icon: PenLine },
          { id: "history" as const, label: "History", icon: History },
          { id: "table" as const, label: "Table", icon: Table2 },
          { id: "source" as const, label: "Source", icon: Code2 },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            ref={(node) => { tabRefs.current[id] = node; }}
            type="button"
            id={`${tabPanelId}-${id}-tab`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={tabPanelId}
            tabIndex={tab === id ? 0 : -1}
            data-testid={`log-tab-${id}`}
            onClick={() => selectTab(id)}
            onKeyDown={(event) => onTabKeyDown(event, id)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:px-3",
              tab === id ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-surface hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
            {id === "table" && rows.length > 0 ? (
              <span className="ml-0.5 rounded-full bg-surface px-1.5 text-[11px] text-muted-foreground">
                {rows.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        id={tabPanelId}
        role="tabpanel"
        aria-labelledby={`${tabPanelId}-${tab}-tab`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {state.phase === "loading" ? (
          <div data-testid="log-loading" className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin text-accent" />
            <span className="text-sm">Loading log…</span>
          </div>
        ) : state.phase === "error" ? (
          <div data-testid="log-error" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : tab === "history" && form ? (
          <LogHistoryView
            pagePath={pagePath}
            document={state.document}
            form={form}
            requestedViewId={historyViewId}
            onViewChange={selectHistoryView}
            onOpenForm={() => selectTab("form")}
          />
        ) : tab === "source" ? (
          <div data-testid="log-source-editor" className="mx-auto flex h-full max-w-3xl flex-col gap-3 p-4">
            <p className="text-xs text-muted-foreground">
              JSON Forms script (`schema` + `uischema`) for this log. Optional `historySuggestion`,
              named `views`, and safe `open-history` actions stay declarative. Saving projects columns
              into Table and re-renders Form and History.
            </p>
            <Textarea
              data-testid="log-source-textarea"
              value={sourceText}
              onChange={(event) => {
                const next = event.target.value;
                sourceTextRef.current = next;
                if (focusedLocalFirst) sourceDirtyRef.current = next !== sourceBaseTextRef.current;
                setSourceText(next);
              }}
              spellCheck={false}
              className="min-h-[24rem] flex-1 font-mono text-xs leading-relaxed"
            />
            <div className="flex items-center gap-2">
              <Button data-testid="log-source-save" onClick={() => void saveSource()} disabled={savingSource}>
                {savingSource ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save source
              </Button>
              <Button
                variant="ghost"
                disabled={savingSource || !form}
                onClick={() => form && replaceSourceText(serializeLogFormSource(form))}
              >
                Reset
              </Button>
            </div>
          </div>
        ) : tab === "form" && form ? (
          <form
            data-testid="log-form"
            onSubmit={handleSubmit}
            onBlur={focusedLocalFirst ? persistCurrentDraft : undefined}
            className="mx-auto flex max-w-2xl flex-col gap-4 p-4"
          >
            {focusedLocalFirst ? (
              <div className="flex min-h-6 items-center gap-2 text-xs" data-testid="log-draft-status">
                <span role="status" aria-live="polite" className="contents">
                  {draftSaveStatus === "saving" ? (
                    <>
                      <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Saving…</span>
                    </>
                  ) : draftSaveStatus === "saved" ? (
                    <>
                      <Check className="size-3.5 text-accent" />
                      <span className="text-muted-foreground">Saved (draft)</span>
                    </>
                  ) : draftSaveStatus === "error" ? (
                    <>
                      <X className="size-3.5 text-destructive" />
                      <span className="text-destructive">Couldn’t save draft</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Draft saves on this device</span>
                  )}
                </span>
                {(focusedState?.draft || draftPendingRef.current) ? (
                  <button
                    type="button"
                    data-testid="log-draft-clear"
                    onClick={discardDraft}
                    className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Clear draft
                  </button>
                ) : null}
              </div>
            ) : null}
            {historySuggestion ? (
              <LogHistorySuggestionCard
                suggestion={historySuggestion}
                onCopyAll={() => copyHistoryValues(historySuggestion)}
                onCopyField={(fieldId, label) => copyHistoryValues(historySuggestion, fieldId, label)}
              />
            ) : null}
            {form.actions?.length ? (
              <nav
                aria-label="Related History views"
                data-testid="log-form-history-actions"
                className="flex flex-wrap gap-2"
              >
                {form.actions.map((action) => (
                  <a
                    key={`${action.view}-${action.label}`}
                    href={focusedLogHistoryUrl(pagePath, action.view)}
                    data-testid={`log-form-history-action-${action.view}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 sm:min-h-8")}
                  >
                    <History className="size-3.5" aria-hidden="true" />
                    {action.label}
                    <SquareArrowOutUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                ))}
              </nav>
            ) : null}
            <LogJsonForms
              form={form}
              data={formData}
              validationMode={showFormErrors ? "ValidateAndShow" : "ValidateAndHide"}
              onChange={handleFormChange}
            />
            <Button type="submit" data-testid="log-submit" disabled={submitting} className="mt-1 self-start">
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Add entry
            </Button>
          </form>
        ) : rows.length === 0 ? (
          <div data-testid="log-empty" className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <Table2 className="size-6" />
            <p className="text-sm">No entries yet. Add one from the Form tab.</p>
          </div>
        ) : (
          <div className="p-2">
            <table data-testid="log-table" className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  {fields.map((field) => (
                    <th key={field.id} className="px-2 py-1.5 font-medium text-muted-foreground">
                      {field.name}
                    </th>
                  ))}
                  <th className="w-16 px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const editing = editingRowId === row.id;
                  return (
                    <tr key={row.id} data-testid={`log-row-${row.id}`} className="border-b border-border/60 last:border-0 align-top">
                      {fields.map((field) => (
                        <td key={field.id} className="px-2 py-1.5 text-foreground">
                          {editing ? (
                            <FieldInput
                              field={field}
                              value={editValues[field.id] ?? (field.type === "boolean" ? false : null)}
                              onChange={(next) => setEditValues((prev) => ({ ...prev, [field.id]: next }))}
                              testIdPrefix="log-edit-input"
                            />
                          ) : (
                            <span data-testid={`log-cell-${row.id}-${field.id}`}>
                              {field.type === "image" || field.type === "image-sequence"
                                ? <ImageCell value={row.values[field.id]} />
                                : displayValue(field, row.values[field.id])}
                            </span>
                          )}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          {focusedLocalFirst && pendingRowIds.has(row.id) ? (
                            <span
                              data-testid={`log-row-pending-${row.id}`}
                              className="whitespace-nowrap font-mono text-[10px] text-muted-foreground"
                            >
                              pending sync
                            </span>
                          ) : editing ? (
                            <>
                              <Button variant="ghost" size="icon-xs" data-testid={`log-row-save-${row.id}`} onClick={() => void saveEditRow(row.id)} aria-label="Save row">
                                <Check className="size-3.5 text-accent" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={cancelEdit} aria-label="Cancel edit">
                                <X className="size-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon-xs" data-testid={`log-row-edit-${row.id}`} onClick={() => startEditRow(row)} aria-label="Edit row">
                                <PenLine className="size-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon-xs" data-testid={`log-row-delete-${row.id}`} onClick={() => void removeRow(row.id)} aria-label="Delete row">
                                <Trash2 className="size-3.5 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {focusedLocalFirst ? (
        <details
          open
          data-testid="log-activity-strip"
          className="group shrink-0 border-t border-border/60 bg-surface/40"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            <TerminalSquare className="size-3.5 text-accent" />
            <span>Activity</span>
            {focusedState?.outbox.length ? (
              <span className="rounded bg-accent/10 px-1.5 text-accent">
                {focusedState.outbox.length} pending
              </span>
            ) : null}
            <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div
            role="log"
            aria-label="Focused log activity"
            className="max-h-24 overflow-auto border-t border-border/40 px-3 py-1.5 font-mono text-[10px] leading-5 text-muted-foreground"
          >
            {(focusedState?.activity.length ?? 0) === 0 ? (
              <p>No local activity yet.</p>
            ) : (
              focusedState?.activity.slice(-8).map((event) => (
                <p key={event.id} data-kind={event.kind}>
                  <time className="mr-2 text-muted-foreground/70">
                    {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>
                  <span className={event.kind === "sync-failed" ? "text-destructive" : "text-foreground/80"}>
                    {event.message}
                  </span>
                </p>
              ))
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default LogPageView;
