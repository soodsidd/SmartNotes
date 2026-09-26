"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  AppWindow,
  ChevronDown,
  ChevronRight,
  Sparkles,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  NotebookPen,
  PanelLeft,
  PanelLeftClose,
  Palette,
  PenLine,
  Plus,
  RotateCw,
  WifiOff,
  CheckCircle2,
  ClipboardList,
  Inbox,
  FolderPlus,
  FolderOpen,
  FileDown,
  FileUp,
  FileText,
  Gem,
  Link2,
  Lock,
  Search,
  Download,
  Printer,
  Table2,
  GripVertical,
  Pin,
  PinOff,
} from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { toast } from "sonner";
import { AiSidebar, MobileAiSheet, type AiComposerAttachment, type AiComposerSnapshot, type AiSidebarMessage } from "@/components/ai-sidebar";
import { SearchModal } from "@/components/search-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor, type EditorSectionContext, type RichTextEditorHandle } from "@/components/rich-text-editor";
import type { AnnotationLayerHandle, AnnotationLayerProps, AnnotationStrokeSize, AnnotationTool } from "@/components/annotation-layer";
import type { InkCanvasHandle, InkCanvasProps } from "@/components/ink-canvas";
import type { JupyterNotebookViewProps } from "@/components/jupyter-notebook-view";
import { jupyterFocusForPage, type JupyterFocusState } from "@/lib/jupyter-focus";
import {
  fetchJupyterFastLaneSettings,
  fetchJupyterWorkspaceSessionStatus,
  saveJupyterFastLaneSettings,
  type JupyterSessionView,
} from "@/lib/api/jupyter";
import { pickJupyterFastLaneModel } from "@/lib/jupyter-inline-ai";
import type { LogPageViewProps } from "@/components/log-page-view";
import type { DesignPageViewProps } from "@/components/design-page-view";
import type { AppPageViewProps } from "@/components/app-page-view";
import type { SpreadsheetPageHandle, SpreadsheetPageViewProps } from "@/components/spreadsheet-page-view";
import { focusedLogUrl } from "@/lib/api/log";
import { normalizeVaultRelativePagePath } from "@/lib/app-frame";
import {
  buildAscentVectorReturnUrl,
  deepWorkPendingPath,
  parseDeepWorkDescriptor,
  type DeepWorkDescriptor,
} from "@/lib/deep-work";
import {
  activeDeepWorkWorkspace,
  clearStickyDeepWork,
  readStickyDeepWork,
  restorableStickyDeepWork,
  shouldLeaveDeepWorkForVaultSelection,
  writeStickyDeepWork,
} from "@/lib/deep-work-sticky";
import {
  canRemountJupyterSurface,
  deepWorkSourceRefreshDecision,
  stickyRootRevalidationDisposition,
  type DeepWorkSourceUpdatedEvent,
} from "@/lib/deep-work-refresh";
import { safeRandomUUID } from "@/lib/safe-random-uuid";
import type { TLDefaultColorStyle } from "tldraw";
import dynamic from "next/dynamic";
import { resolvePdfAttachmentTarget, type PdfAttachmentTarget } from "@/lib/pdf-attachment";
import {
  closeRetainedPdfReader,
  createRetainedPdfReaderState,
  openRetainedPdfReader,
} from "@/lib/pdf-reader-session";
import { AppSettingsDialog, AppSettingsTrigger } from "@/components/app-settings-dialog";
import { CreateNotebookDialog } from "@/components/create-notebook-dialog";
import { LinkDesignSourceDialog } from "@/components/link-design-source-dialog";
import { OpenClosedNotebooksDialog } from "@/components/open-closed-notebooks-dialog";
import { OpenWorkspaceDialog } from "@/components/open-workspace-dialog";
import { revealNotebookInExplorer, revealPageInExplorer } from "@/lib/api/fs-native";
import type { PortableNotebookRecord } from "@/lib/api/notebook-registry";
import { linkDesignPage as linkDesignPageApi, relinkDesignPage as relinkDesignPageApi } from "@/lib/api/pages";

const InkCanvas = dynamic(
  () => import("@/components/ink-canvas").then((m) => m.InkCanvas),
  { ssr: false }
) as React.ForwardRefExoticComponent<InkCanvasProps & React.RefAttributes<InkCanvasHandle>>;

const JupyterNotebookView = dynamic(
  () => import("@/components/jupyter-notebook-view").then((m) => m.JupyterNotebookView),
  { ssr: false }
) as React.ComponentType<JupyterNotebookViewProps>;

const LogPageView = dynamic(
  () => import("@/components/log-page-view").then((m) => m.LogPageView),
  { ssr: false }
) as React.ComponentType<LogPageViewProps>;

const DesignPageView = dynamic(
  () => import("@/components/design-page-view").then((m) => m.DesignPageView),
  { ssr: false }
) as React.ComponentType<DesignPageViewProps>;

const AppPageView = dynamic(
  () => import("@/components/app-page-view").then((m) => m.AppPageView),
  { ssr: false }
) as React.ComponentType<AppPageViewProps>;

const SpreadsheetPageView = dynamic(
  () => import("@/components/spreadsheet-page-view").then((m) => m.SpreadsheetPageView),
  { ssr: false }
) as React.ComponentType<SpreadsheetPageViewProps>;

// next/dynamic does not forward `ref`; AnnotationLayer receives its imperative
// handle through the `handleRef` prop instead (SN-153), so a plain
// ComponentType is the accurate type here.
const AnnotationLayer = dynamic(
  () => import("@/components/annotation-layer").then((m) => m.AnnotationLayer),
  { ssr: false }
) as React.ComponentType<AnnotationLayerProps>;

const ImmersivePdfReader = dynamic(
  () => import("@/components/immersive-pdf-reader"),
  { ssr: false }
) as React.ComponentType<{
  href: string;
  fileName: string;
  onClose: () => void;
  open?: boolean;
  companionOpen?: boolean;
  companionAnswerReady?: boolean;
  companionWorking?: boolean;
  onToggleCompanion?: () => void;
  onPageChange?: (page: number) => void;
}>;
import {
  getVersionsControlLabel,
  readTreeSidebarCollapsed,
  readTreeSidebarWidth,
  writeTreeSidebarCollapsed,
  writeTreeSidebarWidth,
  clampTreeSidebarWidth,
  TREE_SIDEBAR_DEFAULT_WIDTH,
  TREE_SIDEBAR_WIDTH_KEY,
} from "@/lib/app-settings";
import {
  fetchPageVersionContent,
  fetchPageVersions,
  formatVersionLabel,
  restorePageVersion,
  snapshotPageVersion,
  type PageVersionEntry,
} from "@/lib/api/versions";
import { fetchSearchResults } from "@/lib/api/search";
import {
  appendAiTimelineReasoning,
  appendAiTimelineText,
  appendAiTimelineVerboseEvent,
  buildAiPageTreeMarkdown,
  buildAiPageContext,
  buildAiParentContextMarkdown,
  buildAiSidebarTraceEvent,
  AI_SIDEBAR_DEFAULT_WIDTH,
  AI_SIDEBAR_MIN_WIDTH,
  buildAiTurnRequest,
  buildCompanionAppMessagePrompt,
  buildMessageWithDocumentAttachments,
  buildSmartNotesOperatingContext,
  clampAiSidebarWidth,
  countAiPageTreePages,
  getAiSidebarMaxWidth,
  getAiScopeLabel,
  getAiScopeOptions,
  getAiScopeTokenLabel,
  isParentContextScopeAvailable,
  normalizeAiScopeForAvailability,
  resolveAiScopeParentInfo,
  resolveProviderEffort,
  getSectionMarkdown,
  resolveAiProviderSelection,
  companionScopeFromKey,
  resolveCompanionThreadAddress,
  resolveSubtreeRootPath,
  isCompanionThreadDisplayed,
  createEmptyCompanionSidecar,
  describeTerminalTurnStatus,
  findCompanionActiveTurn,
  getCompanionActiveTurn,
  getCompanionScopeSession,
  readCompanionProviderPreferences,
  readVolatileCompanionSession,
  resolveCompanionIconState,
  resolveLiveTurnReattachAction,
  setCompanionActiveTurn,
  setCompanionScopeSession,
  shouldApplyTurnEventSeq,
  shouldLightCompanionReady,
  withCompanionProviderPreferences,
  type AiScope,
  type CompanionActiveTurn,
  type CompanionProviderPreferences,
  type CompanionSidecar,
  type CompanionStoredMessage,
  writeVolatileCompanionSession,
} from "@/lib/ai-sidebar";
import {
  deleteCompanionSessions,
  fetchCompanionPageContext,
  fetchCompanionSessions,
  saveCompanionSessions,
} from "@/lib/api/companion";
import {
  buildRecentSearchResults,
  buildVaultSearchIndex,
  searchVaultIndex,
  type SearchResult,
  type VaultSearchIndex,
} from "@/lib/search";
import {
  buildPageNestingActionLookup,
  buildPageTree,
  flattenPageTree,
  getPageNestingActionState,
  mergeTreeExpandState,
  resolveSidebarPageDrop,
  resolveTreeExpandPathsForPage,
  type PageNestingActionLookup,
  type TreeExpandEnsurePaths,
} from "@/lib/page-tree";
import {
  type ApiPageDocument,
  type CapturePayload,
  type CreateNotebookPayload,
  type CreatePagePayload,
  type CreateSectionPayload,
  type MovePagePayload,
  type NoteType,
  type NotebookMutationResult,
  type RenameNotebookPayload,
  type RenamePagePayload,
  type RenameSectionPayload,
  type SavePagePayload,
  type SectionMutationResult,
  type VaultNotebook,
  type VaultPage,
  type VaultSection,
  type VaultTreeResponse,
} from "@/lib/vault-contract";
import {
  buildReloadDraftSnapshot,
  hasUnsavedLocalDraftChanges,
  getReloadStatusLabel,
  rebaseDraftAfterSave,
  shouldBlockPendingPageReload,
} from "@/lib/page-reload";
import { buildEffectiveEditorHtml, planPageSwap } from "@/lib/editor-swap-helpers";
import {
  canUseKeepaliveBody,
  useConnectionStatus,
  vaultWriteFetch,
} from "@/lib/connection-status";
import { registerReloadDrain } from "@/lib/reload-guard";
import {
  buildStandaloneHtmlBundle,
  clearPagePrintLeadingH1,
  inlineVaultAssetsInHtml,
  mountPrintInkSnapshot,
  removePrintInkSnapshot,
  setPagePrintActive,
  setPagePrintLeadingH1,
  shouldHandlePagePrintShortcutTarget,
  triggerHtmlBundleDownload,
} from "@/lib/page-export";
import {
  applyPrintLayoutStyles,
  clearPrintLayoutStyles,
  loadPrintSettings,
  savePrintSettings,
  type PrintSettings,
} from "@/lib/print-settings";
import { PrintSettingsDialog } from "@/components/print-settings-dialog";
import { pageContentCache } from "@/lib/page-content-cache";
import { fetchAnnotationsScene } from "@/lib/api/annotations";
import { cn } from "@/lib/utils";
import type { PageComment } from "@/lib/comment-types";
import { isPageKeyNote, keyNoteMenuLabel } from "@/lib/key-note";
import {
  reorderNotebookPaths,
  type NotebookGroup,
} from "@/lib/notebook-sidebar-organization";

const ACTIVE_PAGE_STORAGE_KEY = "smart-notes-active-page";
const ACTIVE_PDF_READER_SESSION_KEY = "smart-notes-active-pdf-reader";
const AI_SIDEBAR_WIDTH_STORAGE_KEY = "smart-notes-ai-sidebar-width";
const CLOSED_NOTEBOOKS_STORAGE_KEY = "smart-notes-closed-notebooks";
const EXPANDED_PAGES_STORAGE_KEY = "smart-notes-expanded-pages";
const VAULT_UI_STATE_SYNC_DELAY_MS = 300;
const COMPANION_SAVE_DELAY_MS = 600;
const VOLATILE_COMPANION_SAVE_DELAY_MS = 100;
const AUTOSAVE_DELAY_MS = 1200;
const GHOST_VERSION_DISMISS_MS = 60_000;
const GHOST_VERSION_FADE_MS = 300;
const EMPTY_PAGE_NESTING_ACTION_LOOKUP: PageNestingActionLookup = new Map();

interface VisibleGhostVersions {
  parentPagePath: string;
  versions: PageVersionEntry[];
  noteType: NoteType;
  dismissing: boolean;
}

interface PageContextMenuState {
  pagePath: string;
  pageTitle: string;
  noteType: NoteType;
  keyNote: boolean;
  notebookPath: string;
  notebookName: string;
  sectionPath?: string | null;
  sectionName?: string | null;
  x: number;
  y: number;
}

interface GhostContextMenuState {
  parentPagePath: string;
  versionId: string;
  x: number;
  y: number;
}

interface VersionPreviewState {
  parentPagePath: string;
  versionId: string;
  versionTs: string;
  noteType: NoteType;
  content: string;
  annotationsContent?: string | null;
}

import {
  filterPersistedPaths,
  hasPersistedExpandState,
  resolveClosedNotebooksFromVaultState,
  type VaultUiStatePayload,
} from "@/lib/vault-ui-state-hydration";

// SN-80: companion thread <-> sidecar message conversion. Streaming flags and
// transient state are dropped; message history is the authoritative record.
function toStoredCompanionMessages(messages: AiSidebarMessage[]): CompanionStoredMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const stored: CompanionStoredMessage = {
        id: message.id,
        role: message.role,
        content: message.content,
      };
      if (message.modelLabel) {
        stored.modelLabel = message.modelLabel;
      }
      if (message.errorMessage) {
        stored.errorMessage = message.errorMessage;
      }
      if (message.timeline && message.timeline.length > 0) {
        stored.timeline = message.timeline;
      }
      return stored;
    });
}

function fromStoredCompanionMessages(messages: CompanionStoredMessage[]): AiSidebarMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    modelLabel: message.modelLabel,
    errorMessage: message.errorMessage ?? null,
    timeline: message.timeline,
    isStreaming: false,
  }));
}

function readCurrentCompanionProviderPreferences(
  providerId: string,
  model: string,
  effort: string
): CompanionProviderPreferences | null {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) {
    return null;
  }
  return {
    providerId: normalizedProviderId,
    model: model.trim() || undefined,
    effort: effort.trim() || undefined,
  };
}

function readPersistedClosedNotebooks() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(CLOSED_NOTEBOOKS_STORAGE_KEY);
    if (!raw) return new Set<string>();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

function readStoredStringSet(storageKey: string) {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set<string>();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

function collectVaultPageLookups(tree: VaultNotebook[]) {
  return tree.flatMap((notebook) =>
    [
      ...notebook.pages.map((page) => ({ path: page.path, parentId: page.parentId })),
      ...notebook.sections.flatMap((section) =>
        section.pages.map((page) => ({ path: page.path, parentId: page.parentId }))
      ),
    ]
  );
}

type LoadTreeOptions = {
  expandAll?: boolean;
  ensureExpanded?: TreeExpandEnsurePaths;
  skipCache?: boolean;
};

type PageDraft = ApiPageDocument;

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type PendingPageReload = {
  page: ApiPageDocument;
  detectedAt: number;
  source: "ai" | "file";
};

type PendingVaultReload = {
  detectedAt: number;
};

type SyncConnectionState = "connecting" | "connected" | "disconnected";

interface FileUpdatedEvent {
  path?: string;
  content?: string;
  kind?: "log_form" | "app_data";
  originSocketId?: string;
  originClientId?: string;
}

interface ChatProvidersResponse {
  default?: string;
  providers?: Array<{
    id: string;
    name: string;
    models?: string[];
  }>;
}

interface ChatSettingsResponse {
  model?: string;
  claudeModel?: string;
  ghcopilotModel?: string;
  ghcopilotEffort?: string;
  codexModel?: string;
  codexEffort?: string;
  cursorModel?: string;
  cursorEffort?: string;
  verbose?: boolean;
}

interface AgentSettingsResponse {
  systemPrompt: string;
  isDefault?: boolean;
  defaultSystemPrompt?: string;
}

type DialogState =
  | { kind: "renameNotebook"; path: string; name: string; isPortable?: boolean }
  | { kind: "deleteNotebook"; path: string; name: string; isPortable?: boolean }
  | { kind: "createSection"; notebookPath: string; notebookName: string }
  | { kind: "renameSection"; path: string; name: string; notebookPath: string }
  | { kind: "deleteSection"; path: string; name: string }
  | {
      kind: "createPage";
      sectionPath?: string | null;
      sectionName?: string | null;
      notebookPath?: string | null;
      notebookName?: string | null;
      noteType?: NoteType;
      parentId?: string | null;
      targetLabel?: string;
    }
  | { kind: "renamePage"; path: string; title: string }
  | { kind: "deletePage"; path: string; title: string }
  | { kind: "movePage"; path: string; title: string; currentSectionPath: string }
  | { kind: "confirmRemoteReload"; path: string; title: string }
  | null;

interface CaptureDialogState {
  open: boolean;
  destination: "inbox" | "page";
  title: string;
  content: string;
  notebookPath: string;
  sectionPath: string;
  isSubmitting: boolean;
}

interface TreeSelection {
  notebook: VaultNotebook | null;
  section: VaultSection | null;
  page: VaultPage | null;
}

function readActivePdfReaderSession(): PdfAttachmentTarget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_PDF_READER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PdfAttachmentTarget>;
    if (typeof parsed.href !== "string" || typeof parsed.fileName !== "string") {
      return null;
    }
    const page =
      typeof parsed.page === "number" && Number.isInteger(parsed.page) && parsed.page > 0
        ? parsed.page
        : undefined;
    const pageCount =
      typeof parsed.pageCount === "number" && Number.isInteger(parsed.pageCount) && parsed.pageCount > 0
        ? parsed.pageCount
        : undefined;
    return { href: parsed.href, fileName: parsed.fileName, page, pageCount };
  } catch {
    return null;
  }
}

function writeActivePdfReaderSession(target: PdfAttachmentTarget | null): void {
  if (typeof window === "undefined") return;
  try {
    if (target) {
      window.sessionStorage.setItem(ACTIVE_PDF_READER_SESSION_KEY, JSON.stringify(target));
    } else {
      window.sessionStorage.removeItem(ACTIVE_PDF_READER_SESSION_KEY);
    }
  } catch {
    // Session restore is best-effort; the reader still works without storage.
  }
}

interface CreatePageTarget {
  notebookPath: string;
  notebookName: string;
  sectionPath?: string | null;
  sectionName?: string | null;
  parentId?: string | null;
  targetLabel: string;
}

function deepWorkDraft(descriptor: DeepWorkDescriptor): PageDraft {
  const path = deepWorkPendingPath(descriptor);
  return {
    id: path,
    path,
    title: descriptor.projectName,
    slug: "deep-work",
    createdAt: null,
    updatedAt: null,
    preview: descriptor.branch ?? descriptor.rootPath,
    content: "",
    body: "",
    parentId: null,
    noteType: "jupyter",
    metadata: {},
    notebookPath: "",
    notebookName: descriptor.projectName,
    sectionPath: null,
    sectionName: null,
    resolvedDiskPath: descriptor.rootPath,
  };
}

export function ReliableNotebookShell({ initialVault }: { initialVault?: VaultTreeResponse } = {}) {
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString() ?? "";
  const linkedProjectWorkspace = React.useMemo(
    () => parseDeepWorkDescriptor(new URLSearchParams(searchKey)),
    [searchKey]
  );
  // SN-262: the last owner-opened Deep Work disk root is durable UI state. It is
  // read once, at mount, so the very first render already selects the workspace
  // draft and the shell never flashes (or launches) the previously active vault
  // Jupyter page on the way to restoring Deep Work. A URL-linked AV descriptor
  // always wins over the sticky root.
  const restoredStickyWorkspace = React.useMemo(
    () =>
      restorableStickyDeepWork({
        linkedWorkspace: linkedProjectWorkspace,
        sticky: typeof window === "undefined" ? null : readStickyDeepWork(window.localStorage),
      }),
    // Mount-only: a later URL change must not re-run sticky restore mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [openedWorkspace, setOpenedWorkspace] = React.useState<DeepWorkDescriptor | null>(
    restoredStickyWorkspace
  );
  const projectWorkspace = openedWorkspace ?? linkedProjectWorkspace;
  const projectWorkspaceRef = React.useRef<DeepWorkDescriptor | null>(projectWorkspace);
  const initialWorkspaceDraft = React.useMemo(
    () => projectWorkspace ? deepWorkDraft(projectWorkspace) : null,
    [projectWorkspace]
  );
  const startupBaselineMode = searchParams?.get("startupBaseline") === "1";
  const serverVault = startupBaselineMode ? undefined : initialVault;
  const [tree, setTree] = React.useState<VaultNotebook[]>(serverVault?.tree ?? []);
  const [vaultRoot, setVaultRoot] = React.useState(serverVault?.root ?? "");
  const [activeNotebookPath, setActiveNotebookPath] = React.useState<string | null>(null);
  const [activeSectionPath, setActiveSectionPath] = React.useState<string | null>(null);
  const [activePagePath, setActivePagePath] = React.useState<string | null>(initialWorkspaceDraft?.path ?? null);
  const [draft, setDraft] = React.useState<PageDraft | null>(initialWorkspaceDraft);
  // SN-262: an opened/sticky Deep Work root owns the Jupyter surface only while
  // its own pending draft is the active page. Selecting a vault `.jupyter` note
  // must launch that note-owned session, not the disk workspace.
  const activeProjectWorkspace = React.useMemo(
    () => activeDeepWorkWorkspace(projectWorkspace, draft?.path ?? null),
    [draft?.path, projectWorkspace]
  );
  const [workspaceSession, setWorkspaceSession] = React.useState<JupyterSessionView | null>(null);
  const restoredPdfReader = React.useMemo(readActivePdfReaderSession, []);
  const [pdfReaderState, setPdfReaderState] = React.useState(
    createRetainedPdfReaderState(restoredPdfReader)
  );
  const pdfReader = pdfReaderState.target;
  const pdfReaderOpen = pdfReaderState.open;
  const [dialogState, setDialogState] = React.useState<DialogState>(null);
  const [createNotebookDialogOpen, setCreateNotebookDialogOpen] = React.useState(false);
  const [openWorkspaceDialogOpen, setOpenWorkspaceDialogOpen] = React.useState(false);
  const [linkDesignDialog, setLinkDesignDialog] = React.useState<{
    open: boolean;
    mode: "link" | "relink";
    initialPath?: string;
    replacePath?: string;
  }>({ open: false, mode: "link" });
  const [dialogValue, setDialogValue] = React.useState("");
  const [dialogSelectValue, setDialogSelectValue] = React.useState("");
  const [captureDialog, setCaptureDialog] = React.useState<CaptureDialogState>({
    open: false,
    destination: "inbox",
    title: "Quick Capture",
    content: "",
    notebookPath: "",
    sectionPath: "",
    isSubmitting: false,
  });
  const [expandedNotebooks, setExpandedNotebooks] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());
  const [closedNotebooks, setClosedNotebooks] = React.useState<Set<string>>(new Set());
  const [pinnedNotebooks, setPinnedNotebooks] = React.useState<Set<string>>(new Set());
  const [pinnedPages, setPinnedPages] = React.useState<Set<string>>(new Set());
  const [notebookOrder, setNotebookOrder] = React.useState<string[]>([]);
  const [notebookGroups, setNotebookGroups] = React.useState<NotebookGroup[]>([]);
  const [archivedNotebooks, setArchivedNotebooks] = React.useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [treeSidebarCollapsed, setTreeSidebarCollapsed] = React.useState(false);
  const [treeSidebarWidth, setTreeSidebarWidth] = React.useState(TREE_SIDEBAR_DEFAULT_WIDTH);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [advancedPrintSettingsOpen, setAdvancedPrintSettingsOpen] = React.useState(false);
  const [sessionPrintSettings, setSessionPrintSettings] = React.useState<PrintSettings | null>(
    null
  );
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchIndex, setSearchIndex] = React.useState<VaultSearchIndex>(() => buildVaultSearchIndex([]));
  const [serverSearchResults, setServerSearchResults] = React.useState<SearchResult[]>([]);
  const [serverSearchState, setServerSearchState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [isLoadingTree, setIsLoadingTree] = React.useState(!serverVault || startupBaselineMode);
  const [isReloading, setIsReloading] = React.useState(false);
  const [isRefreshingNote, setIsRefreshingNote] = React.useState(false);
  const [isDialogSubmitting, setIsDialogSubmitting] = React.useState(false);
  const [createNotebookError, setCreateNotebookError] = React.useState<string | null>(null);
  const [docxImportTargetSectionPath, setDocxImportTargetSectionPath] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [reloadSafetyMessage, setReloadSafetyMessage] = React.useState<string | null>(null);
  const [pendingPageReload, setPendingPageReload] = React.useState<PendingPageReload | null>(null);
  const [pendingVaultReload, setPendingVaultReload] = React.useState<PendingVaultReload | null>(null);
  const [syncConnectionState, setSyncConnectionState] = React.useState<SyncConnectionState>("connecting");
  const [aiOpen, setAiOpen] = React.useState(false);
  const [aiMessages, setAiMessages] = React.useState<AiSidebarMessage[]>([]);
  const [aiComposerResetKey, setAiComposerResetKey] = React.useState(0);
  const [aiComposerInjectKey, setAiComposerInjectKey] = React.useState(0);
  const aiComposerSnapshotRef = React.useRef<AiComposerSnapshot>({ draft: "", attachments: [] });
  const [aiScope, setAiScope] = React.useState<AiScope>("whole");
  const [keepConversation, setKeepConversation] = React.useState(false);
  const [aiSectionContext, setAiSectionContext] = React.useState<EditorSectionContext | null>(null);
  const [aiProviders, setAiProviders] = React.useState<Array<{ id: string; name: string; models?: string[] }>>([]);
  const [aiActiveProviderId, setAiActiveProviderId] = React.useState("");
  const [aiActiveModel, setAiActiveModel] = React.useState("");
  const [aiActiveEffort, setAiActiveEffort] = React.useState("");
  const [fastLaneProviderId, setFastLaneProviderId] = React.useState("claude");
  const [fastLaneModel, setFastLaneModel] = React.useState("haiku");
  const [aiVerboseEnabled, setAiVerboseEnabled] = React.useState(true);
  const [aiSystemPrompt, setAiSystemPrompt] = React.useState("");
  const [aiDefaultSystemPrompt, setAiDefaultSystemPrompt] = React.useState("");
  const [aiSidebarWidth, setAiSidebarWidth] = React.useState(AI_SIDEBAR_DEFAULT_WIDTH);
  const [isWideViewport, setIsWideViewport] = React.useState(false);
  const [expandedPages, setExpandedPages] = React.useState<Set<string>>(() => readStoredStringSet(EXPANDED_PAGES_STORAGE_KEY));
  const [ghostVersions, setGhostVersions] = React.useState<VisibleGhostVersions | null>(null);
  const openPdfReader = React.useCallback((target: PdfAttachmentTarget) => {
    writeActivePdfReaderSession(target);
    setPdfReaderState((current) => openRetainedPdfReader(current, target));
  }, []);
  const closePdfReader = React.useCallback(() => {
    writeActivePdfReaderSession(null);
    // Keep exactly one loaded EmbedPDF tree hidden for same-tab same-PDF
    // resume. Opening a different href changes the keyed host and disposes it.
    setPdfReaderState(closeRetainedPdfReader);
  }, []);
  const handlePdfReaderPageChange = React.useCallback((page: number, pageCount?: number) => {
    setPdfReaderState((current) => {
      if (
        !current.target ||
        (current.target.page === page && current.target.pageCount === pageCount)
      ) {
        return current;
      }
      const nextTarget = { ...current.target, page, pageCount };
      writeActivePdfReaderSession(nextTarget);
      return { ...current, target: nextTarget };
    });
  }, []);
  const isInitialTreeLoadRef = React.useRef(true);
  const vaultUiStateRef = React.useRef<VaultUiStatePayload | null>(null);
  const [vaultUiStateHydrated, setVaultUiStateHydrated] = React.useState(false);
  const expandedNotebooksRef = React.useRef(expandedNotebooks);
  const expandedSectionsRef = React.useRef(expandedSections);
  const expandedPagesRef = React.useRef(expandedPages);
  const treeRef = React.useRef(tree);
  const [versionPreview, setVersionPreview] = React.useState<VersionPreviewState | null>(null);
  const [pageContextMenu, setPageContextMenu] = React.useState<PageContextMenuState | null>(null);
  const [ghostContextMenu, setGhostContextMenu] = React.useState<GhostContextMenuState | null>(null);
  const [inkReloadNonce, setInkReloadNonce] = React.useState(0);
  const [spreadsheetReloadNonce, setSpreadsheetReloadNonce] = React.useState(0);
  const [jupyterReloadNonce, setJupyterReloadNonce] = React.useState(0);
  // SN-270: an in-place refresh request for the focused Deep Work document.
  // Deliberately NOT folded into the Jupyter view's React key - see
  // src/lib/deep-work-refresh.ts for why a remount loses the root.
  const [workspaceDocumentReload, setWorkspaceDocumentReload] =
    React.useState<{ path: string; nonce: number } | null>(null);
  const [activeJupyterFocus, setActiveJupyterFocus] = React.useState<JupyterFocusState | null>(null);
  const activeJupyterFocusRef = React.useRef<JupyterFocusState | null>(null);
  const workspaceSessionRef = React.useRef<JupyterSessionView | null>(null);
  const workspaceReturnStateRef = React.useRef<{
    draft: PageDraft | null;
    activeNotebookPath: string | null;
    activeSectionPath: string | null;
    activePagePath: string | null;
  } | null>(null);
  const [logReloadNonce, setLogReloadNonce] = React.useState(0);
  const [designReloadNonce, setDesignReloadNonce] = React.useState(0);
  const [appReloadRequestNonce, setAppReloadRequestNonce] = React.useState(0);

  React.useEffect(() => {
    if (
      activeJupyterFocus &&
      (draft?.noteType !== "jupyter" || activeJupyterFocus.pagePath !== draft.path)
    ) {
      setActiveJupyterFocus(null);
    }
  }, [activeJupyterFocus, draft?.noteType, draft?.path]);

  const versionPreviewRef = React.useRef<VersionPreviewState | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const ghostDismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostFadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inkCanvasRef = React.useRef<InkCanvasHandle | null>(null);
  const spreadsheetPageRef = React.useRef<SpreadsheetPageHandle | null>(null);
  const annotationLayerRef = React.useRef<AnnotationLayerHandle | null>(null);
  const hydratingRef = React.useRef(false);
  const draftRef = React.useRef<PageDraft | null>(initialWorkspaceDraft);
  const activePagePathRef = React.useRef<string | null>(null);
  const activeNotebookPathRef = React.useRef<string | null>(null);
  const activeSectionPathRef = React.useRef<string | null>(null);
  const lastSavedSnapshotRef = React.useRef<string | null>(
    // SN-263: sticky restore seeds the draft at mount without hydrateDraft.
    initialWorkspaceDraft ? snapshotDraft(initialWorkspaceDraft) : null
  );
  const pendingPageReloadRef = React.useRef<PendingPageReload | null>(null);
  const pendingVaultReloadRef = React.useRef<PendingVaultReload | null>(null);
  const savingRef = React.useRef(false);
  const queuedSaveRef = React.useRef(false);
  // When a companion/external write lands on an open design page, suppress
  // in-flight and queued Source-tab autosaves so a late PUT cannot overwrite
  // the companion bytes before the owner clicks Reload.
  const designRemoteWriteFenceRef = React.useRef(false);
  const flushSaveRef = React.useRef<() => Promise<boolean>>(async () => true);
  const editorRef = React.useRef<RichTextEditorHandle | null>(null);
  const docxImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const socketRef = React.useRef<Socket | null>(null);
  const syncOriginIdRef = React.useRef<string | null>(null);
  const activeTurnIdRef = React.useRef<string | null>(null);
  const activeAssistantMessageIdRef = React.useRef<string | null>(null);
  const aiSubmitGenerationRef = React.useRef(0);
  // SN-80 companion session persistence refs.
  const keepConversationRef = React.useRef(false);
  const aiMessagesRef = React.useRef<AiSidebarMessage[]>([]);
  const aiMessagesBindingKeyRef = React.useRef<string | null>(null);
  const companionScopeKeyRef = React.useRef<string>("whole");
  // SN-202: current displayed thread's storePath (shared-scope identity). Async
  // turn-lifecycle gates compare against this, not the active page, so a shared
  // page_tree turn stays bound while navigating within its subtree.
  const companionStorePathRef = React.useRef<string>("");
  const companionSidecarRef = React.useRef<CompanionSidecar | null>(null);
  const companionPageRef = React.useRef<string | null>(null);
  const companionLoadedRef = React.useRef<{ path: string; scopeKey: string } | null>(null);
  const companionResumeIdRef = React.useRef<string | null>(null);
  const aiActiveProviderIdRef = React.useRef("");
  const aiActiveModelRef = React.useRef("");
  const aiActiveEffortRef = React.useRef("");
  const companionLoadGenRef = React.useRef(0);
  // SN-132 live-turn reattach state.
  // Highest applied chat_event seq for the observed turn (the resume cursor).
  const activeTurnLastSeqRef = React.useRef(-1);
  // Page + scope the in-flight turn belongs to (for durable pointer cleanup).
  const activeTurnContextRef = React.useRef<{ path: string; scopeKey: string } | null>(null);
  const pendingTerminalTurnPersistRef = React.useRef<{ path: string; scopeKey: string } | null>(null);
  // Dedupe reattach discovery so we probe the durable pointer once per page+scope.
  const reattachDiscoveryKeyRef = React.useRef<string | null>(null);
  const prevCompanionDisposeRef = React.useRef<{ path: string | null; scopeKey: string }>({
    path: null,
    scopeKey: "whole",
  });
  const prevKeepConversationRef = React.useRef(false);
  const restoredVolatileCompanionRef = React.useRef<string | null>(null);
  const aiStoredSettingsRef = React.useRef<ChatSettingsResponse>({});
  const [aiTurnActive, setAiTurnActive] = React.useState(false);
  // SN-211: closed-panel companion affordance. `companionAnswerReady` lights the
  // companion icon when a turn reaches terminal SUCCESS while the panel is closed
  // (viewed = acknowledged, cleared on open). `companionTurnPending` drives the
  // subtle "working" affordance while a watched turn is still in flight. Both are
  // fed by the existing durable-turn terminal stream — no second turn lifecycle.
  const [companionAnswerReady, setCompanionAnswerReady] = React.useState(false);
  const [companionTurnPending, setCompanionTurnPending] = React.useState(false);
  // Live mirror of `aiOpen` for the socket closure, and the turn id watched for a
  // background (closed-panel) terminal event. `watchedTurnIdRef` survives the
  // detach-on-close path so completion is still observed after the panel closes.
  const aiOpenRef = React.useRef(false);
  const watchedTurnIdRef = React.useRef<string | null>(null);
  const aiSidebarPointerCleanupRef = React.useRef<(() => void) | null>(null);
  const aiSidebarWidthHydratedRef = React.useRef(false);
  const treeSidebarPointerCleanupRef = React.useRef<(() => void) | null>(null);
  const treeSidebarWidthHydratedRef = React.useRef(false);
  const treeSidebarRailRef = React.useRef<HTMLElement>(null);
  const aiSidebarRailRef = React.useRef<HTMLElement>(null);

  if (!syncOriginIdRef.current) {
    syncOriginIdRef.current = createSyncOriginId();
  }

  const handleAiComposerSnapshot = React.useCallback((snapshot: AiComposerSnapshot) => {
    const nextAttachmentIds = new Set(snapshot.attachments.map((attachment) => attachment.id));
    aiComposerSnapshotRef.current.attachments.forEach((attachment) => {
      if (
        attachment.kind === "image" &&
        !nextAttachmentIds.has(attachment.id) &&
        typeof URL !== "undefined"
      ) {
        URL.revokeObjectURL(attachment.url);
      }
    });
    aiComposerSnapshotRef.current = {
      draft: snapshot.draft,
      attachments: snapshot.attachments,
    };
  }, []);

  const clearAiComposerSnapshot = React.useCallback(() => {
    handleAiComposerSnapshot({ draft: "", attachments: [] });
  }, [handleAiComposerSnapshot]);

  const resetAiComposer = React.useCallback(() => {
    clearAiComposerSnapshot();
    setAiComposerResetKey((current) => current + 1);
  }, [clearAiComposerSnapshot]);

  // SN-254: Answer-comment prose → open Companion with a prefilled composer draft.
  const handleJupyterAskInCompanion = React.useCallback(
    (payload: { draft: string }) => {
      handleAiComposerSnapshot({
        draft: payload.draft,
        attachments: aiComposerSnapshotRef.current.attachments,
      });
      setAiComposerInjectKey((current) => current + 1);
      setAiOpen(true);
    },
    [handleAiComposerSnapshot]
  );

  React.useEffect(() => {
    setTreeSidebarCollapsed(readTreeSidebarCollapsed());
    setTreeSidebarWidth(readTreeSidebarWidth());
    treeSidebarWidthHydratedRef.current = true;
  }, []);

  const setTreeCollapsed = React.useCallback((collapsed: boolean) => {
    setTreeSidebarCollapsed(collapsed);
    writeTreeSidebarCollapsed(collapsed);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined" || !treeSidebarWidthHydratedRef.current) {
      return;
    }
    writeTreeSidebarWidth(treeSidebarWidth);
  }, [treeSidebarWidth]);

  React.useEffect(() => {
    versionPreviewRef.current = versionPreview;
  }, [versionPreview]);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    projectWorkspaceRef.current = projectWorkspace;
  }, [projectWorkspace]);

  React.useEffect(() => {
    activeJupyterFocusRef.current = activeJupyterFocus;
  }, [activeJupyterFocus]);

  React.useEffect(() => {
    workspaceSessionRef.current = workspaceSession;
  }, [workspaceSession]);

  React.useEffect(() => {
    activePagePathRef.current = activePagePath;
  }, [activePagePath]);

  React.useEffect(() => {
    activeNotebookPathRef.current = activeNotebookPath;
  }, [activeNotebookPath]);

  React.useEffect(() => {
    activeSectionPathRef.current = activeSectionPath;
  }, [activeSectionPath]);

  React.useEffect(() => {
    pendingPageReloadRef.current = pendingPageReload;
  }, [pendingPageReload]);

  React.useEffect(() => {
    pendingVaultReloadRef.current = pendingVaultReload;
  }, [pendingVaultReload]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewport = () => {
      setIsWideViewport(window.innerWidth >= 1280);
    };

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EXPANDED_PAGES_STORAGE_KEY, JSON.stringify([...expandedPages]));
  }, [expandedPages]);

  React.useEffect(() => {
    setSearchIndex(buildVaultSearchIndex(tree));
  }, [tree]);

  React.useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  React.useEffect(() => {
    expandedNotebooksRef.current = expandedNotebooks;
  }, [expandedNotebooks]);

  React.useEffect(() => {
    expandedSectionsRef.current = expandedSections;
  }, [expandedSections]);

  React.useEffect(() => {
    expandedPagesRef.current = expandedPages;
  }, [expandedPages]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedWidth = Number(window.localStorage.getItem(AI_SIDEBAR_WIDTH_STORAGE_KEY) || "");
    if (!Number.isFinite(storedWidth) || storedWidth <= 0) {
      aiSidebarWidthHydratedRef.current = true;
      return;
    }

    const maxWidth = getAiSidebarMaxWidth(window.innerWidth);
    setAiSidebarWidth(clampAiSidebarWidth(storedWidth, AI_SIDEBAR_MIN_WIDTH, maxWidth));
    aiSidebarWidthHydratedRef.current = true;
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!aiSidebarWidthHydratedRef.current) {
      return;
    }

    const maxWidth = getAiSidebarMaxWidth(window.innerWidth);
    setAiSidebarWidth((currentWidth) => clampAiSidebarWidth(currentWidth, AI_SIDEBAR_MIN_WIDTH, maxWidth));
    window.localStorage.setItem(AI_SIDEBAR_WIDTH_STORAGE_KEY, String(aiSidebarWidth));
  }, [aiSidebarWidth, isWideViewport]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!vaultUiStateHydrated) return;
    window.localStorage.setItem(CLOSED_NOTEBOOKS_STORAGE_KEY, JSON.stringify([...closedNotebooks]));
  }, [closedNotebooks, vaultUiStateHydrated]);

  const activeSelection = React.useMemo(
    () =>
      resolveSelection(tree, {
        notebookPath: activeNotebookPath,
        sectionPath: activeSectionPath,
        pagePath: activePagePath,
      }),
    [activeNotebookPath, activePagePath, activeSectionPath, tree]
  );
  const activeCreateTarget = React.useMemo(
    () => resolveCreateTargetFromSelection(activeSelection),
    [activeSelection]
  );

  const trimmedSearchQuery = searchQuery.trim();
  const clientSearchResults = React.useMemo(
    () => searchVaultIndex(searchIndex, searchQuery),
    [searchIndex, searchQuery]
  );
  const recentSearchResults = React.useMemo(
    () => buildRecentSearchResults(searchIndex),
    [searchIndex]
  );
  const searchResults = trimmedSearchQuery
    ? clientSearchResults.length > 0
      ? clientSearchResults
      : serverSearchResults
    : recentSearchResults;
  const isShowingServerSearch =
    trimmedSearchQuery.length > 0 &&
    clientSearchResults.length === 0 &&
    serverSearchResults.length > 0;

  React.useEffect(() => {
    if (!searchOpen) {
      return;
    }

    if (!trimmedSearchQuery) {
      setServerSearchResults([]);
      setServerSearchState("idle");
      return;
    }

    if (clientSearchResults.length > 0) {
      setServerSearchResults([]);
      setServerSearchState("idle");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setServerSearchState("loading");
      void fetchSearchResults(trimmedSearchQuery, controller.signal)
        .then((results) => {
          setServerSearchResults(results);
          setServerSearchState("ready");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setServerSearchResults([]);
          setServerSearchState("error");
        });
    }, 120);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [clientSearchResults.length, searchOpen, trimmedSearchQuery]);

  const allSections = React.useMemo(
    () =>
      tree.flatMap((notebook) =>
        notebook.sections.map((section) => ({
          notebookPath: notebook.path,
          notebookName: notebook.name,
          sectionPath: section.path,
          sectionName: section.name,
        }))
      ),
    [tree]
  );

  const aiSection = React.useMemo(() => {
    if (!draft) {
      return null;
    }

    return getSectionMarkdown(draft.content, aiSectionContext?.index ?? 0);
  }, [aiSectionContext?.index, draft]);
  const aiSectionMarkdown =
    aiSection?.markdown ?? (aiScope === "section" ? draft?.content ?? "" : "");

  const activePageChildren = React.useMemo(() => {
    if (!activePagePath) return [] as VaultPage[];
    return tree.flatMap((nb) =>
      [
        ...nb.pages.filter((p) => p.parentId === activePagePath),
        ...nb.sections.flatMap((sec) => sec.pages.filter((p) => p.parentId === activePagePath)),
      ]
    );
  }, [activePagePath, tree]);

  const allPages = React.useMemo(
    () => tree.flatMap((notebook) => [
      ...notebook.pages,
      ...notebook.sections.flatMap((section) => section.pages),
    ]),
    [tree]
  );

  const companionSubtreeRootPath = React.useMemo(
    () => (draft?.path ? resolveSubtreeRootPath(draft.path, allPages) : null),
    [draft?.path, allPages]
  );
  const companionSubtreeRootPage = React.useMemo(
    () =>
      companionSubtreeRootPath
        ? allPages.find((page) => page.path === companionSubtreeRootPath) ?? null
        : null,
    [allPages, companionSubtreeRootPath]
  );
  const hasPageTreeScope =
    activePageChildren.length > 0 ||
    Boolean(companionSubtreeRootPath && companionSubtreeRootPath !== draft?.path);

  const aiPageTreeContext = React.useMemo(() => {
    if (!companionSubtreeRootPage || aiScope !== "page_tree") return "";
    return buildAiPageTreeMarkdown({
      activePage: {
        path: companionSubtreeRootPage.path,
        title: companionSubtreeRootPage.title,
        parentId: companionSubtreeRootPage.parentId,
      },
      pages: allPages,
    });
  }, [aiScope, allPages, companionSubtreeRootPage]);

  const aiPageTreeCount = React.useMemo(() => {
    if (!companionSubtreeRootPage || aiScope !== "page_tree") return 0;
    return countAiPageTreePages({
      activePage: {
        path: companionSubtreeRootPage.path,
        title: companionSubtreeRootPage.title,
        parentId: companionSubtreeRootPage.parentId,
      },
      pages: allPages,
    });
  }, [aiScope, allPages, companionSubtreeRootPage]);

  const aiParentInfo = React.useMemo(() => {
    if (!draft) return null;
    return resolveAiScopeParentInfo({
      activePage: {
        path: draft.path,
        title: draft.title,
        parentId: draft.parentId,
      },
      pages: allPages,
      sectionName: draft.sectionName,
      sectionPath: draft.sectionPath,
    });
  }, [allPages, draft]);

  const aiParentContextMarkdown = React.useMemo(() => {
    if (!draft || aiScope !== "parent_context" || !aiParentInfo) return "";
    return buildAiParentContextMarkdown({
      pageTitle: draft.title,
      pageContent: draft.content,
      parentInfo: aiParentInfo,
      noteType: draft.noteType,
    });
  }, [aiParentInfo, aiScope, draft]);

  const aiScopeOptions = React.useMemo(
    () =>
      getAiScopeOptions({
        hasSections: Boolean(draft?.sectionPath),
        hasPageChildren: hasPageTreeScope,
        hasParentContext: isParentContextScopeAvailable(aiParentInfo),
      }),
    [aiParentInfo, draft?.sectionPath, hasPageTreeScope]
  );

  const aiScopeLabel = getAiScopeLabel({
    scope: aiScope,
    sectionName: draft?.sectionName,
    sectionHeading: aiSection?.heading,
    pageTreeCount: aiPageTreeCount,
    parentInfo: aiParentInfo,
  });
  const aiTokenLabel = getAiScopeTokenLabel({
    scope: aiScope,
    sectionMarkdown: aiSectionMarkdown,
    pageTreeMarkdown: aiPageTreeContext,
    parentContextMarkdown: aiParentContextMarkdown,
  });
  const aiActiveProvider = React.useMemo(
    () => aiProviders.find((provider) => provider.id === aiActiveProviderId) ?? aiProviders[0] ?? null,
    [aiActiveProviderId, aiProviders]
  );
  const aiProviderLabel = aiActiveProvider?.name ?? "AI";
  const aiAssistantLabel = aiActiveModel || aiActiveProvider?.name || "assistant";
  const fastLaneProviderLabel =
    aiProviders.find((provider) => provider.id === fastLaneProviderId)?.name ?? "AI";

  // SN-202: resolve the durable thread ADDRESS by scope identity so shared scopes
  // collapse every page under the identity onto one conversation rather than one
  // thread per active-page sidecar.
  const companionThreadAddress = React.useMemo(
    () =>
      resolveCompanionThreadAddress({
        scope: aiScope,
        activePath: activeProjectWorkspace
          ? workspaceSession?.capability ?? ""
          : draft?.path ?? "",
        sectionPath: draft?.sectionPath,
        sectionHeading: aiScope === "section" ? aiSection?.heading : null,
        subtreeRootPath: companionSubtreeRootPath,
      }),
    [aiScope, draft?.path, draft?.sectionPath, aiSection?.heading, companionSubtreeRootPath, activeProjectWorkspace, workspaceSession?.capability]
  );
  // storePath = where the thread physically lives (shared identity); scopeKey =
  // key within that store. Every page under a shared scope resolves to the same
  // storePath, which is what makes the chat shared. Non-'whole'-page effects key
  // on storePath, so navigating within a shared subtree does not reload the thread.
  const companionStorePath = companionThreadAddress.storePath;
  const companionScopeKey = companionThreadAddress.scopeKey;
  const companionThreadKey = companionStorePath
    ? `${companionStorePath}::${companionScopeKey}`
    : null;
  const displayedAiMessages =
    aiMessagesBindingKeyRef.current === companionThreadKey ? aiMessages : [];
  // These refs gate asynchronous socket writes. Update them during render so
  // there is no post-paint effect window where a token can target the previous
  // thread after the new page/scope transcript is already displayed.
  companionStorePathRef.current = companionStorePath;
  companionScopeKeyRef.current = companionScopeKey;

  React.useEffect(() => {
    keepConversationRef.current = keepConversation;
  }, [keepConversation]);

  React.useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);

  React.useEffect(() => {
    aiActiveProviderIdRef.current = aiActiveProviderId;
  }, [aiActiveProviderId]);

  React.useEffect(() => {
    aiActiveModelRef.current = aiActiveModel;
  }, [aiActiveModel]);

  React.useEffect(() => {
    aiActiveEffortRef.current = aiActiveEffort;
  }, [aiActiveEffort]);

  // SN-132: persist a durable live-turn pointer (+ current transcript snapshot)
  // for a page+scope. Best-effort and independent of the Keep toggle — an
  // in-flight turn is server-owned run state that must survive navigation and
  // full PWA teardown so the client can reattach or reconcile on return.
  const persistCompanionActiveTurn = React.useCallback(
    async (
      path: string,
      scopeKey: string,
      messages: AiSidebarMessage[],
      activeTurn: CompanionActiveTurn | null,
      options: { keepalive?: boolean } = {}
    ) => {
      try {
        const stored = toStoredCompanionMessages(messages);
        const base =
          companionSidecarRef.current && companionPageRef.current === path
            ? companionSidecarRef.current
            : await fetchCompanionSessions(path).catch(() => createEmptyCompanionSidecar());
        const providerPreferences = readCurrentCompanionProviderPreferences(
          aiActiveProviderIdRef.current,
          aiActiveModelRef.current,
          aiActiveEffortRef.current
        );
        const next = setCompanionScopeSession(
          base,
          scopeKey,
          withCompanionProviderPreferences(
            {
              messages: stored,
              resumeId: companionResumeIdRef.current ?? undefined,
              activeTurn,
            },
            providerPreferences
          )
        );
        companionSidecarRef.current = next;
        companionPageRef.current = path;
        await saveCompanionSessions(path, next, options);
        return true;
      } catch {
        // Best-effort; the in-memory transcript and refs stay authoritative.
        return false;
      }
    },
    []
  );

  // SN-132: clear only the live-turn pointer for a page+scope, leaving any saved
  // transcript intact. Called when a turn reaches a terminal state.
  const clearCompanionActiveTurnPointer = React.useCallback(
    async (path: string, scopeKey: string) => {
      try {
        const base =
          companionSidecarRef.current && companionPageRef.current === path
            ? companionSidecarRef.current
            : await fetchCompanionSessions(path).catch(() => createEmptyCompanionSidecar());
        const next = setCompanionActiveTurn(base, scopeKey, null);
        companionSidecarRef.current = next;
        companionPageRef.current = path;
        await saveCompanionSessions(path, next);
      } catch {
        // Best-effort cleanup.
      }
    },
    []
  );

  // SN-132: reset the provider session (conversation continuity) without touching
  // any running turn. clearProviderSessions only affects the *next* turn's
  // --resume; the server-owned process for an in-flight turn is unaffected.
  const resetProviderSession = React.useCallback(async () => {
    await fetch("/api/chat/reset-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(() => undefined);
  }, []);

  // SN-132: detach local observers from the active turn WITHOUT cancelling it.
  // A running companion response is a server-owned live turn — page navigation
  // and component unmount must detach only, so returning to the page reattaches
  // to the same turn instead of losing or duplicating it.
  const detachActiveTurn = React.useCallback(() => {
    activeTurnIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    activeTurnLastSeqRef.current = -1;
    activeTurnContextRef.current = null;
    aiSubmitGenerationRef.current += 1;
    // Allow the reattach-discovery effect to re-probe the durable pointer the next
    // time the companion opens on this page+scope (e.g. after closing the panel
    // over a still-running turn), instead of treating it as already-resolved.
    reattachDiscoveryKeyRef.current = null;
    setAiTurnActive(false);
  }, []);

  // Persist a single scope thread into the page's companion sidecar (best-effort).
  const saveCompanionThread = React.useCallback(
    async (path: string, scopeKey: string, messages: AiSidebarMessage[]) => {
      try {
        const stored = toStoredCompanionMessages(messages);
        const base =
          companionSidecarRef.current && companionPageRef.current === path
            ? companionSidecarRef.current
            : await fetchCompanionSessions(path).catch(() => createEmptyCompanionSidecar());
        const providerPreferences = readCurrentCompanionProviderPreferences(
          aiActiveProviderIdRef.current,
          aiActiveModelRef.current,
          aiActiveEffortRef.current
        );
        // Transcript/provider saves must never erase a live pointer. Navigation
        // can flush an outgoing snapshot while the server-owned turn is active.
        const activeTurn = getCompanionActiveTurn(base, scopeKey);
        const next = setCompanionScopeSession(
          base,
          scopeKey,
          stored.length > 0 || activeTurn
            ? withCompanionProviderPreferences(
                {
                  messages: stored,
                  resumeId: companionResumeIdRef.current ?? undefined,
                  activeTurn: activeTurn ?? undefined,
                },
                providerPreferences
              )
            : null
        );
        companionSidecarRef.current = next;
        companionPageRef.current = path;
        await saveCompanionSessions(path, next);
      } catch {
        // Persistence is best-effort; the in-memory transcript stays authoritative.
      }
    },
    []
  );

  // SN-132: reattach to (or reconcile) a durable live-turn pointer discovered for
  // the page+scope the user just entered. Uses the server-authoritative live-run
  // lookup (GET /api/chat/history active_turns): if the turn is still running we
  // anchor the assistant message and replay missed events via `chat_resume`; if
  // it already reached a terminal state (completed/interrupted/failed while the
  // app was closed) we reconcile the final message from the durable run record
  // (GET /api/chat/sessions/:id) and clear the pointer.
  const reattachOrReconcileTurn = React.useCallback(
    async (path: string, scopeKey: string, pointer: CompanionActiveTurn) => {
      // SN-202: "still on this thread" is a function of the resolved store
      // identity, not the raw active page — a shared page_tree thread stays
      // current across any page under its subtree root.
      const stillOnScope = () =>
        companionStorePathRef.current === path && companionScopeKeyRef.current === scopeKey;

      // Server-authoritative live-run lookup. Track whether the request actually
      // reached the server: a network blip / mobile radio handoff must NOT be
      // misread as "the turn ended", or a still-running turn's pointer would be
      // deleted and the client could never reattach.
      let activeTurns: Array<{ turn_id?: string; last_seq?: number }> = [];
      let historyOk = false;
      try {
        const response = await fetch("/api/chat/history?all_scopes=1", { cache: "no-store" });
        if (response.ok) {
          historyOk = true;
          const data = (await response.json().catch(() => ({}))) as {
            active_turns?: Array<{ turn_id?: string; last_seq?: number }>;
          };
          activeTurns = Array.isArray(data.active_turns) ? data.active_turns : [];
        }
      } catch {
        historyOk = false;
      }

      if (!stillOnScope()) {
        return;
      }

      if (historyOk && resolveLiveTurnReattachAction(pointer, activeTurns) === "reattach") {
        activeTurnIdRef.current = pointer.turnId;
        activeAssistantMessageIdRef.current = pointer.assistantMessageId;
        // The displayed assistant message is rebuilt from the replayed event
        // stream, so resume from the beginning to avoid gaps or duplication.
        activeTurnLastSeqRef.current = -1;
        activeTurnContextRef.current = { path, scopeKey };
        aiMessagesBindingKeyRef.current = `${path}::${scopeKey}`;
        setAiMessages((current) => {
          let next: AiSidebarMessage[];
          if (current.some((message) => message.id === pointer.assistantMessageId)) {
            next = current.map((message) =>
              message.id === pointer.assistantMessageId
                ? // Reset accumulated content/timeline before replay: chat_resume
                  // replays the full event stream from seq -1, so any text already
                  // on the message (e.g. Keep-ON navigate-away mid-stream) would be
                  // duplicated by the replay if not cleared here.
                  { ...message, content: "", timeline: [], isStreaming: true, errorMessage: null }
                : message
            );
          } else {
            next = [
              ...current,
              {
                id: pointer.assistantMessageId,
                role: "assistant",
                content: "",
                isStreaming: true,
                timeline: [],
              },
            ];
          }
          aiMessagesRef.current = next;
          return next;
        });
        setAiTurnActive(true);
        // SN-211: keep watching the reattached turn so closing the panel again
        // before it finishes still lights the ready badge on completion.
        watchedTurnIdRef.current = pointer.turnId;
        setCompanionTurnPending(true);
        socketRef.current?.emit("chat_resume", { turn_id: pointer.turnId, last_seq: -1 });
        return;
      }

      // Not live (or the live-run lookup was unreachable) → positively confirm the
      // terminal state from the durable run record before touching the pointer.
      let finalContent = "";
      let terminalStatus = "";
      let sessionsOk = false;
      try {
        const response = await fetch(`/api/chat/sessions/${encodeURIComponent(pointer.turnId)}?all_scopes=1`, {
          cache: "no-store",
        });
        if (response.ok) {
          sessionsOk = true;
          const detail = (await response.json()) as {
            session?: { status?: string };
            messages?: Array<{ role?: string; content?: string }>;
          };
          terminalStatus = detail.session?.status ?? "";
          const lastMeaningful = Array.isArray(detail.messages)
            ? [...detail.messages]
                .reverse()
                .find((message) => message.role === "assistant" || message.role === "system")
            : null;
          finalContent = lastMeaningful?.content ?? "";
        }
      } catch {
        sessionsOk = false;
      }

      // Only clear the pointer when the server POSITIVELY confirms the turn is no
      // longer live: either the live-run lookup succeeded (turn absent from
      // active_turns) or the durable record reports a terminal (non-running)
      // status. If neither request reached the server — or the record still says
      // "running" while history was unreachable — leave the pointer intact so the
      // next panel-open retries instead of orphaning a still-streaming turn.
      const confirmedTerminal =
        historyOk || (sessionsOk && terminalStatus !== "" && terminalStatus !== "running");
      if (!confirmedTerminal) {
        return;
      }

      let reconciledMessages: AiSidebarMessage[] | null = null;
      if (stillOnScope()) {
        const { isFailure, note } = describeTerminalTurnStatus(terminalStatus);
        const reconciledContent = finalContent || (isFailure ? note : "");
        aiMessagesBindingKeyRef.current = `${path}::${scopeKey}`;
        setAiMessages((current) => {
          const patch = (message: AiSidebarMessage): AiSidebarMessage => ({
            ...message,
            content: reconciledContent || message.content,
            isStreaming: false,
            errorMessage: isFailure && !finalContent ? reconciledContent : message.errorMessage ?? null,
          });
          let next: AiSidebarMessage[];
          if (current.some((message) => message.id === pointer.assistantMessageId)) {
            next = current.map((message) =>
              message.id === pointer.assistantMessageId ? patch(message) : message
            );
          } else if (!reconciledContent) {
            next = current;
          } else {
            next = [
              ...current,
              patch({
                id: pointer.assistantMessageId,
                role: "assistant",
                content: "",
                isStreaming: true,
              }),
            ];
          }
          reconciledMessages = next;
          aiMessagesRef.current = next;
          return next;
        });
      }

      // SN-211: terminal reconcile is the recovery path when the live stream was
      // missed (in-app navigation while closed, cold return, or open→close while
      // the async probe was in flight). Mirror the chat_event watcher: stop the
      // working affordance, and light ready only for SUCCESS while still closed.
      // Failure/cancel/interrupted never badge — the transcript is the source of
      // truth when the companion reopens.
      watchedTurnIdRef.current = null;
      setCompanionTurnPending(false);
      if (shouldLightCompanionReady(terminalStatus, aiOpenRef.current)) {
        setCompanionAnswerReady(true);
      }

      if (activeTurnContextRef.current?.path === path && activeTurnContextRef.current.scopeKey === scopeKey) {
        activeTurnContextRef.current = null;
      }
      // Persist the recovered transcript to disk BEFORE clearing the pointer: if the
      // PWA is torn down between these two awaits, the pointer would otherwise be the
      // only thing that could trigger recovery, so the recovered answer must be
      // durable first. (aiMessagesRef lags a render behind setAiMessages, so persist
      // the array captured inside the updater rather than the ref.)
      if (reconciledMessages) {
        await saveCompanionThread(path, scopeKey, reconciledMessages);
      }
      await clearCompanionActiveTurnPointer(path, scopeKey);
    },
    [clearCompanionActiveTurnPointer, saveCompanionThread]
  );

  // Clear one scope thread on the page being left (navigation dispose with Keep OFF).
  const clearCompanionScopeOnPage = React.useCallback(async (path: string, scopeKey: string) => {
    try {
      // SN-132: never wipe a scope that still holds a live server-owned turn — the
      // durable pointer must survive navigation so the turn can be reattached or
      // reconciled on return. Cleanup happens when the turn reaches a terminal state.
      //
      // Prefer the in-memory sidecar ref (consistent with persistCompanionActiveTurn
      // and reattachOrReconcileTurn): persistCompanionActiveTurn is void-called, so
      // its disk flush may not have landed yet when a fast navigate-after-send fires
      // this cleanup. Reading from disk would then return a stale sidecar without the
      // pointer and delete a scope that is actually live.
      if (companionSidecarRef.current && companionPageRef.current === path) {
        if (getCompanionActiveTurn(companionSidecarRef.current, scopeKey)) {
          return;
        }
      }
      const base = await fetchCompanionSessions(path).catch(() => createEmptyCompanionSidecar());
      if (getCompanionActiveTurn(base, scopeKey)) {
        return;
      }
      const next = setCompanionScopeSession(base, scopeKey, null);
      if (Object.keys(next.scopes).length === 0) {
        await deleteCompanionSessions(path);
      } else {
        await saveCompanionSessions(path, next);
      }
    } catch {
      // Best-effort cleanup for ephemeral sessions.
    }
  }, []);

  const clearVolatileCompanionSession = React.useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeVolatileCompanionSession(window.sessionStorage, null);
  }, []);

  const handleKeepConversationChange = React.useCallback(
    (checked: boolean) => {
      const durable = activeProjectWorkspace ? true : checked;
      setKeepConversation(durable);
      keepConversationRef.current = durable;

      if (durable) {
        // Immediately persist whatever is on screen so it survives navigation.
        // Address by the resolved store identity so a shared thread is kept once.
        const path = companionStorePathRef.current;
        if (path) {
          const scopeKey = companionScopeKeyRef.current;
          companionLoadedRef.current = { path, scopeKey };
          void saveCompanionThread(path, scopeKey, aiMessagesRef.current);
        }
      }

      if (!activeProjectWorkspace) {
        void fetch("/api/ui-state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companionPersist: durable }),
        }).catch(() => undefined);
      }
    },
    [activeProjectWorkspace, saveCompanionThread]
  );

  // SN-211: keep the socket closure's view of the panel state current, and clear
  // the ready highlight the moment the companion is opened (viewed = acknowledged).
  // A still-running turn's `companionTurnPending` is left intact so reopening
  // then closing again resumes the quiet working affordance.
  React.useEffect(() => {
    aiOpenRef.current = aiOpen;
    if (aiOpen) {
      setCompanionAnswerReady(false);
    }
  }, [aiOpen]);

  const updateAiMessage = React.useCallback((messageId: string, updater: (message: AiSidebarMessage) => AiSidebarMessage) => {
    setAiMessages((currentMessages) => {
      const next = currentMessages.map((message) =>
        message.id === messageId ? updater(message) : message
      );
      aiMessagesRef.current = next;
      return next;
    });
  }, []);

  React.useEffect(() => {
    const pending = pendingTerminalTurnPersistRef.current;
    if (!pending) {
      return;
    }
    pendingTerminalTurnPersistRef.current = null;
    void (async () => {
      // Terminal confirmation is the first point where ordinary transcript
      // persistence may release the live pointer.
      await saveCompanionThread(pending.path, pending.scopeKey, aiMessages);
      await clearCompanionActiveTurnPointer(pending.path, pending.scopeKey);
      if (!keepConversationRef.current) {
        await clearCompanionScopeOnPage(pending.path, pending.scopeKey);
      }
    })();
  }, [
    aiMessages,
    clearCompanionActiveTurnPointer,
    clearCompanionScopeOnPage,
    saveCompanionThread,
  ]);

  const checkActivePageForExternalUpdate = React.useCallback(async (source: PendingPageReload["source"]) => {
    const currentDraft = draftRef.current;
    if (!currentDraft?.path) {
      return;
    }

    // AppPageView owns explicit Source Save/Reload and its own socket warning so
    // shell freshness checks can never replace an unsaved CodeMirror buffer.
    if (currentDraft.noteType === "app") return;

    // A log page's HTML is intentionally an unchanged stub. Once a form-sidecar
    // update has marked it pending, the normal HTML freshness comparison must
    // not clear that state while the companion turn finishes.
    if (
      currentDraft.noteType === "log" &&
      pendingPageReloadRef.current?.page.path === currentDraft.path
    ) {
      return;
    }
    const detectionDraft = currentDraft;

    try {
      const latestPage = await fetchVaultPage(currentDraft.path);
      const visibleDraft = draftRef.current;
      if (!visibleDraft || visibleDraft.path !== latestPage.path) {
        return;
      }

      if (isPageReloadPending(latestPage, detectionDraft)) {
        setReloadSafetyMessage(null);
        setPendingPageReload({
          page: latestPage,
          detectedAt: Date.now(),
          source,
        });
        return;
      }

      setPendingPageReload((currentPending) =>
        currentPending?.page.path === latestPage.path ? null : currentPending
      );
      setReloadSafetyMessage(null);
    } catch {
      // External reload detection is best-effort; normal chat should continue.
    }
  }, []);

  React.useEffect(() => {
    const socket = io({
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;
    setSyncConnectionState(socket.connected ? "connected" : "connecting");
    const handleSocketConnect = () => {
      setSyncConnectionState("connected");
      // SN-132: on (re)connect, if we are still observing a live turn, replay any
      // events missed while the socket was down, resuming from our applied cursor.
      const turnId = activeTurnIdRef.current;
      if (turnId) {
        socket.emit("chat_resume", { turn_id: turnId, last_seq: activeTurnLastSeqRef.current });
      }
    };
    const handleSocketDisconnect = () => setSyncConnectionState("disconnected");
    const handleSocketConnectError = () => setSyncConnectionState("disconnected");

    // SN-132: finalize the observed turn on a terminal event — clear local
    // observers and the durable live-turn pointer so no orphaned pointer remains.
    const finalizeActiveTurn = (options: { persistTranscript?: boolean } = {}) => {
      const context = activeTurnContextRef.current;
      activeTurnIdRef.current = null;
      activeAssistantMessageIdRef.current = null;
      activeTurnLastSeqRef.current = -1;
      activeTurnContextRef.current = null;
      setAiTurnActive(false);
      if (context && options.persistTranscript) {
        pendingTerminalTurnPersistRef.current = context;
      } else if (context) {
        void clearCompanionActiveTurnPointer(context.path, context.scopeKey);
      }
    };

    const handleTurnEvent = (event: {
      turn_id?: string;
      type?: string;
      seq?: number;
      payload?: Record<string, unknown>;
    }) => {
      // SN-211: closed-panel ready/working detection. This runs off the same
      // durable-turn terminal stream but BEFORE the transcript-bound guard below,
      // because closing the panel detaches `activeTurnIdRef` (Keep OFF) while the
      // server-owned turn keeps running. Matching the separately-tracked
      // `watchedTurnIdRef` lets us still observe the terminal event after the
      // panel closed — Keep ON and Keep OFF alike — without a second lifecycle.
      if (event.turn_id && event.turn_id === watchedTurnIdRef.current) {
        if (event.type === "done") {
          const status =
            typeof event.payload?.status === "string" ? event.payload.status : "completed";
          watchedTurnIdRef.current = null;
          setCompanionTurnPending(false);
          // Ready lights only for terminal SUCCESS observed while the panel is
          // closed. Error/cancel stay in the transcript for when it reopens.
          if (shouldLightCompanionReady(status, aiOpenRef.current)) {
            setCompanionAnswerReady(true);
          }
        } else if (event.type === "error") {
          watchedTurnIdRef.current = null;
          setCompanionTurnPending(false);
        }
      }

      if (!event.turn_id || event.turn_id !== activeTurnIdRef.current) {
        return;
      }

      const assistantMessageId = activeAssistantMessageIdRef.current;
      if (!assistantMessageId) {
        return;
      }

      // SN-202 transcript-binding guard (Problem 2): a streaming event may only
      // paint the transcript the owner is CURRENTLY looking at. The turn is bound
      // to a thread identity (storePath+scopeKey); if the displayed thread no
      // longer matches (mid-navigation race before detach runs), drop the event
      // rather than render tokens against the wrong page's view until reload.
      if (
        !isCompanionThreadDisplayed(activeTurnContextRef.current, {
          storePath: companionStorePathRef.current,
          scopeKey: companionScopeKeyRef.current,
        })
      ) {
        return;
      }

      // SN-132: sequence-guard so replayed events (after reconnect/reattach) are
      // idempotent — never re-apply an event at or below the resume cursor.
      if (!shouldApplyTurnEventSeq(event.seq, activeTurnLastSeqRef.current)) {
        return;
      }
      if (typeof event.seq === "number") {
        activeTurnLastSeqRef.current = event.seq;
      }

      const payload = event.payload ?? {};

      if (event.type === "token") {
        const text = typeof payload.text === "string" ? payload.text : "";
        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          content: `${message.content}${text}`,
          isStreaming: true,
          timeline: appendAiTimelineText(message.timeline, text),
        }));
        return;
      }

      if (event.type === "thinking") {
        const text = typeof payload.text === "string" ? payload.text : "";
        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: true,
          timeline: appendAiTimelineReasoning(message.timeline, text),
        }));
        return;
      }

      if (event.type === "tool_call" || event.type === "status") {
        const traceEvent = buildAiSidebarTraceEvent(event.type, payload);
        if (!traceEvent) {
          return;
        }

        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: true,
          timeline: appendAiTimelineVerboseEvent(message.timeline, traceEvent),
        }));
        return;
      }

      if (event.type === "tool_result") {
        const traceEvent = buildAiSidebarTraceEvent(event.type, payload);
        if (!traceEvent) {
          return;
        }

        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: true,
          timeline: appendAiTimelineVerboseEvent(message.timeline, traceEvent),
        }));
        return;
      }

      if (event.type === "error") {
        finalizeActiveTurn({ persistTranscript: true });
        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: false,
          errorMessage: typeof payload.message === "string" ? payload.message : "Something went wrong.",
        }));
        return;
      }

      if (event.type === "done") {
        finalizeActiveTurn({ persistTranscript: true });
        // SN-132: surface non-completed terminal states (interrupted after a
        // server restart, cancelled, or failed) explicitly instead of leaving a
        // silently-truncated bubble.
        const status = typeof payload.status === "string" ? payload.status : "completed";
        const { isFailure, note: failureNote } = describeTerminalTurnStatus(status);
        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: false,
          errorMessage:
            isFailure && !message.content.trim() ? failureNote : message.errorMessage ?? null,
          modelLabel:
            (typeof payload.model === "string" && payload.model.trim()) ||
            (typeof payload.provider === "string" && payload.provider.trim()) ||
            message.modelLabel,
        }));
        void checkActivePageForExternalUpdate("ai");
      }
    };

    socket.on("chat_event", handleTurnEvent);

    // Dev-only test bridge: lets Playwright inject mock chat_event payloads
    // without needing a real Socket.IO server or AI backend.
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (
        window as Window & {
          __testChatBridge?: { injectChatEvent: (event: Parameters<typeof handleTurnEvent>[0]) => void };
        }
      ).__testChatBridge = { injectChatEvent: handleTurnEvent };
    }

    // Multi-tab/external file sync: show a pending reload instead of silently
    // replacing the editor draft.
    const handleFileUpdated = (event: FileUpdatedEvent) => {
      if (!event.path) return;
      if (
        (event.originClientId && event.originClientId === syncOriginIdRef.current) ||
        (event.originSocketId && event.originSocketId === socketRef.current?.id)
      ) {
        return;
      }
      const current = draftRef.current;
      if (!current || current.path !== event.path) return;
      if (event.kind === "log_form" && current.noteType === "log") {
        const pendingLogFormReload = { page: current, detectedAt: Date.now(), source: "file" } as const;
        // The companion terminal event can follow immediately. Keep the ref in
        // sync before React renders so its generic HTML-stub check cannot erase
        // this log-sidecar update.
        pendingPageReloadRef.current = pendingLogFormReload;
        setPendingPageReload(pendingLogFormReload);
        setReloadSafetyMessage(null);
        return;
      }
      if (current.noteType === "app") {
        // AppPageView handles source/data events and preserves its isolated,
        // explicit-save Source buffer. Never arm generic draft autosave/reload.
        return;
      }
      if (current.noteType === "spreadsheet") {
        // SN-209: a companion spreadsheet_write_cells rewrote the authoritative
        // .spreadsheet.json sidecar. Live-reload the open workbook so the change
        // appears — but never let an armed local autosave overwrite it. Pause a
        // dirty workbook and reuse the standard reload/discard confirmation.
        if (spreadsheetPageRef.current?.hasPendingChanges()) {
          spreadsheetPageRef.current.pauseForExternalUpdate();
          const pendingSpreadsheetReload = {
            page: current,
            detectedAt: Date.now(),
            source: "file" as const,
          };
          pendingPageReloadRef.current = pendingSpreadsheetReload;
          setPendingPageReload(pendingSpreadsheetReload);
          setReloadSafetyMessage(null);
          return;
        }
        setPendingPageReload((pending) => (pending?.page.path === event.path ? null : pending));
        setReloadSafetyMessage(null);
        setSpreadsheetReloadNonce((nonce) => nonce + 1);
        return;
      }
      // Cancel pending autosave immediately so a racey flush cannot overwrite
      // the companion/external write before the owner reloads.
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Design pages: mark pending from the event payload when content differs.
      // Avoids a fetch-then-compare race where a stale autosave could rewrite
      // disk and clear the indicator (own-in-place companion edits).
      if (
        current.noteType === "design" &&
        typeof event.content === "string" &&
        event.content !== current.content
      ) {
        // Fence in-flight + queued flushSave: a Source-tab PUT already underway
        // must not land after this companion write; queued retries must not run.
        designRemoteWriteFenceRef.current = true;
        queuedSaveRef.current = false;
        const pendingDesignReload = {
          page: { ...current, content: event.content, body: event.content },
          detectedAt: Date.now(),
          source: "file" as const,
        };
        pendingPageReloadRef.current = pendingDesignReload;
        setPendingPageReload(pendingDesignReload);
        setReloadSafetyMessage(null);
        return;
      }
      void checkActivePageForExternalUpdate("file");
    };

    const handleJupyterNotebookUpdated = (event: { path?: string; contentHash?: string }) => {
      if (!event.path) return;
      const current = draftRef.current;
      if (!current || current.noteType !== "jupyter" || current.path !== event.path) return;
      // SN-270: `jupyterReloadNonce` is part of the Jupyter view's React key, so
      // bumping it remounts the surface. That is fine for a note-owned .jupyter
      // page, which has no session identity to lose, but for a Deep Work root it
      // would relaunch the workspace session and throw away the capability, the
      // active file, and the rooted server. Deep Work refreshes in place instead
      // (see handleWorkspaceSourceUpdated).
      if (!canRemountJupyterSurface(Boolean(activeDeepWorkWorkspace(projectWorkspaceRef.current, current.path)))) {
        return;
      }
      setPendingPageReload((pending) => (pending?.page.path === event.path ? null : pending));
      setReloadSafetyMessage(null);
      setJupyterReloadNonce((nonce) => nonce + 1);
    };

    // SN-270: a Companion (or any external) write landed inside a Deep Work root.
    // Refresh only the focused document, in place, and leave every piece of
    // session identity - openedWorkspace, the sticky record, the workspace
    // session/capability, the active file, and the rooted Jupyter server -
    // untouched. A dirty document is left alone for JupyterLab's own
    // file-changed conflict handling rather than being silently reverted.
    const handleWorkspaceSourceUpdated = (event: DeepWorkSourceUpdatedEvent) => {
      const current = draftRef.current;
      const decision = deepWorkSourceRefreshDecision({
        deepWorkActive: Boolean(
          activeDeepWorkWorkspace(projectWorkspaceRef.current, current?.path ?? null)
        ),
        sessionRootPath: workspaceSessionRef.current?.rootPath ?? null,
        activeWorkspacePath: activeJupyterFocusRef.current?.workspacePath ?? null,
        activeDocumentDirty: activeJupyterFocusRef.current?.isDirty ?? null,
        event,
      });
      if (decision.kind !== "reload-document") return;
      setWorkspaceDocumentReload((current) => ({
        path: decision.path,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    };

    socket.on("connect", handleSocketConnect);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("connect_error", handleSocketConnectError);
    socket.on("file_updated", handleFileUpdated);
    socket.on("jupyter_notebook_updated", handleJupyterNotebookUpdated);
    socket.on("workspace_source_updated", handleWorkspaceSourceUpdated);

    return () => {
      socket.off("connect", handleSocketConnect);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("connect_error", handleSocketConnectError);
      socket.off("chat_event", handleTurnEvent);
      socket.off("file_updated", handleFileUpdated);
      socket.off("jupyter_notebook_updated", handleJupyterNotebookUpdated);
      socket.off("workspace_source_updated", handleWorkspaceSourceUpdated);
      socket.disconnect();
      socketRef.current = null;
      setSyncConnectionState("disconnected");
    };
  }, [checkActivePageForExternalUpdate, clearCompanionActiveTurnPointer, updateAiMessage]);

  React.useEffect(() => {
    let ignore = false;

    async function loadChatModel() {
      try {
        const [providersResponse, settingsResponse, agentSettingsResponse, fastLaneSettings] = await Promise.all([
          fetch("/api/chat/providers"),
          fetch("/api/chat/settings"),
          fetch("/api/agent-settings"),
          fetchJupyterFastLaneSettings().catch(() => ({
            fastLaneProvider: "claude",
            fastLaneModel: "haiku",
            fastLaneEffort: "low",
          })),
        ]);

        const providersPayload = (await providersResponse.json()) as ChatProvidersResponse;
        const settingsPayload = (await settingsResponse.json()) as ChatSettingsResponse;
        const agentSettingsPayload = (await agentSettingsResponse.json()) as AgentSettingsResponse;
        if (ignore) {
          return;
        }

        aiStoredSettingsRef.current = settingsPayload;
        setAiProviders(providersPayload.providers ?? []);
        const selection = resolveAiProviderSelection(
          providersPayload.providers ?? [],
          settingsPayload,
          providersPayload.default
        );
        setAiActiveProviderId(selection.providerId);
        setAiActiveModel(selection.model);
        setAiActiveEffort(resolveProviderEffort(settingsPayload, selection.providerId));
        setFastLaneProviderId(fastLaneSettings.fastLaneProvider);
        setFastLaneModel(fastLaneSettings.fastLaneModel);
        setAiVerboseEnabled(settingsPayload.verbose !== false);
        setAiSystemPrompt(agentSettingsPayload.systemPrompt ?? "");
        setAiDefaultSystemPrompt(agentSettingsPayload.defaultSystemPrompt ?? agentSettingsPayload.systemPrompt ?? "");
      } catch {
        if (!ignore) {
          setAiProviders([]);
          setAiActiveProviderId("");
          setAiActiveModel("");
          setAiVerboseEnabled(true);
          setAiSystemPrompt("");
          setAiDefaultSystemPrompt("");
        }
      }
    }

    void loadChatModel();

    return () => {
      ignore = true;
    };
  }, []);

  const persistAiProviderSelection = React.useCallback(
    async (providerId: string, model: string) => {
      const body: Record<string, string> = { defaultProvider: providerId };
      if (providerId === "claude" && model) body.claudeModel = model;
      if (providerId === "ghcopilot" && model) body.ghcopilotModel = model;
      if (providerId === "codex" && model) body.codexModel = model;
      if (providerId === "cursor" && model) body.cursorModel = model;
      await fetch("/api/chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const s = aiStoredSettingsRef.current;
      if (providerId === "claude" && model) s.claudeModel = model;
      else if (providerId === "ghcopilot" && model) s.ghcopilotModel = model;
      else if (providerId === "codex" && model) s.codexModel = model;
      else if (providerId === "cursor" && model) s.cursorModel = model;
    },
    []
  );

  const persistAiEffortSetting = React.useCallback(
    async (providerId: string, effort: string) => {
      const body: Record<string, string> = {};
      if (providerId === "ghcopilot") body.ghcopilotEffort = effort;
      else if (providerId === "codex") body.codexEffort = effort;
      else if (providerId === "cursor") body.cursorEffort = effort;
      else return; // unsupported provider — no-op
      await fetch("/api/chat/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const s = aiStoredSettingsRef.current;
      if (providerId === "ghcopilot") s.ghcopilotEffort = effort;
      else if (providerId === "codex") s.codexEffort = effort;
      else if (providerId === "cursor") s.cursorEffort = effort;
    },
    []
  );

  const persistAiVerboseSetting = React.useCallback(async (enabled: boolean) => {
    await fetch("/api/chat/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verbose: enabled }),
    });
    aiStoredSettingsRef.current.verbose = enabled;
  }, []);

  const persistAiSystemPrompt = React.useCallback(async (systemPrompt: string) => {
    const response = await fetch("/api/agent-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt }),
    });
    const payload = (await response.json()) as AgentSettingsResponse;
    if (!response.ok) {
      throw new Error("Failed to save system prompt");
    }
    setAiSystemPrompt(payload.systemPrompt ?? systemPrompt);
  }, []);

  const handleProviderChange = React.useCallback(
    async (providerId: string) => {
      const storedSettings = aiStoredSettingsRef.current;
      const selection = resolveAiProviderSelection(aiProviders, storedSettings, providerId);
      const nextModel = selection.model;
      const nextEffort = resolveProviderEffort(storedSettings, providerId);

      try {
        await persistAiProviderSelection(providerId, nextModel);
        setAiActiveProviderId(providerId);
        setAiActiveModel(nextModel);
        setAiActiveEffort(nextEffort);
      } catch {
        // silently ignore — stale selector state is acceptable
      }
    },
    [aiProviders, persistAiProviderSelection]
  );

  const handleEffortChange = React.useCallback(
    async (effort: string) => {
      const previousEffort = aiActiveEffort;
      setAiActiveEffort(effort);
      try {
        await persistAiEffortSetting(aiActiveProviderId, effort);
      } catch {
        setAiActiveEffort(previousEffort);
      }
    },
    [aiActiveEffort, aiActiveProviderId, persistAiEffortSetting]
  );

  const handleModelChange = React.useCallback(
    async (providerId: string, model: string) => {
      if (!providerId) {
        return;
      }

      try {
        await persistAiProviderSelection(providerId, model);
        setAiActiveProviderId(providerId);
        setAiActiveModel(model);
      } catch {
        // silently ignore — stale selector state is acceptable
      }
    },
    [persistAiProviderSelection]
  );

  const handleVerboseChange = React.useCallback(
    async (enabled: boolean) => {
      const previousEnabled = aiVerboseEnabled;
      setAiVerboseEnabled(enabled);

      try {
        await persistAiVerboseSetting(enabled);
      } catch {
        setAiVerboseEnabled(previousEnabled);
      }
    },
    [aiVerboseEnabled, persistAiVerboseSetting]
  );

  const handleFastLaneProviderChange = React.useCallback(async (providerId: string) => {
    const provider = aiProviders.find((candidate) => candidate.id === providerId);
    if (!provider) return;
    const previousProvider = fastLaneProviderId;
    const previousModel = fastLaneModel;
    const model = pickJupyterFastLaneModel(providerId, provider.models ?? []);
    setFastLaneProviderId(providerId);
    setFastLaneModel(model);
    try {
      const saved = await saveJupyterFastLaneSettings({
        fastLaneProvider: providerId,
        fastLaneModel: model,
      });
      setFastLaneProviderId(saved.fastLaneProvider);
      setFastLaneModel(saved.fastLaneModel);
    } catch {
      setFastLaneProviderId(previousProvider);
      setFastLaneModel(previousModel);
    }
  }, [aiProviders, fastLaneModel, fastLaneProviderId]);

  const handleFastLaneModelChange = React.useCallback(async (providerId: string, model: string) => {
    if (!providerId) return;
    const previousProvider = fastLaneProviderId;
    const previousModel = fastLaneModel;
    setFastLaneProviderId(providerId);
    setFastLaneModel(model);
    try {
      const saved = await saveJupyterFastLaneSettings({
        fastLaneProvider: providerId,
        fastLaneModel: model,
      });
      setFastLaneProviderId(saved.fastLaneProvider);
      setFastLaneModel(saved.fastLaneModel);
    } catch {
      setFastLaneProviderId(previousProvider);
      setFastLaneModel(previousModel);
    }
  }, [fastLaneModel, fastLaneProviderId]);

  React.useEffect(() => {
    // SN-202/SN-132 — Thread identity changed (different store path or scope):
    // DETACH from any running turn (never cancel it) and reset provider continuity
    // so the new thread starts fresh. Keyed on the resolved (storePath, scopeKey),
    // NOT the raw page: navigating WITHIN a shared scope (e.g. between pages of one
    // page_tree, same subtree root) keeps the same thread, so we neither detach the
    // live turn nor reset the conversation — the reply keeps streaming into the
    // still-displayed shared transcript, and the reattach effect owns re-entry.
    //
    // We intentionally no longer blanket-reset scope to 'whole' on navigation
    // (SN-202 Problem 3/4 root seam); the availability effect below narrows scope
    // only when the destination page cannot honor the current selection.
    detachActiveTurn();
    void resetProviderSession();
  }, [companionStorePath, companionScopeKey, detachActiveTurn, resetProviderSession]);

  React.useEffect(() => {
    resetAiComposer();
  }, [draft?.path, companionScopeKey, resetAiComposer]);

  // SN-80/SN-202 — Keep ON: restore the saved thread for the active thread IDENTITY
  // (storePath + scope), saving the outgoing thread first so switching scope/page
  // never loses a conversation. Addressing by storePath means the correct shared
  // thread is restored (not silently the 'whole' thread) and navigating within a
  // shared subtree keeps the same thread without a reload.
  React.useEffect(() => {
    if (!vaultUiStateHydrated || !keepConversation) {
      return;
    }
    const path = companionStorePath || null;
    if (!path) {
      companionLoadedRef.current = null;
      return;
    }
    const scopeKey = companionScopeKey;
    const loaded = companionLoadedRef.current;
    if (loaded && loaded.path === path && loaded.scopeKey === scopeKey) {
      return;
    }
    if (loaded) {
      void saveCompanionThread(loaded.path, loaded.scopeKey, aiMessagesRef.current);
    }

    const generation = ++companionLoadGenRef.current;
    void (async () => {
      const sidecar =
        companionSidecarRef.current && companionPageRef.current === path
          ? companionSidecarRef.current
          : await fetchCompanionSessions(path).catch(() => createEmptyCompanionSidecar());
      if (generation !== companionLoadGenRef.current) {
        return;
      }
      companionSidecarRef.current = sidecar;
      companionPageRef.current = path;
      const session = getCompanionScopeSession(sidecar, scopeKey);
      const restoredMessages = session ? fromStoredCompanionMessages(session.messages) : [];
      aiMessagesRef.current = restoredMessages;
      aiMessagesBindingKeyRef.current = `${path}::${scopeKey}`;
      setAiMessages(restoredMessages);
      companionResumeIdRef.current = session?.resumeId ?? null;
      const providerPreferences = readCompanionProviderPreferences(session);
      if (providerPreferences) {
        setAiActiveProviderId(providerPreferences.providerId);
        if (providerPreferences.model) {
          setAiActiveModel(providerPreferences.model);
        }
        if (providerPreferences.effort) {
          setAiActiveEffort(providerPreferences.effort);
        }
      }
      companionLoadedRef.current = { path, scopeKey };
    })();
  }, [vaultUiStateHydrated, keepConversation, companionStorePath, companionScopeKey, saveCompanionThread]);

  // SN-80 — Unchecked: dispose the in-memory transcript on page change; clear persisted
  // data only for the page+scope being left (navigation) or the active page (uncheck).
  React.useEffect(() => {
    if (!vaultUiStateHydrated) {
      return;
    }

    if (keepConversation) {
      prevKeepConversationRef.current = keepConversation;
      prevCompanionDisposeRef.current = {
        path: companionStorePath || null,
        scopeKey: companionScopeKey,
      };
      return;
    }

    // SN-202: dispose/cleanup by the resolved store identity, so navigating within
    // a shared subtree is not treated as "navigated away" from the shared thread.
    const path = companionStorePath || null;
    const currentKey = path ? `${path}::${companionScopeKey}` : null;
    const previous = prevCompanionDisposeRef.current;
    const previousPath = previous.path;
    const previousScopeKey = previous.scopeKey;
    const navigatedAway =
      previousPath !== null && path !== null && previousPath !== path;
    const turnedOffKeep = prevKeepConversationRef.current && !keepConversation;

    const volatileSession =
      path && typeof window !== "undefined"
        ? readVolatileCompanionSession(window.sessionStorage)
        : null;
    const canRestoreVolatile =
      Boolean(volatileSession) &&
      volatileSession?.pagePath === path &&
      volatileSession.scopeKey === companionScopeKey &&
      restoredVolatileCompanionRef.current !== currentKey;

    companionLoadedRef.current = null;
    companionSidecarRef.current = null;
    companionPageRef.current = path;
    companionResumeIdRef.current = canRestoreVolatile ? volatileSession?.resumeId ?? null : null;
    companionLoadGenRef.current += 1;
    const restoredMessages =
      canRestoreVolatile && volatileSession
        ? fromStoredCompanionMessages(volatileSession.messages)
        : [];
    aiMessagesRef.current = restoredMessages;
    aiMessagesBindingKeyRef.current = currentKey;
    setAiMessages(restoredMessages);
    if (canRestoreVolatile && volatileSession) {
      const providerPreferences = readCompanionProviderPreferences(volatileSession);
      if (providerPreferences) {
        setAiActiveProviderId(providerPreferences.providerId);
        if (providerPreferences.model) {
          setAiActiveModel(providerPreferences.model);
        }
        if (providerPreferences.effort) {
          setAiActiveEffort(providerPreferences.effort);
        }
      }
    }
    restoredVolatileCompanionRef.current = currentKey;

    if (navigatedAway && previousPath) {
      void clearCompanionScopeOnPage(previousPath, previousScopeKey);
      clearVolatileCompanionSession();
    } else if (turnedOffKeep && path) {
      void clearCompanionScopeOnPage(path, companionScopeKey);
    }

    prevKeepConversationRef.current = keepConversation;
    prevCompanionDisposeRef.current = {
      path,
      scopeKey: companionScopeKey,
    };
  }, [
    vaultUiStateHydrated,
    keepConversation,
    companionStorePath,
    companionScopeKey,
    clearCompanionScopeOnPage,
    clearVolatileCompanionSession,
  ]);

  // SN-80 — Unchecked: closing the companion disposes the transcript and persisted
  // session for the active page + scope key.
  // SN-132: if a server-owned turn is still in flight, closing the panel DETACHES
  // only — the turn keeps running and its durable pointer is preserved so
  // reopening reattaches instead of orphaning the turn.
  React.useEffect(() => {
    if (!vaultUiStateHydrated || keepConversation || aiOpen) {
      return;
    }
    clearVolatileCompanionSession();
    const hasLiveTurn = Boolean(activeTurnIdRef.current || activeTurnContextRef.current);
    if (hasLiveTurn) {
      detachActiveTurn();
      return;
    }
    aiMessagesRef.current = [];
    aiMessagesBindingKeyRef.current = companionStorePathRef.current
      ? `${companionStorePathRef.current}::${companionScopeKeyRef.current}`
      : null;
    setAiMessages([]);
    const path = companionStorePathRef.current || null;
    if (path) {
      void clearCompanionScopeOnPage(path, companionScopeKeyRef.current);
    }
  }, [
    aiOpen,
    keepConversation,
    vaultUiStateHydrated,
    clearCompanionScopeOnPage,
    detachActiveTurn,
    clearVolatileCompanionSession,
  ]);

  // SN-132: discover any durable live-turn pointer and reattach to (or reconcile)
  // it. Runs independently of the Keep toggle — an in-flight or just-completed
  // server turn must be recovered after page navigation, app backgrounding, or a
  // full PWA relaunch. The vault sidecar is the source of truth; the
  // server-authoritative live-run lookup inside reattachOrReconcileTurn decides
  // reattach vs. terminal reconcile.
  //
  // SN-211: also run while the companion is CLOSED so a turn that finished during
  // in-app navigation (or whose terminal stream event was missed) can light the
  // ready badge without reopening. Terminal reconcile uses aiOpenRef to decide
  // ready vs. silent recovery; opening still clears ready (viewed = acknowledged).
  React.useEffect(() => {
    if (!vaultUiStateHydrated) {
      return;
    }
    const path = companionStorePath || null;
    if (!path) {
      return;
    }
    const scopeKey = companionScopeKey;
    // Cold-start scope selection defaults can differ from the turn's origin.
    // Probe every store identity reachable from this page (page, section, and
    // subtree root), then switch to the originating scope before reattaching.
    const candidateStores = [
      { path, preferredScopeKey: scopeKey },
      draft?.path ? { path: draft.path, preferredScopeKey: "whole" } : null,
      draft?.sectionPath ? { path: draft.sectionPath, preferredScopeKey: "section" } : null,
      companionSubtreeRootPath
        ? { path: companionSubtreeRootPath, preferredScopeKey: "page_tree" }
        : null,
    ].filter(
      (candidate): candidate is { path: string; preferredScopeKey: string } =>
        Boolean(candidate?.path)
    );
    const uniqueCandidateStores = candidateStores.filter(
      (candidate, index, all) =>
        all.findIndex((entry) => entry.path === candidate.path) === index
    );
    const discoveryKey = uniqueCandidateStores
      .map((candidate) => candidate.path)
      .sort()
      .join("::");
    if (reattachDiscoveryKeyRef.current === discoveryKey) {
      return;
    }
    reattachDiscoveryKeyRef.current = discoveryKey;

    let cancelled = false;
    void (async () => {
      let found:
        | {
            path: string;
            scopeKey: string;
            pointer: CompanionActiveTurn;
            sidecar: CompanionSidecar | null;
          }
        | null = null;
      if (companionSidecarRef.current && companionPageRef.current === path) {
        const active = findCompanionActiveTurn(companionSidecarRef.current, scopeKey);
        if (active) {
          found = { path, ...active, sidecar: companionSidecarRef.current };
        }
      }
      if (!found && typeof window !== "undefined") {
        const volatile = readVolatileCompanionSession(window.sessionStorage);
        if (volatile?.activeTurn && uniqueCandidateStores.some((candidate) => candidate.path === volatile.pagePath)) {
          found = {
            path: volatile.pagePath,
            scopeKey: volatile.scopeKey,
            pointer: volatile.activeTurn,
            sidecar: null,
          };
        }
      }
      for (const candidate of uniqueCandidateStores) {
        if (found) break;
        const sidecar = await fetchCompanionSessions(candidate.path).catch(() => null);
        if (cancelled) {
          return;
        }
        if (sidecar) {
          const active = findCompanionActiveTurn(sidecar, candidate.preferredScopeKey);
          if (active) {
            found = { path: candidate.path, ...active, sidecar };
          }
        }
      }
      if (cancelled || !found) {
        return;
      }
      const targetScope = companionScopeFromKey(found.scopeKey);
      if (!targetScope) {
        return;
      }
      if (
        companionStorePathRef.current !== found.path ||
        companionScopeKeyRef.current !== found.scopeKey
      ) {
        companionSidecarRef.current = found.sidecar;
        companionPageRef.current = found.path;
        reattachDiscoveryKeyRef.current = null;
        setAiScope(targetScope);
        return;
      }
      if (activeTurnIdRef.current === found.pointer.turnId) {
        return;
      }
      await reattachOrReconcileTurn(found.path, found.scopeKey, found.pointer);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    vaultUiStateHydrated,
    aiOpen,
    companionStorePath,
    companionScopeKey,
    companionSubtreeRootPath,
    draft?.path,
    draft?.sectionPath,
    reattachOrReconcileTurn,
  ]);

  // Keep OFF: preserve the current tab's visible transcript across a hard app
  // reload only. This intentionally uses sessionStorage, not the vault sidecar.
  React.useEffect(() => {
    if (!vaultUiStateHydrated || keepConversation) {
      return;
    }
    const path = companionStorePath || null;
    if (!path) {
      clearVolatileCompanionSession();
      return;
    }
    const scopeKey = companionScopeKey;
    const snapshot = aiMessages;
    const resumeId = companionResumeIdRef.current;
    const timer = window.setTimeout(() => {
      const providerPreferences = readCurrentCompanionProviderPreferences(
        aiActiveProviderIdRef.current,
        aiActiveModelRef.current,
        aiActiveEffortRef.current
      );
      writeVolatileCompanionSession(window.sessionStorage, {
        pagePath: path,
        scopeKey,
        messages: toStoredCompanionMessages(snapshot),
        resumeId,
        ...(providerPreferences ?? {}),
      });
    }, VOLATILE_COMPANION_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    vaultUiStateHydrated,
    keepConversation,
    aiMessages,
    aiActiveProviderId,
    aiActiveModel,
    aiActiveEffort,
    companionScopeKey,
    companionStorePath,
    clearVolatileCompanionSession,
  ]);

  // SN-80 — Keep ON: debounced persistence of the active thread as it changes.
  React.useEffect(() => {
    if (!vaultUiStateHydrated || !keepConversation) {
      return;
    }
    const path = companionStorePath || null;
    if (!path || aiTurnActive) {
      return;
    }
    const scopeKey = companionScopeKey;
    const snapshot = aiMessages;
    const timer = window.setTimeout(() => {
      void saveCompanionThread(path, scopeKey, snapshot);
    }, COMPANION_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    vaultUiStateHydrated,
    keepConversation,
    aiTurnActive,
    aiMessages,
    aiActiveProviderId,
    aiActiveModel,
    aiActiveEffort,
    companionScopeKey,
    companionStorePath,
    saveCompanionThread,
  ]);

  React.useEffect(() => {
    setAiScope((current) =>
      normalizeAiScopeForAvailability(current, {
        hasSections: Boolean(draft?.sectionPath),
        hasPageChildren: hasPageTreeScope,
        hasParentContext: isParentContextScopeAvailable(aiParentInfo),
      })
    );
  }, [aiParentInfo, draft?.path, draft?.sectionPath, hasPageTreeScope]);

  const hydrateDraft = React.useCallback((nextDraft: PageDraft | null) => {
    hydratingRef.current = true;
    draftRef.current = nextDraft;
    if (nextDraft?.noteType === "text") {
      pageContentCache.set(nextDraft.path, { html: nextDraft.content });
    }
    setDraft(nextDraft);
    lastSavedSnapshotRef.current = nextDraft ? snapshotDraft(nextDraft) : null;
    setSaveState(nextDraft ? "saved" : "idle");
    setSaveError(null);
    setReloadSafetyMessage(null);
    setPendingPageReload((currentPending) =>
      currentPending && (!nextDraft || currentPending.page.path === nextDraft.path) ? null : currentPending
    );

    // SN-263: never persist a synthetic Deep Work path as the last vault page.
    if (nextDraft && typeof window !== "undefined" && !nextDraft.path.startsWith("deep-work-")) {
      window.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, nextDraft.path);
    }
  }, []);

  const applySelection = React.useCallback(
    (selection: TreeSelection) => {
      const nextPath = selection.page?.path ?? null;
      if (shouldLeaveDeepWorkForVaultSelection(projectWorkspaceRef.current, nextPath)) {
        // SN-266: selecting a vault note has the same live-session boundary as
        // Back to notes. Keep the sticky root in localStorage, but disarm it now
        // so a subsequent vault refresh cannot replace this selection.
        setOpenedWorkspace(null);
        projectWorkspaceRef.current = null;
        setWorkspaceSession(null);
        setActiveJupyterFocus(null);
        setWorkspaceDocumentReload(null);
        workspaceReturnStateRef.current = null;
      }
      if (nextPath !== draftRef.current?.path) {
        designRemoteWriteFenceRef.current = false;
        queuedSaveRef.current = false;
      }
      setActiveNotebookPath(selection.notebook?.path ?? null);
      setActiveSectionPath(selection.section?.path ?? null);
      setActivePagePath(selection.page?.path ?? null);
      hydrateDraft(selection.page ? draftFromTreePage(selection) : null);
    },
    [hydrateDraft]
  );

  const syncTreePage = React.useCallback((pagePath: string, update: (page: VaultPage) => VaultPage) => {
    setTree((currentTree) =>
      currentTree.map((notebook) => ({
        ...notebook,
        pages: notebook.pages.map((page) => (page.path === pagePath ? update(page) : page)),
        sections: notebook.sections.map((section) => ({
          ...section,
          pages: section.pages.map((page) => (page.path === pagePath ? update(page) : page)),
        })),
      }))
    );
  }, []);

  const replaceTreePage = React.useCallback((previousPath: string, nextPage: ApiPageDocument) => {
    setTree((currentTree) =>
      currentTree.map((notebook) => ({
        ...notebook,
        pages: notebook.pages.map((page) =>
          page.path === previousPath ? apiDocumentToVaultPage(nextPage) : page
        ),
        sections: notebook.sections.map((section) => ({
          ...section,
          pages: section.pages.map((page) =>
            page.path === previousPath
              ? apiDocumentToVaultPage(nextPage)
              : page
          ),
        })),
      }))
    );
  }, []);

  const applyVaultPayload = React.useCallback(
    (
      payload: VaultTreeResponse,
      preferred?: { notebookPath?: string | null; sectionPath?: string | null; pagePath?: string | null },
      options?: LoadTreeOptions
    ) => {
      setTree(payload.tree);
      setVaultRoot(payload.root);

      const shouldExpandAll = options?.expandAll ?? isInitialTreeLoadRef.current;
      const ensureExpanded =
        options?.ensureExpanded ??
        (preferred?.pagePath
          ? resolveTreeExpandPathsForPage(payload.tree, preferred.pagePath)
          : preferred
            ? {
                notebookPath: preferred.notebookPath,
                sectionPath: preferred.sectionPath,
                pagePath: preferred.pagePath,
              }
            : undefined);

      if (shouldExpandAll) {
        const persisted = vaultUiStateRef.current;

        if (hasPersistedExpandState(persisted)) {
          const notebookPaths = new Set(payload.tree.map((notebook) => notebook.path));
          const sectionPaths = new Set(
            payload.tree.flatMap((notebook) => notebook.sections.map((section) => section.path))
          );
          setExpandedNotebooks(filterPersistedPaths(persisted?.expandedNotebooks, notebookPaths));
          setExpandedSections(filterPersistedPaths(persisted?.expandedSections, sectionPaths));
        } else {
          setExpandedNotebooks(new Set(payload.tree.map((notebook) => notebook.path)));
          setExpandedSections(
            new Set(payload.tree.flatMap((notebook) => notebook.sections.map((section) => section.path)))
          );
        }
      } else if (ensureExpanded) {
        const merged = mergeTreeExpandState(
          {
            notebooks: expandedNotebooksRef.current,
            sections: expandedSectionsRef.current,
            pages: expandedPagesRef.current,
          },
          ensureExpanded,
          collectVaultPageLookups(payload.tree)
        );
        setExpandedNotebooks(merged.notebooks);
        setExpandedSections(merged.sections);
        setExpandedPages(merged.pages);
      }

      isInitialTreeLoadRef.current = false;
      // SN-262: read the workspace from a ref, not the closure. A sticky restore
      // that fails server validation clears the workspace while the initial tree
      // fetch is still in flight; the stale closure would otherwise re-select the
      // dead Deep Work draft when that fetch resolves.
      const currentWorkspace = activeDeepWorkWorkspace(
        projectWorkspaceRef.current,
        draftRef.current?.path
      );
      if (currentWorkspace) {
        const workspaceDraft = deepWorkDraft(currentWorkspace);
        setActiveNotebookPath(null);
        setActiveSectionPath(null);
        setActivePagePath(workspaceDraft.path);
        draftRef.current = workspaceDraft;
        setDraft(workspaceDraft);
        // SN-263: keep Deep Work out of the vault pending-reload dirty gate.
        lastSavedSnapshotRef.current = snapshotDraft(workspaceDraft);
        setPendingPageReload(null);
        setPendingVaultReload(null);
        setReloadSafetyMessage(null);
        return;
      }
      const selection = resolveSelection(payload.tree, {
        pagePath:
          preferred?.pagePath ??
          (typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) : null) ??
          activePagePathRef.current,
        sectionPath: preferred?.sectionPath ?? activeSectionPathRef.current,
        notebookPath: preferred?.notebookPath ?? activeNotebookPathRef.current,
      });

      applySelection(selection);
    },
    [applySelection]
  );

  const loadTree = React.useCallback(
    async (
      preferred?: { notebookPath?: string | null; sectionPath?: string | null; pagePath?: string | null },
      options?: LoadTreeOptions & { coldStart?: boolean }
    ) => {
      const payload = await fetchVaultTree({
        sequential: startupBaselineMode || undefined,
        skipCache: options?.skipCache || startupBaselineMode || undefined,
      });
      applyVaultPayload(payload, preferred, options);
    },
    [applyVaultPayload, startupBaselineMode]
  );

  const canAutoRefreshVaultTree = React.useCallback(() => {
    if (savingRef.current || timerRef.current) {
      return false;
    }
    if (
      draftRef.current?.noteType === "spreadsheet" &&
      spreadsheetPageRef.current?.hasPendingChanges()
    ) {
      return false;
    }
    return !hasUnsavedLocalDraftChanges(draftRef.current, lastSavedSnapshotRef.current);
  }, []);

  const refreshVaultTreeFromLive = React.useCallback(async () => {
    if (!canAutoRefreshVaultTree()) {
      setPendingVaultReload({ detectedAt: Date.now() });
      return false;
    }

    try {
      await loadTree({ pagePath: activePagePathRef.current }, { skipCache: true });
      setPendingVaultReload(null);
      return true;
    } catch {
      setPendingVaultReload({ detectedAt: Date.now() });
      return false;
    }
  }, [canAutoRefreshVaultTree, loadTree]);

  const clearGhostDismissTimers = React.useCallback(() => {
    if (ghostDismissTimerRef.current) {
      clearTimeout(ghostDismissTimerRef.current);
      ghostDismissTimerRef.current = null;
    }
    if (ghostFadeTimerRef.current) {
      clearTimeout(ghostFadeTimerRef.current);
      ghostFadeTimerRef.current = null;
    }
  }, []);

  const dismissGhostVersions = React.useCallback(() => {
    clearGhostDismissTimers();
    setGhostVersions(null);
    setGhostContextMenu(null);
    setVersionPreview(null);
  }, [clearGhostDismissTimers]);

  const scheduleGhostDismiss = React.useCallback(() => {
    clearGhostDismissTimers();
    ghostDismissTimerRef.current = setTimeout(() => {
      setGhostVersions((current) => (current ? { ...current, dismissing: true } : null));
      ghostFadeTimerRef.current = setTimeout(() => {
        setGhostVersions(null);
        setGhostContextMenu(null);
      }, GHOST_VERSION_FADE_MS);
    }, GHOST_VERSION_DISMISS_MS);
  }, [clearGhostDismissTimers]);

  const snapshotLeavingPage = React.useCallback(async (pagePath: string | null) => {
    if (!pagePath) {
      return;
    }

    const leavingDraft = draftRef.current;
    // Jupyter notes are owned by the Jupyter runtime; there is no Smart Notes
    // content to snapshot/version for them.
    if (leavingDraft?.path === pagePath && leavingDraft.noteType === "jupyter") {
      return;
    }
    if (leavingDraft?.path === pagePath && leavingDraft.noteType === "ink") {
      try {
        await inkCanvasRef.current?.flush();
      } catch {
        // snapshot still attempts with last saved ink sidecar
      }
    }
    if (leavingDraft?.path === pagePath && leavingDraft.noteType === "spreadsheet") {
      try {
        await spreadsheetPageRef.current?.flush();
      } catch {
        // snapshot still attempts with the last saved workbook sidecar
      }
    }
    if (leavingDraft?.path === pagePath && leavingDraft.noteType === "text") {
      try {
        await annotationLayerRef.current?.flush();
      } catch {
        // snapshot still attempts with last saved annotations sidecar
      }
    }

    try {
      await snapshotPageVersion(pagePath);
    } catch {
      // non-fatal
    }
  }, []);

  const handleTogglePageVersions = React.useCallback(
    async (pagePath: string) => {
      setPageContextMenu(null);
      if (ghostVersions?.parentPagePath === pagePath && !ghostVersions.dismissing) {
        dismissGhostVersions();
        return;
      }

      try {
        const { versions, noteType } = await fetchPageVersions(pagePath);
        setExpandedPages((current) => new Set([...current, pagePath]));
        setGhostVersions({
          parentPagePath: pagePath,
          versions,
          noteType,
          dismissing: false,
        });
        scheduleGhostDismiss();
      } catch {
        // non-fatal
      }
    },
    [dismissGhostVersions, ghostVersions, scheduleGhostDismiss]
  );

  const exitVersionPreview = React.useCallback(() => {
    setVersionPreview(null);
  }, []);

  const handleRestoreGhostVersion = React.useCallback(
    async (parentPagePath: string, versionId: string) => {
      setGhostContextMenu(null);
      setVersionPreview(null);
      dismissGhostVersions();

      try {
        if (activePagePathRef.current === parentPagePath) {
          const saved = await flushSaveRef.current();
          if (!saved) return;
        }
        const result = await restorePageVersion(parentPagePath, versionId, {
          originSocketId: socketRef.current?.id,
          originClientId: syncOriginIdRef.current ?? undefined,
        });
        if (activePagePathRef.current === parentPagePath) {
          if (result.kind === "ink") {
            setInkReloadNonce((current) => current + 1);
          } else if (result.kind === "spreadsheet") {
            setSpreadsheetReloadNonce((current) => current + 1);
          } else {
            const cached = pageContentCache.get(parentPagePath);
            if (cached) {
              pageContentCache.set(parentPagePath, {
                html: cached.html,
                annotationsReady: false,
                annotationsScene: null,
              });
            }
            void pageContentCache.ensureAnnotations(parentPagePath).then(({ scene }) => {
              if (activePagePathRef.current === parentPagePath) {
                annotationLayerRef.current?.loadScene(
                  (scene as import("tldraw").TLStoreSnapshot | null) ?? null
                );
              }
            });
          }
        }
        await loadTree({ pagePath: activePagePathRef.current });
      } catch {
        // non-fatal
      }
    },
    [dismissGhostVersions, loadTree]
  );

  React.useEffect(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    const handleVaultUpdated = () => {
      void refreshVaultTreeFromLive();
    };

    socket.on("vault_updated", handleVaultUpdated);
    return () => {
      socket.off("vault_updated", handleVaultUpdated);
    };
  }, [refreshVaultTreeFromLive]);

  const flushSave = React.useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft) {
      return true;
    }
    if (currentDraft.path.startsWith("deep-work-")) {
      // Project files are saved by JupyterLab or the revision-guarded workspace
      // source API, never by the vault page autosave pipeline.
      return true;
    }

    if (
      shouldBlockPendingPageReload({
        draft: currentDraft,
        pendingPath: pendingPageReloadRef.current?.page.path,
        lastSavedSnapshot: lastSavedSnapshotRef.current,
        hasUnsavedSurfaceChanges:
          currentDraft.noteType === "spreadsheet" &&
          (spreadsheetPageRef.current?.hasPendingChanges() ?? false),
      })
    ) {
      setReloadSafetyMessage("Local unsaved edits must be saved or discarded before reloading external changes.");
      return false;
    }

    const snapshot = snapshotDraft(currentDraft);
    // App source is deliberately isolated from the shell draft autosave path.
    // AppPageView alone may persist it via explicit Save, eliminating late PUT
    // races with companion app_update and preserving unsaved CodeMirror edits.
    if (currentDraft.noteType === "app") return true;
    if (currentDraft.noteType === "spreadsheet") {
      try {
        await spreadsheetPageRef.current?.flush();
        return true;
      } catch (error) {
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Workbook save failed.");
        return false;
      }
    }
    if (snapshot === lastSavedSnapshotRef.current) {
      return true;
    }

    // Companion/external design write wins: do not PUT stale Source-tab content.
    if (designRemoteWriteFenceRef.current && currentDraft.noteType === "design") {
      queuedSaveRef.current = false;
      return true;
    }

    if (savingRef.current) {
      queuedSaveRef.current = true;
      return true;
    }

    savingRef.current = true;
    setSaveState("saving");
    setSaveError(null);

    try {
      // Re-check immediately before the network write — file_updated may have
      // armed the fence after we passed the early return above.
      if (designRemoteWriteFenceRef.current && currentDraft.noteType === "design") {
        queuedSaveRef.current = false;
        setSaveState("dirty");
        return true;
      }

      const savedPage = await saveVaultPage({
        path: currentDraft.path,
        title: currentDraft.title,
        content: currentDraft.content,
        originSocketId: socketRef.current?.id,
        originClientId: syncOriginIdRef.current ?? undefined,
      });

      // If a companion write armed the fence during the await, restore the
      // companion body so our stale PUT does not stick past Reload.
      if (designRemoteWriteFenceRef.current && currentDraft.noteType === "design") {
        const pending = pendingPageReloadRef.current;
        const companionContent =
          pending?.page.path === currentDraft.path
            ? (pending.page.content ?? (pending.page as { body?: string }).body)
            : undefined;
        if (typeof companionContent === "string") {
          try {
            await saveVaultPage({
              path: currentDraft.path,
              title: currentDraft.title,
              content: companionContent,
              originSocketId: socketRef.current?.id,
              originClientId: syncOriginIdRef.current ?? undefined,
            });
          } catch {
            // Keep the pending-reload banner; owner Reload still fetches disk.
          }
        }
        queuedSaveRef.current = false;
        setSaveState("dirty");
        return true;
      }

      const savedDraft = {
        ...currentDraft,
        ...savedPage,
      };

      pageContentCache.set(savedPage.path, { html: savedPage.content });
      lastSavedSnapshotRef.current = snapshot;
      replaceTreePage(currentDraft.path, savedPage);

      if (draftRef.current && snapshotDraft(draftRef.current) === snapshot) {
        hydrateDraft(savedDraft);
      } else {
        if (draftRef.current?.path === currentDraft.path) {
          const rebasedDraft = rebaseDraftAfterSave(draftRef.current, savedPage);

          draftRef.current = rebasedDraft;
          setDraft(rebasedDraft);
        }

        queuedSaveRef.current = true;
        setSaveState("dirty");
      }

      return true;
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Save failed.");
      return false;
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current) {
        if (designRemoteWriteFenceRef.current && draftRef.current?.noteType === "design") {
          queuedSaveRef.current = false;
        } else {
          queuedSaveRef.current = false;
          void flushSave();
        }
      }
    }
  }, [hydrateDraft, replaceTreePage]);
  flushSaveRef.current = flushSave;

  const handlePreviewGhostVersion = React.useCallback(
    async (parentPagePath: string, versionId: string, versionTs: string) => {
      setGhostContextMenu(null);
      scheduleGhostDismiss();

      if (activePagePathRef.current === parentPagePath) {
        const saved = await flushSave();
        if (!saved) return;
      }

      if (activePagePathRef.current !== parentPagePath) {
        const canLeave = await flushSave();
        if (!canLeave) {
          return;
        }
        if (activePagePathRef.current) {
          await snapshotLeavingPage(activePagePathRef.current);
        }

        const selection = resolveSelection(tree, { pagePath: parentPagePath });
        if (!selection.page) {
          return;
        }
        applySelection(selection);
        setSidebarOpen(false);
      }

      try {
        const payload = await fetchPageVersionContent(parentPagePath, versionId);
        setVersionPreview({
          parentPagePath,
          versionId,
          versionTs,
          noteType: payload.noteType,
          content: payload.content,
          annotationsContent: payload.annotationsContent ?? null,
        });
      } catch {
        // non-fatal
      }
    },
    [applySelection, flushSave, scheduleGhostDismiss, snapshotLeavingPage, tree]
  );

  React.useEffect(() => {
    let ignore = false;

    setClosedNotebooks(readPersistedClosedNotebooks());

    void (async () => {
      try {
        const response = await fetch("/api/ui-state", { cache: "no-store" });
        if (!response.ok) {
          if (!ignore) {
            setClosedNotebooks(readPersistedClosedNotebooks());
          }
          return;
        }
        const payload = (await response.json()) as { state?: VaultUiStatePayload };
        if (ignore) {
          return;
        }
        vaultUiStateRef.current = payload.state ?? null;
        const state = payload.state ?? null;
        const persistCompanion = Boolean(activeProjectWorkspace) || state?.companionPersist === true;
        keepConversationRef.current = persistCompanion;
        setKeepConversation(persistCompanion);
        const currentTree = treeRef.current;
        if (state && currentTree.length > 0) {
          const notebookPaths = new Set(currentTree.map((notebook) => notebook.path));
          const sectionPaths = new Set(
            currentTree.flatMap((notebook) => notebook.sections.map((section) => section.path))
          );
          setExpandedNotebooks(filterPersistedPaths(state.expandedNotebooks, notebookPaths));
          setExpandedSections(filterPersistedPaths(state.expandedSections, sectionPaths));
        }
        setClosedNotebooks(
          resolveClosedNotebooksFromVaultState(state, readPersistedClosedNotebooks())
        );
        setPinnedNotebooks(new Set(state?.pinnedNotebooks ?? []));
        setPinnedPages(new Set(state?.pinnedPages ?? []));
        setNotebookOrder(state?.notebookOrder ?? []);
        setNotebookGroups(state?.notebookGroups ?? []);
        setArchivedNotebooks(new Set(state?.archivedNotebooks ?? []));
        if (Array.isArray(state?.expandedPages)) {
          setExpandedPages(new Set(state.expandedPages));
        }
      } catch {
        if (!ignore) {
          setClosedNotebooks(readPersistedClosedNotebooks());
        }
      } finally {
        if (!ignore) {
          setVaultUiStateHydrated(true);
        }
      }
    })();

    return () => {
      ignore = true;
    };
  }, [activeProjectWorkspace]);

  React.useEffect(() => {
    if (!vaultUiStateHydrated || isLoadingTree) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (isInitialTreeLoadRef.current) {
        return;
      }

      void fetch("/api/ui-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expandedNotebooks: [...expandedNotebooks],
          expandedSections: [...expandedSections],
          closedNotebooks: [...closedNotebooks],
          expandedPages: [...expandedPages],
          pinnedNotebooks: [...pinnedNotebooks],
          pinnedPages: [...pinnedPages],
          notebookOrder,
          notebookGroups,
          archivedNotebooks: [...archivedNotebooks],
        }),
      }).catch(() => undefined);
    }, VAULT_UI_STATE_SYNC_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [
    closedNotebooks,
    archivedNotebooks,
    expandedNotebooks,
    expandedPages,
    expandedSections,
    isLoadingTree,
    notebookGroups,
    notebookOrder,
    pinnedNotebooks,
    pinnedPages,
    vaultUiStateHydrated,
  ]);

  const didHydrateVaultRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (didHydrateVaultRef.current) {
      return;
    }
    didHydrateVaultRef.current = true;

    // SN-205: `/?page=<vault-relative>` deep-link honored on first hydration so a
    // focused/installed mini-app that calls openPage lands the main notebook on
    // the target page instead of the last-active page. Nonexistent targets fall
    // back through resolveSelection.
    const deepLinkPagePath = searchParams?.get("page")?.trim() || null;
    const preferred = deepLinkPagePath ? { pagePath: deepLinkPagePath } : undefined;

    void (async () => {
      try {
        if (serverVault) {
          applyVaultPayload(serverVault, preferred);
          await loadTree(preferred, { skipCache: true }).catch(() => undefined);
          return;
        }
        await loadTree(preferred, { coldStart: true, skipCache: true });
      } finally {
        setIsLoadingTree(false);
      }
    })();
  }, [applyVaultPayload, loadTree, searchParams, serverVault]);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleResume = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshVaultTreeFromLive();
      // Own-in-place (SN-167): a design page in a portable notebook is a real file
      // in a target repo that an external agent/editor may rewrite directly on
      // disk — with no vault API write and no companion chat_event to trigger
      // detection. Re-check the open design page on resume so those external
      // edits surface the reload banner instead of silently showing stale
      // content. Scoped to design pages to avoid changing text-page focus
      // behavior (where in-flight autosave could look like an external change).
      if (draftRef.current?.noteType === "design") {
        void checkActivePageForExternalUpdate("file");
      }
    };

    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [refreshVaultTreeFromLive, checkActivePageForExternalUpdate]);

  React.useEffect(() => {
    if (!draft) {
      return;
    }
    if (draft.path.startsWith("deep-work-")) {
      return;
    }

    if (hydratingRef.current) {
      hydratingRef.current = false;
      return;
    }

    const snapshot = snapshotDraft(draft);
    if (snapshot === lastSavedSnapshotRef.current) {
      return;
    }

    setSaveState("dirty");
    setSaveError(null);

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [draft, flushSave]);

  const updateDraft = React.useCallback(
    (patch: Partial<Pick<PageDraft, "title" | "content">>) => {
      setDraft((currentDraft: PageDraft | null) => {
        if (!currentDraft) {
          return currentDraft;
        }

        const nextDraft = { ...currentDraft, ...patch };
        draftRef.current = nextDraft;

        syncTreePage(currentDraft.path, (page) => ({
          ...page,
          title: patch.title ?? page.title,
          content: patch.content ?? page.content,
          preview: buildPreview(patch.content ?? page.content),
        }));

        return nextDraft;
      });
    },
    [syncTreePage]
  );

  const openPage = React.useCallback(
    async (pagePath: string) => {
      if (pagePath === activePagePathRef.current) {
        setVersionPreview(null);
        return;
      }

      const selection = resolveSelection(tree, { pagePath });
      if (!selection.page) {
        return;
      }

      const leavingPagePath = activePagePathRef.current;
      const leavingDraft = draftRef.current;
      const leavingSnapshot = leavingDraft ? snapshotDraft(leavingDraft) : null;
      const leavingSavedSnapshot = lastSavedSnapshotRef.current;

      if (leavingDraft?.noteType === "spreadsheet") {
        const saved = await flushSave();
        if (!saved) return;
      }

      setVersionPreview(null);
      dismissGhostVersions();

      applySelection(selection);
      setSidebarOpen(false);

      if (!leavingDraft || !leavingPagePath || leavingPagePath === pagePath) {
        return;
      }

      void (async () => {
        try {
          const needsSave = leavingSnapshot !== null && leavingSnapshot !== leavingSavedSnapshot;
          if (needsSave) {
            const savedPage = await saveVaultPage({
              path: leavingDraft.path,
              title: leavingDraft.title,
              content: leavingDraft.content,
            });
            replaceTreePage(leavingDraft.path, savedPage);
            pageContentCache.set(savedPage.path, { html: savedPage.content });
          }
          await snapshotLeavingPage(leavingPagePath);
        } catch (error) {
          setSaveState("error");
          setSaveError(error instanceof Error ? error.message : "Save failed.");
          const previousSelection = resolveSelection(tree, { pagePath: leavingPagePath });
          if (previousSelection.page) {
            applySelection(previousSelection);
          }
        }
      })();
    },
    [applySelection, dismissGhostVersions, flushSave, replaceTreePage, snapshotLeavingPage, tree]
  );

  // SN-205: host handler for a mini-app's `smartNotesApp.openPage(pagePath)`.
  // Only a canonical, existing vault-relative page is accepted; navigation reuses
  // the ordinary page-selection leave/save flow (`openPage`). External/absolute/
  // traversing/oversized/missing targets fail safely with an app-visible error.
  const findExistingPagePath = React.useCallback((candidate: string): string | null => {
    for (const notebook of treeRef.current) {
      if (notebook.pages.some((page) => page.path === candidate)) return candidate;
      for (const section of notebook.sections) {
        if (section.pages.some((page) => page.path === candidate)) return candidate;
      }
    }
    return null;
  }, []);

  const handleAppOpenPage = React.useCallback(
    async (pagePath: string): Promise<{ ok: boolean; error?: string }> => {
      const normalized = normalizeVaultRelativePagePath(pagePath);
      if (!normalized) {
        return { ok: false, error: "That is not a valid Smart Notes page path." };
      }
      const canonical =
        findExistingPagePath(pagePath) ?? findExistingPagePath(normalized);
      if (!canonical) {
        return { ok: false, error: "That Smart Notes page could not be found." };
      }
      try {
        const currentTree = treeRef.current;
        const ensureExpanded = resolveTreeExpandPathsForPage(currentTree, canonical);
        const expanded = mergeTreeExpandState(
          {
            notebooks: expandedNotebooksRef.current,
            sections: expandedSectionsRef.current,
            pages: expandedPagesRef.current,
          },
          ensureExpanded,
          collectVaultPageLookups(currentTree)
        );
        setExpandedNotebooks(expanded.notebooks);
        setExpandedSections(expanded.sections);
        setExpandedPages(expanded.pages);
        const notebookPath = ensureExpanded.notebookPath;
        if (notebookPath) {
          setClosedNotebooks((current) => {
            const next = new Set(current);
            next.delete(notebookPath);
            return next;
          });
        }
        await openPage(canonical);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "That page could not be opened.",
        };
      }
    },
    [findExistingPagePath, openPage]
  );

  const selectSection = React.useCallback(
    async (sectionPath: string) => {
      const leavingPagePath = activePagePathRef.current;
      const canLeave = await flushSave();
      if (!canLeave) {
        return;
      }
      if (leavingPagePath) {
        await snapshotLeavingPage(leavingPagePath);
      }
      dismissGhostVersions();

      const selection = resolveSelection(tree, { sectionPath });
      applySelection(selection);
    },
    [applySelection, dismissGhostVersions, flushSave, snapshotLeavingPage, tree]
  );

  const selectNotebook = React.useCallback(
    async (notebookPath: string) => {
      const leavingPagePath = activePagePathRef.current;
      const canLeave = await flushSave();
      if (!canLeave) {
        return;
      }
      if (leavingPagePath) {
        await snapshotLeavingPage(leavingPagePath);
      }
      dismissGhostVersions();

      const selection = resolveSelection(tree, { notebookPath });
      applySelection(selection);
    },
    [applySelection, dismissGhostVersions, flushSave, snapshotLeavingPage, tree]
  );

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      if (!activePagePathRef.current || !draftRef.current || versionPreviewRef.current) {
        return;
      }
      if (draftRef.current.path.startsWith("deep-work-")) {
        return;
      }

      event.preventDefault();
      void (async () => {
        await flushSave();
        if (draftRef.current?.noteType === "ink") {
          try {
            await inkCanvasRef.current?.flush();
          } catch {
            // continue to snapshot last saved ink sidecar
          }
        }
        if (draftRef.current?.noteType === "spreadsheet") {
          try {
            await spreadsheetPageRef.current?.flush();
          } catch {
            // continue to snapshot the last saved workbook sidecar
          }
        }
        const pagePath = activePagePathRef.current;
        if (pagePath) {
          await snapshotPageVersion(pagePath);
        }
      })();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flushSave]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (searchOpen || target?.closest(".ProseMirror") || target?.closest('[data-testid="editor-surface"]')) {
        return;
      }

      event.preventDefault();
      setSearchQuery("");
      setServerSearchResults([]);
      setServerSearchState("idle");
      setSearchOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen]);

  React.useEffect(() => {
    const handlePageHide = () => {
      const pagePath = activePagePathRef.current;
      if (!pagePath) {
        return;
      }
      void flushSave().then(() => snapshotLeavingPage(pagePath));
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [flushSave, snapshotLeavingPage]);

  // SN-85 reviewer fix: register the text-draft flush as a reload guard so
  // that triggerForceReload() (update banner + Settings → Reload app) attempts
  // to save any in-memory edits before the hard page reload.  If the flush
  // throws (e.g. offline), the caller will prompt the user to confirm.
  React.useEffect(() => {
    const drain = async (): Promise<void> => {
      const saved = await flushSaveRef.current();
      if (!saved) {
        throw new Error("Could not save changes — please check your connection.");
      }
    };
    return registerReloadDrain(drain);
  }, []);

  React.useEffect(() => () => clearGhostDismissTimers(), [clearGhostDismissTimers]);

  const closeNotebook = React.useCallback(
    (notebookPath: string) => {
      setClosedNotebooks((prev) => new Set([...prev, notebookPath]));
      if (activeNotebookPathRef.current === notebookPath) {
        setActiveNotebookPath(null);
        setActiveSectionPath(null);
        setActivePagePath(null);
        setDraft(null);
      }
    },
    []
  );

  const openNotebook = React.useCallback(
    (notebookPath: string) => {
      setClosedNotebooks((prev) => {
        const next = new Set(prev);
        next.delete(notebookPath);
        return next;
      });
      setExpandedNotebooks((prev) => new Set([...prev, notebookPath]));
    },
    []
  );

  const handleSidebarToggleNotebook = React.useCallback((path: string) => {
    setExpandedNotebooks((currentSet) => toggleSetValue(currentSet, path));
  }, []);

  const handleTogglePinnedNotebook = React.useCallback((path: string) => {
    setPinnedNotebooks((current) => toggleSetValue(current, path));
  }, []);

  const handleTogglePinnedPage = React.useCallback((path: string) => {
    setPinnedPages((current) => toggleSetValue(current, path));
  }, []);

  const handleReorderNotebooks = React.useCallback((sourcePath: string, targetPath: string) => {
    setNotebookOrder((current) =>
      reorderNotebookPaths(current, treeRef.current.map((notebook) => notebook.path), sourcePath, targetPath)
    );
  }, []);

  const handleCreateNotebookGroup = React.useCallback((name: string) => {
    setNotebookGroups((current) => [
      ...current,
      { id: safeRandomUUID(), name, notebookPaths: [], collapsed: false },
    ]);
  }, []);

  const handleRenameNotebookGroup = React.useCallback((id: string, name: string) => {
    setNotebookGroups((current) => current.map((group) => group.id === id ? { ...group, name } : group));
  }, []);

  const handleDeleteNotebookGroup = React.useCallback((id: string) => {
    setNotebookGroups((current) => current.filter((group) => group.id !== id));
  }, []);

  const handleToggleNotebookGroup = React.useCallback((id: string) => {
    setNotebookGroups((current) => current.map((group) =>
      group.id === id ? { ...group, collapsed: !group.collapsed } : group
    ));
  }, []);

  const handleMoveNotebookToGroup = React.useCallback((notebookPath: string, groupId: string | null) => {
    setNotebookGroups((current) => current.map((group) => ({
      ...group,
      notebookPaths: group.id === groupId
        ? [...group.notebookPaths.filter((path) => path !== notebookPath), notebookPath]
        : group.notebookPaths.filter((path) => path !== notebookPath),
    })));
  }, []);

  const handleArchiveNotebook = React.useCallback((notebookPath: string) => {
    setArchivedNotebooks((current) => new Set([...current, notebookPath]));
    setPinnedNotebooks((current) => {
      const next = new Set(current);
      next.delete(notebookPath);
      return next;
    });
    if (activeNotebookPathRef.current === notebookPath) {
      setActiveNotebookPath(null);
      setActiveSectionPath(null);
      setActivePagePath(null);
      setDraft(null);
    }
  }, []);

  const handleUnarchiveNotebook = React.useCallback((notebookPath: string) => {
    setArchivedNotebooks((current) => {
      const next = new Set(current);
      next.delete(notebookPath);
      return next;
    });
  }, []);

  const handleSidebarToggleSection = React.useCallback((path: string) => {
    setExpandedSections((currentSet) => toggleSetValue(currentSet, path));
  }, []);

  const handleSidebarTogglePage = React.useCallback((path: string) => {
    setExpandedPages((currentSet) => toggleSetValue(currentSet, path));
  }, []);

  const handleSidebarSelectNotebook = React.useCallback((path: string) => {
    void selectNotebook(path);
  }, [selectNotebook]);

  const handleSidebarSelectSection = React.useCallback((path: string) => {
    void selectSection(path);
  }, [selectSection]);

  const handleSidebarOpenPage = React.useCallback((pagePath: string) => {
    void openPage(pagePath);
  }, [openPage]);

  const handleSidebarNestPage = React.useCallback(
    async (pagePath: string, parentId: string | null) => {
      await nestVaultPage(pagePath, parentId);
      await loadTree({ pagePath: activePagePathRef.current });
    },
    [loadTree]
  );

  const handleSidebarSetPageKeyNote = React.useCallback(
    async (pagePath: string, keyNote: boolean) => {
      try {
        await setVaultPageKeyNote(pagePath, keyNote);
        await loadTree({ pagePath: activePagePathRef.current });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      }
    },
    [loadTree]
  );

  const [pageOrderOverrides, setPageOrderOverrides] = React.useState<Map<string, string[]>>(new Map());

  const treeWithOverrides = React.useMemo(() => {
    if (pageOrderOverrides.size === 0) return tree;
    const sortPagesByOverride = (pages: VaultPage[], overrideIds: string[]) => {
      const orderMap = new Map(overrideIds.map((id, i) => [id, i]));
      return [...pages].sort((a, b) => {
        const ia = orderMap.has(a.path) ? orderMap.get(a.path)! : Infinity;
        const ib = orderMap.has(b.path) ? orderMap.get(b.path)! : Infinity;
        if (ia !== ib) return ia - ib;
        return a.title.localeCompare(b.title);
      });
    };
    return tree.map((notebook) => {
      const notebookOverrideIds = pageOrderOverrides.get(notebook.path);
      return {
        ...notebook,
        pages: notebookOverrideIds
          ? sortPagesByOverride(notebook.pages, notebookOverrideIds)
          : notebook.pages,
        sections: notebook.sections.map((section) => {
          const overrideIds = pageOrderOverrides.get(section.path);
          if (!overrideIds) return section;
          return { ...section, pages: sortPagesByOverride(section.pages, overrideIds) };
        }),
      };
    });
  }, [tree, pageOrderOverrides]);

  const handleSidebarReorderPages = React.useCallback(
    async (sectionPath: string, orderedIds: string[]) => {
      setPageOrderOverrides((prev) => new Map([...prev, [sectionPath, orderedIds]]));
      try {
        await reorderVaultSectionPages(sectionPath, orderedIds);
        await loadTree({ pagePath: activePagePathRef.current });
      } finally {
        setPageOrderOverrides((prev) => {
          const next = new Map(prev);
          next.delete(sectionPath);
          return next;
        });
      }
    },
    [loadTree]
  );

  const handleSidebarApplyPageDrop = React.useCallback(
    async (containerPath: string, pagePath: string, parentId: string | null, orderedIds: string[]) => {
      setPageOrderOverrides((prev) => new Map([...prev, [containerPath, orderedIds]]));
      try {
        const notebook = tree.find((entry) => entry.path === containerPath);
        const section = tree
          .flatMap((entry) => entry.sections)
          .find((entry) => entry.path === containerPath);
        const pages = section?.pages ?? notebook?.pages ?? [];
        const page = pages.find((entry) => entry.path === pagePath);
        const currentParent = page?.parentId ?? null;
        if (currentParent !== parentId) {
          await nestVaultPage(pagePath, parentId);
        }
        await reorderVaultSectionPages(containerPath, orderedIds);
        await loadTree({ pagePath: activePagePathRef.current });
      } finally {
        setPageOrderOverrides((prev) => {
          const next = new Map(prev);
          next.delete(containerPath);
          return next;
        });
      }
    },
    [loadTree, tree]
  );

  const handleCreateNotebookDialog = React.useCallback(() => {
    setCreateNotebookError(null);
    setCreateNotebookDialogOpen(true);
  }, []);

  const handleCreateVaultNotebookFromDialog = React.useCallback(async (name: string) => {
    setIsDialogSubmitting(true);
    setCreateNotebookError(null);
    try {
      const notebook = await createVaultNotebook({ name });
      setCreateNotebookDialogOpen(false);
      await loadTree({
        notebookPath: notebook.path,
      });
    } catch (error) {
      setCreateNotebookError(error instanceof Error ? error.message : "Failed to create notebook.");
    } finally {
      setIsDialogSubmitting(false);
    }
  }, [loadTree]);

  const handleRemoteNotebookRegistered = React.useCallback(
    async (notebook?: PortableNotebookRecord) => {
      if (notebook) {
        setClosedNotebooks((prev) => {
          const next = new Set(prev);
          next.delete(notebook.path);
          return next;
        });
        setExpandedNotebooks((prev) => new Set([...prev, notebook.path]));
      }
      try {
        await loadTree(notebook ? { notebookPath: notebook.path } : undefined);
      } catch (treeError) {
        console.error("[smart-notes] failed to refresh tree after remote notebook change", treeError);
      }
    },
    [loadTree]
  );

  const handleRevealNotebook = React.useCallback(async (notebookPath: string) => {
    try {
      await revealNotebookInExplorer(notebookPath);
    } catch (revealError) {
      console.error("[smart-notes] reveal notebook failed", revealError);
    }
  }, []);

  const handleCreateSectionDialog = React.useCallback((notebookPath: string, notebookName: string) => {
    setDialogValue("New Section");
    setDialogState({ kind: "createSection", notebookPath, notebookName });
  }, []);

  const handleRenameNotebookDialog = React.useCallback((path: string, name: string, isPortable?: boolean) => {
    setDialogValue(name);
    setDialogState({ kind: "renameNotebook", path, name, isPortable });
  }, []);

  const handleDeleteNotebookDialog = React.useCallback((path: string, name: string, isPortable?: boolean) => {
    setDialogState({ kind: "deleteNotebook", path, name, isPortable });
  }, []);

  const handleCreatePageDialog = React.useCallback((target: CreatePageTarget) => {
    setDialogValue("Untitled page");
    setDialogState({ kind: "createPage", ...target });
  }, []);

  const handleCreateJupyterDialog = React.useCallback((target: CreatePageTarget) => {
    setDialogValue("Untitled notebook");
    setDialogState({ kind: "createPage", ...target, noteType: "jupyter" });
  }, []);

  const handleCreateLogDialog = React.useCallback((target: CreatePageTarget) => {
    setDialogValue("Untitled log");
    setDialogState({ kind: "createPage", ...target, noteType: "log" });
  }, []);

  const handleCreateDesignDialog = React.useCallback((target: CreatePageTarget) => {
    setDialogValue("Untitled design");
    setDialogState({ kind: "createPage", ...target, noteType: "design" });
  }, []);

  const handleCreateSpreadsheetDialog = React.useCallback((target: CreatePageTarget) => {
    setDialogValue("Untitled spreadsheet");
    setDialogState({ kind: "createPage", ...target, noteType: "spreadsheet" });
  }, []);

  const handleLinkDesign = React.useCallback((initialPath?: string, replacePath?: string) => {
    const notebook =
      treeRef.current.find((entry) => entry.path === draftRef.current?.notebookPath) ??
      treeRef.current.find((entry) => entry.isPortable && entry.rootPath);
    const root = notebook?.rootPath?.trim();
    const pagePath = draftRef.current?.path;
    let browsePath = initialPath?.trim() || root || undefined;

    // When browsing from an open design page, land in that page's section folder
    // even if the caller passed the portable root.
    const normalizedBrowse = browsePath?.replace(/[\\/]+$/, "").toLowerCase();
    const normalizedRoot = root?.replace(/[\\/]+$/, "").toLowerCase();
    if (
      root &&
      pagePath &&
      notebook?.isPortable &&
      (!normalizedBrowse || normalizedBrowse === normalizedRoot)
    ) {
      const parts = pagePath.split("/").filter(Boolean);
      if (parts.length >= 3) {
        const sectionName = parts[1];
        const sep = root.includes("\\") ? "\\" : "/";
        browsePath = `${root.replace(/[\\/]+$/, "")}${sep}${sectionName}`;
      }
    }

    setLinkDesignDialog({
      open: true,
      mode: "link",
      initialPath: browsePath,
      replacePath,
    });
  }, []);

  const handleRelinkDesign = React.useCallback(() => {
    const current = draftRef.current;
    if (!current?.designLinked) {
      return;
    }
    const portableRoot =
      treeRef.current.find((notebook) => notebook.path === current.notebookPath)?.rootPath ??
      current.resolvedDiskPath ??
      undefined;
    setLinkDesignDialog({
      open: true,
      mode: "relink",
      initialPath: portableRoot,
      replacePath: undefined,
    });
  }, []);

  const handleConfirmLinkDesignSource = React.useCallback(
    async (absolutePath: string) => {
      if (linkDesignDialog.mode === "relink") {
        const current = draftRef.current;
        if (!current?.designLinked) {
          throw new Error("Only linked design pages can be relinked.");
        }
        const result = await relinkDesignPageApi(current.path, absolutePath);
        const page = result.page as ApiPageDocument;
        await loadTree({ pagePath: page.path }, { skipCache: true });
        setDesignReloadNonce((value) => value + 1);
        return;
      }

      const result = await linkDesignPageApi(
        absolutePath,
        undefined,
        linkDesignDialog.replacePath
      );
      const page = result.page as ApiPageDocument;
      await loadTree({ pagePath: page.path }, { skipCache: true });
    },
    [linkDesignDialog.mode, linkDesignDialog.replacePath, loadTree]
  );

  const handleRevealDesignSource = React.useCallback(async () => {
    const current = draftRef.current;
    if (!current) return;
    try {
      await revealPageInExplorer(current.path);
    } catch (error) {
      console.error("[smart-notes] reveal design source failed", error);
      window.alert(error instanceof Error ? error.message : "Failed to reveal design source.");
    }
  }, []);

  const handleDirectCreatePage = React.useCallback(async (target: CreatePageTarget) => {
    try {
      const page = await createVaultPage({
        sectionPath: target.sectionPath,
        notebookPath: target.notebookPath,
        title: "Untitled page",
        parentId: target.parentId ?? null,
      });
      const vaultPage = apiDocumentToVaultPage(page);
      setTree((currentTree) => appendPageToTree(currentTree, page, vaultPage));
      setExpandedNotebooks((current) => new Set([...current, page.notebookPath]));
      if (page.sectionPath) {
        setExpandedSections((current) => new Set([...current, page.sectionPath!]));
      }
      if (target.parentId) {
        setExpandedPages((current) => new Set([...current, target.parentId!]));
      }
      applySelection(selectionFromApiPage(tree, page));
    } catch {
      // silently fail; the tree will refresh on the next vault sync
    }
  }, [applySelection, tree]);

  const openDocxImportPicker = React.useCallback((sectionPath: string) => {
    setDocxImportTargetSectionPath(sectionPath);
    docxImportInputRef.current?.click();
  }, []);

  const handleRenameSectionDialog = React.useCallback((path: string, name: string, notebookPath: string) => {
    setDialogValue(name);
    setDialogState({ kind: "renameSection", path, name, notebookPath });
  }, []);

  const handleDeleteSectionDialog = React.useCallback((path: string, name: string) => {
    setDialogState({ kind: "deleteSection", path, name });
  }, []);

  const handleRenamePageDialog = React.useCallback((path: string, title: string) => {
    setDialogValue(title);
    setDialogState({ kind: "renamePage", path, title });
  }, []);

  const handleMovePageDialog = React.useCallback((path: string, title: string, currentSectionPath: string) => {
    setDialogSelectValue(currentSectionPath);
    setDialogState({ kind: "movePage", path, title, currentSectionPath });
  }, []);

  const handleDeletePageDialog = React.useCallback((path: string, title: string) => {
    setDialogState({ kind: "deletePage", path, title });
  }, []);

  const handleSidebarTogglePageVersions = React.useCallback((pagePath: string) => {
    void handleTogglePageVersions(pagePath);
  }, [handleTogglePageVersions]);

  const handleSidebarPreviewGhostVersion = React.useCallback((parentPagePath: string, versionId: string, versionTs: string) => {
    void handlePreviewGhostVersion(parentPagePath, versionId, versionTs);
  }, [handlePreviewGhostVersion]);

  const handleSidebarRestoreGhostVersion = React.useCallback((parentPagePath: string, versionId: string) => {
    void handleRestoreGhostVersion(parentPagePath, versionId);
  }, [handleRestoreGhostVersion]);

  const collapseTreeSidebar = React.useCallback(() => {
    setTreeCollapsed(true);
  }, [setTreeCollapsed]);

  const reloadPendingPage = React.useCallback(async (pendingReload: PendingPageReload, currentDraft: PageDraft) => {
    setIsReloading(true);
    try {
      if (currentDraft.noteType === "log") {
        // Log form scripts live in sidecars; remount to fetch the updated Form contract.
        pendingPageReloadRef.current = null;
        setPendingPageReload((pending) => (pending?.page.path === currentDraft.path ? null : pending));
        setReloadSafetyMessage(null);
        setLogReloadNonce((nonce) => nonce + 1);
        return;
      }
      if (currentDraft.noteType === "spreadsheet") {
        spreadsheetPageRef.current?.discardPendingChanges();
        pendingPageReloadRef.current = null;
        setPendingPageReload((pending) => (pending?.page.path === currentDraft.path ? null : pending));
        setReloadSafetyMessage(null);
        setSpreadsheetReloadNonce((nonce) => nonce + 1);
        return;
      }
      const latestPage = await fetchVaultPage(currentDraft.path).catch(() => pendingReload.page);
      replaceTreePage(currentDraft.path, latestPage);
      hydrateDraft(latestPage);
      if (currentDraft.noteType === "design") {
        // The design view seeds its raw-HTML body from props once per mount, so a
        // same-path content reload must remount it to show the companion's edits.
        setDesignReloadNonce((nonce) => nonce + 1);
        designRemoteWriteFenceRef.current = false;
        queuedSaveRef.current = false;
      }
    } finally {
      setIsReloading(false);
    }
  }, [hydrateDraft, replaceTreePage]);

  const handleReload = React.useCallback(async () => {
    const pendingReload = pendingPageReloadRef.current;
    const currentDraft = draftRef.current;
    if (currentDraft?.noteType === "app") {
      setAppReloadRequestNonce((nonce) => nonce + 1);
      return;
    }
    if (pendingReload && currentDraft && pendingReload.page.path === currentDraft.path) {
      if (
        shouldBlockPendingPageReload({
          draft: currentDraft,
          pendingPath: pendingReload.page.path,
          lastSavedSnapshot: lastSavedSnapshotRef.current,
          hasUnsavedSurfaceChanges:
            currentDraft.noteType === "spreadsheet" &&
            (spreadsheetPageRef.current?.hasPendingChanges() ?? false),
        })
      ) {
        setReloadSafetyMessage("Reload paused: confirm before discarding local unsaved edits.");
        setDialogState({
          kind: "confirmRemoteReload",
          path: currentDraft.path,
          title: currentDraft.title,
        });
        return;
      }

      await reloadPendingPage(pendingReload, currentDraft);
      return;
    }

    const canLeave = await flushSave();
    if (!canLeave) {
      return;
    }

    setIsReloading(true);
    try {
      await loadTree();
      setPendingVaultReload(null);
    } finally {
      setIsReloading(false);
    }
  }, [flushSave, loadTree, reloadPendingPage]);

  // SN-85: re-fetch the current note's latest saved content and rehydrate the
  // editor in place — no Next.js app reload, independent of the SW update flow.
  // Local edits are flushed first so a refresh never silently discards unsaved work.
  const handleRefreshNote = React.useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || isRefreshingNote) {
      return;
    }

    setIsRefreshingNote(true);
    try {
      if (currentDraft.noteType === "app") {
        setAppReloadRequestNonce((nonce) => nonce + 1);
        return;
      }
      if (currentDraft.noteType === "ink") {
        // Ink scenes are owned by the canvas; remount re-fetches the sidecar.
        const saved = await flushSave();
        if (!saved) {
          return;
        }
        setInkReloadNonce((nonce) => nonce + 1);
        return;
      }

      if (currentDraft.noteType === "spreadsheet") {
        await spreadsheetPageRef.current?.flush();
        setSpreadsheetReloadNonce((nonce) => nonce + 1);
        return;
      }

      if (currentDraft.noteType === "jupyter") {
        // Jupyter owns notebook rendering; remount the embedded frame to re-read notebook.ipynb.
        const saved = await flushSave();
        if (!saved) {
          return;
        }
        setJupyterReloadNonce((nonce) => nonce + 1);
        return;
      }

      if (currentDraft.noteType === "design") {
        // Design view seeds body once per mount. Flush only when the owner has
        // local Source edits; otherwise prefer disk so companion/external writes
        // are not overwritten, then remount so Preview shows the fresh artifact.
        if (hasUnsavedLocalDraftChanges(currentDraft, lastSavedSnapshotRef.current)) {
          const saved = await flushSave();
          if (!saved) {
            return;
          }
        }
        const latestPage = await fetchVaultPage(currentDraft.path);
        replaceTreePage(currentDraft.path, latestPage);
        hydrateDraft(latestPage);
        setDesignReloadNonce((nonce) => nonce + 1);
        designRemoteWriteFenceRef.current = false;
        queuedSaveRef.current = false;
        return;
      }

      const saved = await flushSave();
      if (!saved) {
        return;
      }

      const latestPage = await fetchVaultPage(currentDraft.path);
      replaceTreePage(currentDraft.path, latestPage);
      hydrateDraft(latestPage);
      editorRef.current?.swapContent(latestPage.content);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to refresh note.");
    } finally {
      setIsRefreshingNote(false);
    }
  }, [flushSave, hydrateDraft, isRefreshingNote, replaceTreePage]);

  const closeDialog = React.useCallback(() => {
    setDialogState(null);
    setDialogValue("");
    setDialogSelectValue("");
  }, []);

  const handleDialogSubmit = React.useCallback(async () => {
    if (!dialogState) {
      return;
    }

    const canLeave =
      dialogState.kind === "createSection" ||
      dialogState.kind === "createPage" ||
      dialogState.kind === "renamePage" ||
      dialogState.kind === "movePage" ||
      dialogState.kind === "deletePage" ||
      dialogState.kind === "renameNotebook" ||
      dialogState.kind === "renameSection" ||
      dialogState.kind === "deleteNotebook" ||
      dialogState.kind === "deleteSection"
        ? await flushSave()
        : true;

    if (!canLeave) {
      return;
    }

    setIsDialogSubmitting(true);
    try {
      switch (dialogState.kind) {
        case "confirmRemoteReload": {
          const pendingReload = pendingPageReloadRef.current;
          const currentDraft = draftRef.current;
          if (pendingReload && currentDraft && pendingReload.page.path === currentDraft.path) {
            closeDialog();
            await reloadPendingPage(pendingReload, currentDraft);
          } else {
            closeDialog();
          }
          break;
        }
        case "renameNotebook": {
          const notebook = await renameVaultNotebook({
            path: dialogState.path,
            name: dialogValue,
          });
          closeDialog();
          await loadTree(remapSelectionAfterRename({
            notebook: activeNotebookPathRef.current,
            section: activeSectionPathRef.current,
            page: activePagePathRef.current,
            previousPath: notebook.previousPath ?? dialogState.path,
            nextPath: notebook.path,
          }));
          break;
        }
        case "deleteNotebook": {
          await deleteVaultNotebook(dialogState.path);
          closeDialog();
          await loadTree();
          break;
        }
        case "createSection": {
          const section = await createVaultSection({
            notebookPath: dialogState.notebookPath,
            name: dialogValue,
          });
          closeDialog();
          await loadTree({
            notebookPath: section.notebookPath,
            sectionPath: section.path,
          });
          break;
        }
        case "renameSection": {
          const section = await renameVaultSection({
            path: dialogState.path,
            name: dialogValue,
          });
          closeDialog();
          await loadTree(remapSelectionAfterRename({
            notebook: activeNotebookPathRef.current,
            section: activeSectionPathRef.current,
            page: activePagePathRef.current,
            previousPath: section.previousPath ?? dialogState.path,
            nextPath: section.path,
          }));
          break;
        }
        case "deleteSection": {
          await deleteVaultSection(dialogState.path);
          closeDialog();
          await loadTree();
          break;
        }
        case "createPage": {
          const page = await createVaultPage({
            sectionPath: dialogState.sectionPath,
            notebookPath: dialogState.notebookPath,
            title: dialogValue,
            noteType: dialogState.noteType,
            parentId: dialogState.parentId ?? null,
          });
          closeDialog();
          const vaultPage = apiDocumentToVaultPage(page);
          setTree((currentTree) => appendPageToTree(currentTree, page, vaultPage));
          setExpandedNotebooks((current) => new Set([...current, page.notebookPath]));
          if (page.sectionPath) {
            setExpandedSections((current) => new Set([...current, page.sectionPath!]));
          }
          const parentId = dialogState.parentId;
          if (parentId) {
            setExpandedPages((current) => new Set([...current, parentId]));
          }
          applySelection(selectionFromApiPage(tree, page));
          break;
        }
        case "renamePage": {
          const page = await renameVaultPage({
            path: dialogState.path,
            title: dialogValue,
          });
          closeDialog();
          await loadTree({ pagePath: page.path });
          break;
        }
        case "movePage": {
          const page = await moveVaultPage({
            action: "move",
            path: dialogState.path,
            sectionPath: dialogSelectValue,
          });
          closeDialog();
          await loadTree({ pagePath: page.path });
          break;
        }
        case "deletePage": {
          const fallbackPath = nextPagePathAfterDelete(tree, dialogState.path);
          await deleteVaultPage(dialogState.path);
          closeDialog();
          await loadTree({ pagePath: fallbackPath });
          break;
        }
      }
    } catch (error) {
      // Surface the failure instead of silently swallowing the rejection —
      // the dialog stays open so the user can retry or cancel.
      toast.error(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setIsDialogSubmitting(false);
    }
  }, [applySelection, closeDialog, dialogState, dialogSelectValue, dialogValue, flushSave, loadTree, reloadPendingPage, tree]);

  const openCaptureDialog = React.useCallback(() => {
    setCaptureDialog({
      open: true,
      destination: "inbox",
      title: "Quick Capture",
      content: "",
      notebookPath: activeSelection.notebook?.path ?? tree[0]?.path ?? "",
      sectionPath:
        activeSelection.section?.path ??
        tree[0]?.sections[0]?.path ??
        "",
      isSubmitting: false,
    });
  }, [activeSelection.notebook?.path, activeSelection.section?.path, tree]);

  const openSearchModal = React.useCallback(() => {
    setSearchQuery("");
    setServerSearchResults([]);
    setServerSearchState("idle");
    setSearchOpen(true);
  }, []);

  const handleSearchOpenChange = React.useCallback((nextOpen: boolean) => {
    setSearchOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
      setServerSearchResults([]);
      setServerSearchState("idle");
    }
  }, []);

  const handleSearchResultSelect = React.useCallback(
    (result: SearchResult) => {
      setSearchOpen(false);
      setSearchQuery("");
      setServerSearchResults([]);
      setServerSearchState("idle");
      void openPage(result.path);
    },
    [openPage]
  );

  const handleCaptureSubmit = React.useCallback(async () => {
    if (!captureDialog.content.trim()) {
      return;
    }

    const canLeave = await flushSave();
    if (!canLeave) {
      return;
    }

    setCaptureDialog((current) => ({ ...current, isSubmitting: true }));
    try {
      const page = await captureVaultPage({
        destination: captureDialog.destination,
        title: captureDialog.title,
        content: captureDialog.content,
        notebookPath: captureDialog.destination === "inbox" ? captureDialog.notebookPath || undefined : undefined,
        sectionPath: captureDialog.destination === "page" ? captureDialog.sectionPath || undefined : undefined,
      });
      setCaptureDialog((current) => ({
        ...current,
        open: false,
        isSubmitting: false,
        content: "",
      }));
      await loadTree({ pagePath: page.path });
      setSidebarOpen(false);
    } catch (error) {
      setCaptureDialog((current) => ({
        ...current,
        isSubmitting: false,
      }));
      throw error;
    }
  }, [captureDialog, flushSave, loadTree]);

  const handleAiSubmit = React.useCallback(async (composerPrompt: string, attachments: AiComposerAttachment[] = []) => {
    const textAttachments = attachments.filter(
      (attachment): attachment is Extract<AiComposerAttachment, { kind: "text" | "markdown" | "html" }> =>
        attachment.kind === "text" || attachment.kind === "markdown" || attachment.kind === "html"
    );
    const imageAttachments = attachments.filter(
      (attachment): attachment is Extract<AiComposerAttachment, { kind: "image" }> =>
        attachment.kind === "image"
    );
    const pdfAttachments = attachments.filter(
      (attachment): attachment is Extract<AiComposerAttachment, { kind: "pdf" }> =>
        attachment.kind === "pdf"
    );
    const prompt = buildMessageWithDocumentAttachments(composerPrompt, textAttachments);

    const hasUploadedAttachment = imageAttachments.length > 0 || pdfAttachments.length > 0;

    if (
      !draft ||
      (activeProjectWorkspace && !workspaceSession?.capability) ||
      (!prompt.trim() && !hasUploadedAttachment) ||
      activeTurnIdRef.current
    ) {
      return;
    }

    const submitScopeKey = companionScopeKeyRef.current;
    const submitPath = companionStorePathRef.current || draft.path;
    const submitThreadKey = `${submitPath}::${submitScopeKey}`;
    const submitMessages =
      aiMessagesBindingKeyRef.current === submitThreadKey
        ? aiMessagesRef.current
        : [];
    clearAiComposerSnapshot();

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;
    let pageContext = buildAiPageContext({
      scope: aiScope,
      pageContent: draft.content,
      sectionMarkdown: aiSectionMarkdown,
      pageTreeMarkdown: aiPageTreeContext,
      parentContextMarkdown: aiParentContextMarkdown,
      noteType: draft.noteType,
    });
    const activeNotebook = treeRef.current.find((notebook) => notebook.path === draft.notebookPath);
    const portableRoot = activeNotebook?.rootPath?.trim() || "";
    let resolvedDiskPath = draft.resolvedDiskPath?.trim() || "";
    if (!resolvedDiskPath && portableRoot && draft.path.startsWith(`${activeNotebook?.path}/`)) {
      const remainder = draft.path.slice((activeNotebook?.path.length ?? 0) + 1);
      resolvedDiskPath = `${portableRoot.replace(/[\\/]+$/, "")}/${remainder}`;
    } else if (!resolvedDiskPath && portableRoot && draft.path === activeNotebook?.path) {
      resolvedDiskPath = portableRoot;
    }
    const turnJupyterFocus = jupyterFocusForPage(activeJupyterFocus, draft.path, draft.noteType);
    const operatingContext = buildSmartNotesOperatingContext({
      title: draft.title,
      path: draft.path,
      noteType: draft.noteType,
      vaultRoot,
      resolvedDiskPath: resolvedDiskPath || null,
      portableNotebookRootPath: portableRoot || null,
      // The remote/PWA origin is browser metadata only. The chat server adds the
      // host-local apiBaseUrl from its actual bound port before launching a provider.
      browserOrigin: typeof window !== "undefined" ? window.location.origin : null,
      notebookName: draft.notebookName,
      notebookPath: draft.notebookPath,
      sectionName: draft.sectionName,
      sectionPath: draft.sectionPath,
      scopeLabel: aiScopeLabel,
      designLinked: Boolean(draft.designLinked),
      sourceMissing: Boolean(draft.sourceMissing),
      activePdfHref: pdfReaderOpen ? pdfReader?.href : undefined,
      activePdfFileName: pdfReaderOpen ? pdfReader?.fileName : undefined,
      activePdfPage: pdfReaderOpen ? pdfReader?.page : undefined,
      activePdfPageCount: pdfReaderOpen ? pdfReader?.pageCount : undefined,
      activeJupyterFocus: turnJupyterFocus,
      // SN-262: only bind the companion to the disk workspace while the Deep Work
      // draft is actually open. On an explicitly selected vault page the turn
      // must operate on that note, not on a lingering disk root.
      projectWorkspace: activeProjectWorkspace ? {
        ...activeProjectWorkspace,
        requestedAccess: workspaceSession?.accessMode ?? activeProjectWorkspace.requestedAccess,
        capability: workspaceSession?.capability,
        returnUrl: workspaceSession?.returnUrl,
        executionContext: workspaceSession?.executionContext,
      } : null,
    });
    const history = submitMessages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))
      .filter((message) => message.content.trim().length > 0);

    activeAssistantMessageIdRef.current = assistantMessageId;
    // SN-132: fresh turn — reset the resume cursor and record which page+scope it
    // belongs to for durable pointer persistence and cleanup.
    activeTurnLastSeqRef.current = -1;
    // SN-202: bind the turn to the resolved STORE identity, not the raw page, so
    // its durable pointer is filed under the shared thread and reattach discovery
    // finds it from any page under the subtree (and across navigation/teardown).
    const submitGeneration = aiSubmitGenerationRef.current + 1;
    aiSubmitGenerationRef.current = submitGeneration;
    const turnId = safeRandomUUID();
    const pointer: CompanionActiveTurn = {
      turnId,
      assistantMessageId,
      lastSeq: -1,
      startedAt: Date.now(),
    };
    const snapshot: AiSidebarMessage[] = [
      ...submitMessages.filter(
        (message) => message.id !== userMessageId && message.id !== assistantMessageId
      ),
      { id: userMessageId, role: "user", content: prompt },
      { id: assistantMessageId, role: "assistant", content: "", modelLabel: aiAssistantLabel, timeline: [] },
    ];
    // Allocate and persist the durable identity BEFORE /api/chat/send. This
    // closes the mobile teardown window where the server accepted a turn but
    // iOS froze the PWA before the pointer flush. Navigation may detach local
    // observers, but it never invalidates this server-owned turn identity.
    activeTurnIdRef.current = turnId;
    activeTurnContextRef.current = { path: submitPath, scopeKey: submitScopeKey };
    setAiTurnActive(true);
    // SN-211: watch this turn for a closed-panel terminal event and start the
    // quiet working affordance. A fresh turn supersedes any prior ready badge.
    watchedTurnIdRef.current = turnId;
    setCompanionTurnPending(true);
    setCompanionAnswerReady(false);
    const visibleSnapshot = snapshot.map((message) =>
      message.id === assistantMessageId ? { ...message, isStreaming: true } : message
    );
    aiMessagesRef.current = visibleSnapshot;
    aiMessagesBindingKeyRef.current = `${submitPath}::${submitScopeKey}`;
    setAiMessages(visibleSnapshot);
    try {
      const pointerPersisted = await persistCompanionActiveTurn(
        submitPath,
        submitScopeKey,
        snapshot,
        pointer,
        { keepalive: true }
      );
      if (!pointerPersisted) {
        throw new Error("Could not save the durable companion turn. Please try again.");
      }

      try {
        if (activeProjectWorkspace) {
          // Live project focus is already bounded into app_context. The vault
          // companion-context route intentionally remains note-only.
          throw new Error("__DEEP_WORK_CONTEXT_ALREADY_ATTACHED__");
        }
        pageContext = await fetchCompanionPageContext(draft.path, pageContext, {
          activePdfHref: pdfReaderOpen ? pdfReader?.href : undefined,
          activePdfFileName: pdfReaderOpen ? pdfReader?.fileName : undefined,
          pdfPage: pdfReaderOpen ? pdfReader?.page : undefined,
          pdfPageCount: pdfReaderOpen ? pdfReader?.pageCount : undefined,
          activeJupyterCellIndex:
            turnJupyterFocus?.workspacePath === "notebook.ipynb" && turnJupyterFocus.documentKind === "notebook"
              ? turnJupyterFocus.activeCellIndex ?? undefined
              : undefined,
          activeJupyterCellId:
            turnJupyterFocus?.workspacePath === "notebook.ipynb" && turnJupyterFocus.documentKind === "notebook"
              ? turnJupyterFocus.activeCellId ?? undefined
              : undefined,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "__DEEP_WORK_CONTEXT_ALREADY_ATTACHED__") {
          // No vault-page enrichment applies to an in-place project workspace.
        } else {
        const message =
          error instanceof Error
            ? error.message
            : "Companion page context could not be loaded.";
        pageContext = [
          pageContext,
          "## Page file context",
          `[Unavailable: ${message}]`,
        ].filter(Boolean).join("\n\n");
        }
      }

      const turnRequestBody = JSON.stringify(
        buildAiTurnRequest({
          turnId,
          message: prompt,
          history,
          pageContext,
          operatingContext,
          browserOrigin: typeof window !== "undefined" ? window.location.origin : undefined,
          providerId: aiActiveProviderId,
          model: aiActiveModel,
          images: imageAttachments.map((attachment) => ({
            name: attachment.name,
            path: attachment.path,
          })),
          documents: pdfAttachments.map((attachment) => ({
            name: attachment.name,
            path: attachment.path,
            mimeType: attachment.mimeType,
          })),
        })
      );
      const response = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: canUseKeepaliveBody(turnRequestBody),
        body: turnRequestBody,
      });

      const payload = (await response.json()) as { error?: string; turn_id?: string; chat_id?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not reach Smart Notes AI.");
      }

      const acceptedTurnId = payload.turn_id ?? payload.chat_id ?? null;
      if (acceptedTurnId !== turnId) {
        throw new Error("Companion turn identity was not accepted by the server.");
      }
    } catch (error) {
      await clearCompanionActiveTurnPointer(submitPath, submitScopeKey);
      // SN-211: the turn never launched — drop the closed-panel watcher so no
      // stale working affordance lingers and a failed send never lights ready.
      if (watchedTurnIdRef.current === turnId) {
        watchedTurnIdRef.current = null;
        setCompanionTurnPending(false);
      }
      if (activeTurnContextRef.current?.path === submitPath &&
          activeTurnContextRef.current.scopeKey === submitScopeKey) {
        activeTurnIdRef.current = null;
        activeTurnContextRef.current = null;
      }
      if (submitGeneration === aiSubmitGenerationRef.current) {
        setAiTurnActive(false);
        updateAiMessage(assistantMessageId, (message) => ({
          ...message,
          isStreaming: false,
          errorMessage: error instanceof Error ? error.message : "Could not reach Smart Notes AI.",
        }));
      }
    }
  }, [aiActiveModel, aiActiveProviderId, aiAssistantLabel, aiPageTreeContext, aiParentContextMarkdown, aiScope, aiScopeLabel, aiSectionMarkdown, clearAiComposerSnapshot, clearCompanionActiveTurnPointer, draft, pdfReader, pdfReaderOpen, persistCompanionActiveTurn, activeProjectWorkspace, updateAiMessage, vaultRoot, workspaceSession]);

  const handleAiCancel = React.useCallback(() => {
    const currentTurnId = activeTurnIdRef.current;
    const assistantMessageId = activeAssistantMessageIdRef.current;
    // SN-132: explicit user cancellation is the one path that stops the
    // server-owned turn; clear the durable pointer for its page+scope too.
    const context = activeTurnContextRef.current;

    aiSubmitGenerationRef.current += 1;
    activeTurnIdRef.current = null;
    activeTurnLastSeqRef.current = -1;
    activeTurnContextRef.current = null;
    setAiTurnActive(false);
    // SN-211: cancel is a terminal non-success — stop watching and never light
    // the ready badge for it (the transcript stays the source of truth).
    watchedTurnIdRef.current = null;
    setCompanionTurnPending(false);

    if (currentTurnId) {
      void fetch("/api/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel: currentTurnId }),
      }).catch(() => undefined);
    }
    if (context) {
      void clearCompanionActiveTurnPointer(context.path, context.scopeKey);
    }

    if (assistantMessageId) {
      updateAiMessage(assistantMessageId, (message) => ({
        ...message,
        isStreaming: false,
      }));
    }
  }, [clearCompanionActiveTurnPointer, updateAiMessage]);

  // SN-203: host handler for a running app's `smartNotesApp.companion.send`.
  // Injects a main-companion turn (text + payload as context) and auto-runs it
  // through the ordinary turn lifecycle, so kept-session persistence, transcript
  // binding, and reattach are all inherited. The reply lands in the sidebar only;
  // it is never written to app/log data because this path never touches the
  // rpc/accept data channel.
  const handleAppCompanionSend = React.useCallback(
    async ({ text, payload }: { text: string; payload: unknown }): Promise<{ ok: boolean; error?: string }> => {
      const current = draftRef.current;
      if (!current || current.noteType !== "app") {
        return { ok: false, error: "The companion is only available from a running app page." };
      }
      if (activeTurnIdRef.current) {
        return { ok: false, error: "The companion is busy with another response. Try again shortly." };
      }
      const prompt = buildCompanionAppMessagePrompt({ text, payload, appTitle: current.title });
      // Surface the auto-run turn: the desktop sidebar is always mounted; on mobile
      // this opens the AI sheet so the owner sees the injected turn and its reply.
      setAiOpen(true);
      await handleAiSubmit(prompt);
      return { ok: true };
    },
    [handleAiSubmit]
  );

  // Both rails resize by writing the DOM width directly during the drag and
  // committing React state once on pointerup. Per-frame setState re-rendered the
  // whole shell each move, so the AI rail edge trailed the pointer as a ghosted
  // second divider (SN-161). Width writes are batched into one rAF per frame so
  // the visible edge tracks the pointer 1:1 with a single clean divider, and
  // pointer capture keeps the drag alive if the pointer briefly leaves the rail.
  const handleAiSidebarResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    const rail = aiSidebarRailRef.current;
    const minWidth = AI_SIDEBAR_MIN_WIDTH;
    const maxWidth = getAiSidebarMaxWidth(window.innerWidth);
    let pendingWidth = clampAiSidebarWidth(
      rail?.offsetWidth ?? AI_SIDEBAR_DEFAULT_WIDTH,
      minWidth,
      maxWidth
    );
    let frame = 0;
    rail?.classList.add("transition-none");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the window listeners still track the drag.
    }

    const applyWidth = () => {
      frame = 0;
      if (rail) {
        rail.style.width = `${pendingWidth}px`;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = clampAiSidebarWidth(window.innerWidth - moveEvent.clientX, minWidth, maxWidth);
      if (!frame) {
        frame = window.requestAnimationFrame(applyWidth);
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      rail?.classList.remove("transition-none");
      setAiSidebarWidth(pendingWidth);
      aiSidebarPointerCleanupRef.current = null;
    };

    aiSidebarPointerCleanupRef.current?.();
    aiSidebarPointerCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup, { once: true });
  }, []);

  const handleTreeSidebarResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined") {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const rail = treeSidebarRailRef.current;
    const startWidth = rail?.offsetWidth ?? TREE_SIDEBAR_DEFAULT_WIDTH;
    let pendingWidth = startWidth;
    let frame = 0;
    rail?.classList.add("transition-none");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; the window listeners still track the drag.
    }

    const applyWidth = () => {
      frame = 0;
      if (rail) {
        rail.style.width = `${pendingWidth}px`;
      }
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = clampTreeSidebarWidth(startWidth + (moveEvent.clientX - startX));
      if (!frame) {
        frame = window.requestAnimationFrame(applyWidth);
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      rail?.classList.remove("transition-none");
      setTreeSidebarWidth(pendingWidth);
      treeSidebarPointerCleanupRef.current = null;
    };

    treeSidebarPointerCleanupRef.current?.();
    treeSidebarPointerCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup, { once: true });
  }, []);

  React.useEffect(() => {
    return () => {
      aiSidebarPointerCleanupRef.current?.();
      treeSidebarPointerCleanupRef.current?.();
    };
  }, []);

  const hasPendingPageReload = Boolean(pendingPageReload && draft?.path === pendingPageReload.page.path);
  const hasPendingVaultReload = Boolean(pendingVaultReload);
  const saveLabel = React.useMemo(
    () =>
      versionPreview
        ? `Viewing version · ${formatVersionLabel(versionPreview.versionTs)}`
        : getReloadStatusLabel({
            reloadSafetyMessage,
            hasPendingPageReload,
            hasPendingVaultReload,
            saveStateLabel: getSaveLabel(saveState, saveError, draft?.updatedAt),
          }),
    [
      draft?.updatedAt,
      hasPendingPageReload,
      hasPendingVaultReload,
      reloadSafetyMessage,
      saveError,
      saveState,
      versionPreview,
    ]
  );

  const activeVersionPreview =
    versionPreview && draft?.path === versionPreview.parentPagePath ? versionPreview : null;
  const isMobileCompanionOpen = aiOpen && !isWideViewport;
  // SN-211: closed-panel companion icon states. Ready wins over working; both are
  // suppressed while the panel is open (viewed = acknowledged / turn is visible).
  const { ready: companionIconReady, working: companionIconWorking } =
    resolveCompanionIconState({
      answerReady: companionAnswerReady,
      turnPending: companionTurnPending,
      panelOpen: aiOpen,
    });

  const canExportCurrentTextPage = Boolean(
    draft && draft.noteType === "text" && !activeVersionPreview
  );

  const handleExportCurrentPage = React.useCallback(async () => {
    if (!draft || draft.noteType !== "text" || activeVersionPreview) {
      return;
    }

    try {
      await annotationLayerRef.current?.flush();
      const snapshot = editorRef.current?.getExportSnapshot();
      if (!snapshot) {
        return;
      }

      const ink = await annotationLayerRef.current?.exportInkOverlay();
      const bodyHtml = await inlineVaultAssetsInHtml(snapshot.html);
      const bundle = buildStandaloneHtmlBundle({
        title: draft.title,
        bodyHtml,
        ink,
        frameHeight: snapshot.frameHeight,
      });
      triggerHtmlBundleDownload(draft.title, bundle);
    } catch (error) {
      console.error("Failed to export page HTML bundle", error);
    }
  }, [activeVersionPreview, draft]);

  const handleExportCurrentPageDocx = React.useCallback(async () => {
    if (!draft || draft.noteType !== "text" || activeVersionPreview) {
      return;
    }

    try {
      const snapshot = editorRef.current?.getExportSnapshot();
      const blob = await exportVaultPageDocx({
        path: draft.path,
        title: draft.title,
        bodyHtml: snapshot?.html ?? draft.content,
      });
      triggerBlobDownload(`${sanitizeDownloadFilename(draft.title)}.docx`, blob);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "DOCX export failed.");
      console.error("Failed to export page DOCX", error);
    }
  }, [activeVersionPreview, draft]);

  const handleDocxImportFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      const sectionPath = docxImportTargetSectionPath;
      event.target.value = "";
      setDocxImportTargetSectionPath(null);
      if (!file || !sectionPath) {
        return;
      }

      setIsReloading(true);
      setSaveError(null);
      try {
        const page = await importVaultPageDocx(sectionPath, file);
        pageContentCache.set(page.path, { html: page.content });
        await loadTree({ pagePath: page.path });
        setExpandedNotebooks((current) => new Set([...current, page.notebookPath]));
        if (page.sectionPath) {
          setExpandedSections((current) => new Set([...current, page.sectionPath!]));
        }
        setSidebarOpen(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "DOCX import failed.");
        console.error("Failed to import DOCX", error);
      } finally {
        setIsReloading(false);
      }
    },
    [docxImportTargetSectionPath, loadTree]
  );

  const handlePrintCurrentPage = React.useCallback(
    async (settings?: PrintSettings) => {
      if (!draft || draft.noteType !== "text" || activeVersionPreview) {
        return;
      }

      const resolvedSettings = settings ?? sessionPrintSettings ?? loadPrintSettings();

      try {
        await annotationLayerRef.current?.flush();
        const ink = await annotationLayerRef.current?.exportInkOverlay();
        const contentFrame = document.querySelector<HTMLElement>(
          '[data-testid="editor-content-frame"]'
        );
        if (ink && contentFrame) {
          mountPrintInkSnapshot(ink, contentFrame);
        }

        applyPrintLayoutStyles(resolvedSettings);
        setPagePrintLeadingH1();
        setPagePrintActive(true);
        annotationLayerRef.current?.prepareForPrint();

        const cleanup = () => {
          setPagePrintActive(false);
          clearPagePrintLeadingH1();
          removePrintInkSnapshot();
          clearPrintLayoutStyles();
          annotationLayerRef.current?.restoreAfterPrint();
        };

        window.addEventListener("afterprint", cleanup, { once: true });
        window.print();
      } catch (error) {
        setPagePrintActive(false);
        clearPagePrintLeadingH1();
        removePrintInkSnapshot();
        clearPrintLayoutStyles();
        annotationLayerRef.current?.restoreAfterPrint();
        console.error("Failed to prepare page for print", error);
      }
    },
    [activeVersionPreview, draft, sessionPrintSettings]
  );

  const effectivePrintSettings = sessionPrintSettings ?? loadPrintSettings();
  const handleOpenWorkspace = React.useCallback((workspace: DeepWorkDescriptor) => {
    // Capture the note the owner is leaving. Keyed on the *active* surface, not
    // on `openedWorkspace`: with a sticky root (SN-262) a workspace can be
    // remembered while a vault note is the page actually on screen.
    if (!activeProjectWorkspace) {
      workspaceReturnStateRef.current = {
        draft,
        activeNotebookPath,
        activeSectionPath,
        activePagePath,
      };
    }
    const workspaceDraft = deepWorkDraft(workspace);
    // SN-262: remember the successfully opened disk root (and the access/unlock
    // choice needed to reopen it). Opening a different folder replaces it.
    if (typeof window !== "undefined") {
      writeStickyDeepWork(window.localStorage, workspace);
    }
    setOpenedWorkspace(workspace);
    projectWorkspaceRef.current = workspace;
    setWorkspaceSession(null);
    setActiveJupyterFocus(null);
    setWorkspaceDocumentReload(null);
    setActiveNotebookPath(null);
    setActiveSectionPath(null);
    setActivePagePath(workspaceDraft.path);
    setDraft(workspaceDraft);
    draftRef.current = workspaceDraft;
    // SN-263: seed the saved snapshot so vault live-sync does not treat the
    // synthetic Deep Work draft as permanently unsaved.
    lastSavedSnapshotRef.current = snapshotDraft(workspaceDraft);
    setPendingPageReload(null);
    setPendingVaultReload(null);
    setReloadSafetyMessage(null);
  }, [activeNotebookPath, activePagePath, activeProjectWorkspace, activeSectionPath, draft]);

  // SN-262: a Deep Work root restored from sticky state has no in-session
  // "previous note" to go back to, so fall back to the durable last-active vault
  // page instead of dropping the owner onto an empty shell.
  const storedVaultReturnState = React.useCallback(() => {
    const storedPagePath =
      typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY) : null;
    const selection = resolveSelection(treeRef.current, { pagePath: storedPagePath });
    return {
      draft: selection.page && selection.notebook ? draftFromTreePage(selection) : null,
      activeNotebookPath: selection.notebook?.path ?? null,
      activeSectionPath: selection.section?.path ?? null,
      activePagePath: selection.page?.path ?? null,
    };
  }, []);

  // "Back to notes" returns to the prior note selection. It deliberately does
  // NOT clear the sticky root (SN-262): the remembered workspace survives until
  // the owner opens a different folder or the root fails validation.
  const handleLeaveOpenedWorkspace = React.useCallback(() => {
    const previous = workspaceReturnStateRef.current ?? storedVaultReturnState();
    setOpenedWorkspace(null);
    projectWorkspaceRef.current = linkedProjectWorkspace;
    setWorkspaceSession(null);
    setActiveJupyterFocus(null);
    setWorkspaceDocumentReload(null);
    setActiveNotebookPath(previous?.activeNotebookPath ?? null);
    setActiveSectionPath(previous?.activeSectionPath ?? null);
    setActivePagePath(previous?.activePagePath ?? null);
    setDraft(previous?.draft ?? null);
    draftRef.current = previous?.draft ?? null;
    workspaceReturnStateRef.current = null;
  }, [linkedProjectWorkspace, storedVaultReturnState]);

  // SN-262: a restored root is a request, not an authorization. Re-validate it
  // through the ordinary workspace-session check once per mount; a missing,
  // moved, or otherwise invalid root clears the sticky entry and falls back to
  // notes instead of leaving Deep Work stuck on a dead folder.
  React.useEffect(() => {
    if (!restoredStickyWorkspace) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchJupyterWorkspaceSessionStatus({
          rootPath: restoredStickyWorkspace.rootPath,
          branch: restoredStickyWorkspace.branch,
          requestedAccess: restoredStickyWorkspace.requestedAccess,
          ownerOpen: true,
          defaultBranchEditConfirmed: restoredStickyWorkspace.defaultBranchEditConfirmed,
        });
        if (cancelled) return;
        const resolvedAccess =
          status.resolvedAccessMode ?? status.accessMode ?? restoredStickyWorkspace.requestedAccess;
        setOpenedWorkspace((current) => {
          if (!current || current.rootPath !== restoredStickyWorkspace.rootPath) return current;
          const nextBranch = status.branch ?? current.branch;
          if (
            current.branch === nextBranch &&
            current.requestedAccess === resolvedAccess
          ) {
            return current;
          }
          const refreshed: DeepWorkDescriptor = {
            ...current,
            branch: nextBranch,
            requestedAccess: resolvedAccess,
          };
          projectWorkspaceRef.current = refreshed;
          if (typeof window !== "undefined") {
            writeStickyDeepWork(window.localStorage, refreshed);
          }
          return refreshed;
        });
      } catch (error) {
        if (cancelled) return;
        // SN-270: a failed revalidation is not automatically a dead root. A
        // dropped connection, a restarting dev server, or a single 5xx must
        // leave the remembered root exactly where it is; only a definitive
        // missing/invalid-root answer clears sticky state and falls back.
        if (stickyRootRevalidationDisposition(error) === "keep") return;
        if (typeof window !== "undefined") {
          clearStickyDeepWork(window.localStorage);
        }
        setOpenedWorkspace((current) =>
          current && current.rootPath === restoredStickyWorkspace.rootPath ? null : current
        );
        if (projectWorkspaceRef.current?.rootPath === restoredStickyWorkspace.rootPath) {
          projectWorkspaceRef.current = null;
        }
        const fallback = storedVaultReturnState();
        setActiveNotebookPath(fallback.activeNotebookPath);
        setActiveSectionPath(fallback.activeSectionPath);
        setActivePagePath(fallback.activePagePath);
        setDraft(fallback.draft);
        draftRef.current = fallback.draft;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restoredStickyWorkspace, storedVaultReturnState]);

  const returnToAscentVector = React.useCallback((surface: "workspace" | "diff") => {
    if (!activeProjectWorkspace) return;
    const target = buildAscentVectorReturnUrl(
      { ...activeProjectWorkspace, returnUrl: workspaceSession?.returnUrl },
      surface,
      activeJupyterFocus,
      { serverValidatedReturnUrl: true }
    );
    if (target) {
      window.location.assign(target);
    } else if (surface === "workspace") {
      window.history.back();
    }
  }, [activeJupyterFocus, activeProjectWorkspace, workspaceSession?.returnUrl]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") {
        return;
      }

      if (!shouldHandlePagePrintShortcutTarget(event.target)) {
        return;
      }

      if (!canExportCurrentTextPage) {
        return;
      }

      event.preventDefault();
      void handlePrintCurrentPage();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canExportCurrentTextPage, handlePrintCurrentPage]);

  if (searchParams?.get("deepWork") === "1" && !linkedProjectWorkspace) {
    return (
      <main className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
        <div role="alert" className="max-w-lg rounded border border-destructive/40 bg-destructive/10 p-4 text-sm">
          This Deep Work link is invalid or incomplete. An absolute existing root and a valid
          access mode are required.
        </div>
      </main>
    );
  }

  if (startupBaselineMode && isLoadingTree) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background text-foreground"
        data-testid="vault-loading-screen"
      >
        <div className="flex items-center gap-3 rounded border border-border bg-surface px-4 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading vault
        </div>
      </main>
    );
  }

  // One shared prop bundle and one AiSidebar element serve every shell presentation.
  const companionProps = {
    pageTitle: draft?.title ?? "No note selected",
    scopeLabel: aiScopeLabel,
    tokenLabel: aiTokenLabel,
    activeScope: aiScope,
    scopeOptions: aiScopeOptions,
    keepConversation,
    onKeepConversationChange: handleKeepConversationChange,
    activeProviderLabel: aiProviderLabel,
    activeModelLabel: aiActiveModel,
    activeEffort: aiActiveEffort,
    assistantLabel: aiAssistantLabel,
    messages: displayedAiMessages,
    composerResetKey: aiComposerResetKey,
    composerInjectKey: aiComposerInjectKey,
    initialComposerDraft: aiComposerSnapshotRef.current.draft,
    initialComposerAttachments: aiComposerSnapshotRef.current.attachments,
    disabled: !draft || Boolean(activeProjectWorkspace && !workspaceSession?.capability),
    isTurnActive: aiTurnActive,
    providers: aiProviders,
    activeProviderId: aiActiveProviderId,
    verboseEnabled: aiVerboseEnabled,
    systemPrompt: aiSystemPrompt,
    defaultSystemPrompt: aiDefaultSystemPrompt,
    onProviderChange: handleProviderChange,
    onModelChange: handleModelChange,
    onEffortChange: (effort: string) => void handleEffortChange(effort),
    onVerboseChange: (enabled: boolean) => void handleVerboseChange(enabled),
    onSystemPromptSave: persistAiSystemPrompt,
    fastLaneProviderId,
    fastLaneProviderLabel,
    fastLaneModelLabel: fastLaneModel,
    onFastLaneProviderChange: (providerId: string) => void handleFastLaneProviderChange(providerId),
    onFastLaneModelChange: (providerId: string, model: string) => void handleFastLaneModelChange(providerId, model),
    onSubmit: (prompt: string, attachments?: AiComposerAttachment[]) => void handleAiSubmit(prompt, attachments),
    onCancel: handleAiCancel,
    onScopeChange: setAiScope,
    onComposerSnapshot: handleAiComposerSnapshot,
  } as const;
  const companionOverReader = Boolean(pdfReaderOpen);
  const companionSidebar = (
    <AiSidebar
      {...companionProps}
      mobile={!isWideViewport}
      onClose={companionOverReader || !isWideViewport ? () => setAiOpen(false) : undefined}
      elevateFloatingLayers={companionOverReader}
    />
  );

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground" data-testid="app-shell">
      <input
        ref={docxImportInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={handleDocxImportFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className={cn("flex h-full min-h-0 flex-col", isMobileCompanionOpen && "hidden")}>
        <AppSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onVaultRestored={async () => {
            setPendingVaultReload(null);
            await loadTree();
          }}
          onTreeRefresh={handleRemoteNotebookRegistered}
        />
        <OpenWorkspaceDialog
          open={openWorkspaceDialogOpen}
          onOpenChange={setOpenWorkspaceDialogOpen}
          onOpenWorkspace={handleOpenWorkspace}
        />
        <PrintSettingsDialog
          open={advancedPrintSettingsOpen}
          onOpenChange={setAdvancedPrintSettingsOpen}
          initialSettings={effectivePrintSettings}
          onSave={setSessionPrintSettings}
          onSetDefault={(settings) => {
            savePrintSettings(settings);
            setSessionPrintSettings(settings);
          }}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            ref={treeSidebarRailRef}
            className={cn(
              "relative hidden min-h-0 shrink-0 border-r border-border bg-[color:var(--rail)] xl:flex xl:flex-col",
              treeSidebarCollapsed && "w-11"
            )}
            style={treeSidebarCollapsed ? undefined : { width: treeSidebarWidth }}
            data-testid="tree-sidebar-rail"
            data-collapsed={treeSidebarCollapsed ? "true" : "false"}
          >
            {treeSidebarCollapsed ? (
              <div className="flex h-full flex-col items-center py-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Expand notebook tree"
                  data-testid="tree-sidebar-expand"
                  onClick={() => setTreeCollapsed(false)}
                >
                  <PanelLeft className="size-4" />
                </Button>
              </div>
            ) : (
              <>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize notebook tree"
                  className="absolute inset-y-0 right-0 z-10 w-3 translate-x-1.5 cursor-col-resize"
                  onPointerDown={handleTreeSidebarResizeStart}
                  data-testid="tree-sidebar-resize-handle"
                />
                <div className="min-h-0 flex-1">
                  <Sidebar
                    variant="desktop"
                    tree={treeWithOverrides}
                    isTreeLoading={isLoadingTree}
                    ghostVersions={ghostVersions}
                    activeNotebookPath={activeNotebookPath}
                    activeSectionPath={activeSectionPath}
                    activePagePath={activePagePath}
                    expandedNotebooks={expandedNotebooks}
                    expandedSections={expandedSections}
                    expandedPages={expandedPages}
                    onToggleNotebook={handleSidebarToggleNotebook}
                    onToggleSection={handleSidebarToggleSection}
                    onTogglePage={handleSidebarTogglePage}
                    onSelectNotebook={handleSidebarSelectNotebook}
                    onSelectSection={handleSidebarSelectSection}
                    onOpenPage={handleSidebarOpenPage}
                    onNestPage={handleSidebarNestPage}
                    onSetPageKeyNote={handleSidebarSetPageKeyNote}
                    onReorderPages={handleSidebarReorderPages}
                    onApplyPageDrop={handleSidebarApplyPageDrop}
                    onCreateNotebook={handleCreateNotebookDialog}
                    onOpenWorkspace={activeProjectWorkspace ? undefined : () => setOpenWorkspaceDialogOpen(true)}
                    onRevealNotebook={handleRevealNotebook}
                    onCreateSection={handleCreateSectionDialog}
                    onRenameNotebook={handleRenameNotebookDialog}
                    onDeleteNotebook={handleDeleteNotebookDialog}
                    onCloseNotebook={closeNotebook}
                    onOpenNotebook={openNotebook}
                    closedNotebooks={closedNotebooks}
                    pinnedNotebooks={pinnedNotebooks}
                    pinnedPages={pinnedPages}
                    onTogglePinnedNotebook={handleTogglePinnedNotebook}
                    onTogglePinnedPage={handleTogglePinnedPage}
                    notebookOrder={notebookOrder}
                    notebookGroups={notebookGroups}
                    archivedNotebooks={archivedNotebooks}
                    onReorderNotebooks={handleReorderNotebooks}
                    onCreateNotebookGroup={handleCreateNotebookGroup}
                    onRenameNotebookGroup={handleRenameNotebookGroup}
                    onDeleteNotebookGroup={handleDeleteNotebookGroup}
                    onToggleNotebookGroup={handleToggleNotebookGroup}
                    onMoveNotebookToGroup={handleMoveNotebookToGroup}
                    onArchiveNotebook={handleArchiveNotebook}
                    onUnarchiveNotebook={handleUnarchiveNotebook}
                    onCreatePage={handleCreatePageDialog}
                    onCreateJupyterNotebook={handleCreateJupyterDialog}
                    onCreateLogPage={handleCreateLogDialog}
                    onCreateDesignPage={handleCreateDesignDialog}
                    onCreateSpreadsheetPage={handleCreateSpreadsheetDialog}
                    onLinkDesign={(initialPath) => {
                      handleLinkDesign(initialPath);
                    }}
                    onDirectCreatePage={handleDirectCreatePage}
                    onImportDocx={openDocxImportPicker}
                    onRenameSection={handleRenameSectionDialog}
                    onDeleteSection={handleDeleteSectionDialog}
                    onRenamePage={handleRenamePageDialog}
                    onMovePage={handleMovePageDialog}
                    onDeletePage={handleDeletePageDialog}
                    onTogglePageVersions={handleSidebarTogglePageVersions}
                    onPreviewGhostVersion={handleSidebarPreviewGhostVersion}
                    previewedVersionId={activeVersionPreview?.versionId ?? null}
                    onRestoreGhostVersion={handleSidebarRestoreGhostVersion}
                    onDismissGhostVersions={dismissGhostVersions}
                    onCollapseTree={collapseTreeSidebar}
                    onExportPage={() => void handleExportCurrentPage()}
                    onExportDocxPage={() => void handleExportCurrentPageDocx()}
                  />
                </div>
              </>
            )}
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface" data-testid="page-main">
            <TopBar
              header={buildHeaderContext(activeSelection)}
              saveLabel={saveLabel}
              syncConnectionState={syncConnectionState}
              isReloading={isReloading}
              hasPendingPageReload={hasPendingPageReload}
              hasPendingVaultReload={hasPendingVaultReload}
              isAiOpen={aiOpen}
              isAiReady={companionIconReady}
              isAiWorking={companionIconWorking}
              canCreateSection={Boolean(activeSelection.notebook)}
              canCreatePage={Boolean(activeCreateTarget)}
              canExportPage={canExportCurrentTextPage}
              canRefreshNote={Boolean(draft) && !activeVersionPreview}
              isRefreshingNote={isRefreshingNote}
              onRefreshNote={() => void handleRefreshNote()}
              onReload={handleReload}
              onOpenSearch={openSearchModal}
              onOpenSidebar={() => setSidebarOpen(true)}
              onToggleAi={() => setAiOpen((current) => !current)}
              onOpenSettings={() => setSettingsOpen(true)}
              onExportPage={() => void handleExportCurrentPage()}
              onPrintPage={() => void handlePrintCurrentPage()}
              onOpenAdvancedPrintSettings={() => setAdvancedPrintSettingsOpen(true)}
              onCreateNotebook={handleCreateNotebookDialog}
              onCreateSection={() => {
                if (!activeSelection.notebook) {
                  return;
                }

                setDialogValue("New Section");
                setDialogState({
                  kind: "createSection",
                  notebookPath: activeSelection.notebook.path,
                  notebookName: activeSelection.notebook.name,
                });
              }}
              onCreatePage={() => {
                if (!activeCreateTarget) {
                  return;
                }

                setDialogValue("Untitled page");
                setDialogState({
                  kind: "createPage",
                  ...activeCreateTarget,
                });
              }}
              onCreateJupyterPage={() => {
                if (!activeCreateTarget) {
                  return;
                }

                setDialogValue("Untitled notebook");
                setDialogState({
                  kind: "createPage",
                  ...activeCreateTarget,
                  noteType: "jupyter",
                });
              }}
              onCreateDesignPage={() => {
                if (!activeCreateTarget) {
                  return;
                }
                handleCreateDesignDialog(activeCreateTarget);
              }}
              onCreateSpreadsheetPage={() => {
                if (!activeCreateTarget) return;
                handleCreateSpreadsheetDialog(activeCreateTarget);
              }}
              onLinkDesign={() => {
                const notebook = activeSelection.notebook;
                handleLinkDesign(notebook?.rootPath ?? undefined);
              }}
              onOpenCapture={openCaptureDialog}
              onOpenWorkspace={activeProjectWorkspace ? undefined : () => setOpenWorkspaceDialogOpen(true)}
            />
            <div className="flex min-h-0 flex-1 flex-col">
            {activeVersionPreview ? (
              <VersionPreviewBanner
                versionTs={activeVersionPreview.versionTs}
                onExit={exitVersionPreview}
              />
            ) : hasPendingPageReload && pendingPageReload?.source === "file" ? (
              // AC8 (SN-84): prominent banner when a companion API write has updated the page on disk.
              <PageChangedBanner onReload={handleReload} />
            ) : null}
            {draft ? (
              draft.noteType === "spreadsheet" ? (
                <SpreadsheetPageView
                  key={`${draft.path}:${spreadsheetReloadNonce}:${activeVersionPreview?.versionId ?? "live"}`}
                  pagePath={draft.path}
                  title={draft.title}
                  readOnly={Boolean(activeVersionPreview)}
                  previewWorkbookJson={activeVersionPreview?.content}
                  handleRef={spreadsheetPageRef}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  onSaveStatusChange={(status) => {
                    if (activeVersionPreview) return;
                    if (status === "saving") setSaveState("saving");
                    else if (status === "saved") setSaveState("saved");
                    else if (status === "error") setSaveState("error");
                    else setSaveState("dirty");
                  }}
                />
              ) : draft.noteType === "log" ? (
                <LogPageView
                  key={`${draft.path}:${logReloadNonce}`}
                  pagePath={draft.path}
                  title={draft.title}
                  leading={
                    <button
                      data-testid="log-sidebar-toggle"
                      onClick={() => setSidebarOpen(true)}
                      className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Open sidebar"
                    >
                      <Menu className="size-4" />
                    </button>
                  }
                  focusedShellHref={focusedLogUrl(draft.path)}
                />
              ) : draft.noteType === "jupyter" ? (
                <JupyterNotebookView
                  key={`${draft.path}:${jupyterReloadNonce}`}
                  pagePath={draft.path}
                  title={draft.title}
                  workspace={activeProjectWorkspace ? {
                    rootPath: activeProjectWorkspace.rootPath,
                    projectId: activeProjectWorkspace.projectId,
                    repoId: activeProjectWorkspace.repoId,
                    branch: activeProjectWorkspace.branch,
                    requestedAccess: activeProjectWorkspace.requestedAccess,
                    ownerOpen: activeProjectWorkspace.ownerOpen,
                    defaultBranchEditConfirmed: activeProjectWorkspace.defaultBranchEditConfirmed,
                    projectName: activeProjectWorkspace.projectName,
                    workItemId: activeProjectWorkspace.workItemId,
                    worktreeLabel: activeProjectWorkspace.worktreeLabel,
                    returnUrl: activeProjectWorkspace.returnUrl,
                    activeFile: activeProjectWorkspace.activeFile,
                    activeLine: activeProjectWorkspace.activeLine,
                  } : undefined}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  onBack={
                    activeProjectWorkspace?.returnUrl
                      ? () => returnToAscentVector("workspace")
                      : activeProjectWorkspace && openedWorkspace
                        ? handleLeaveOpenedWorkspace
                        : undefined
                  }
                  backLabel={
                    activeProjectWorkspace?.returnUrl
                      ? "Return to Ascent Vector"
                      : activeProjectWorkspace && openedWorkspace
                        ? "Back to notes"
                        : undefined
                  }
                  onViewDiff={
                    workspaceSession?.returnUrl
                      ? () => returnToAscentVector("diff")
                      : undefined
                  }
                  onFocusChange={setActiveJupyterFocus}
                  onWorkspaceReady={setWorkspaceSession}
                  externalReload={activeProjectWorkspace ? workspaceDocumentReload : null}
                  onAskInCompanion={handleJupyterAskInCompanion}
                />
              ) : draft.noteType === "app" ? (
                <AppPageView
                  key={draft.path}
                  pagePath={draft.path}
                  title={draft.title}
                  bodyHtml={draft.content}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  reloadRequestNonce={appReloadRequestNonce}
                  onOpenPage={handleAppOpenPage}
                  onCompanionSend={handleAppCompanionSend}
                />
              ) : draft.noteType === "design" ? (
                <DesignPageView
                  key={`${draft.path}:${designReloadNonce}`}
                  pagePath={draft.path}
                  title={draft.title}
                  bodyHtml={draft.content}
                  designLinked={Boolean(draft.designLinked)}
                  sourceMissing={Boolean(draft.sourceMissing)}
                  resolvedDiskPath={draft.resolvedDiskPath}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  onRevealSource={
                    draft.designLinked ? () => void handleRevealDesignSource() : undefined
                  }
                  onRelinkSource={
                    draft.designLinked ? () => void handleRelinkDesign() : undefined
                  }
                  onLinkFromSource={
                    !draft.designLinked && activeSelection.notebook?.isPortable
                      ? () =>
                          handleLinkDesign(
                            activeSelection.notebook?.rootPath ?? draft.resolvedDiskPath ?? undefined,
                            draft.path
                          )
                      : undefined
                  }
                  onBodyChange={
                    activeVersionPreview || draft.sourceMissing
                      ? undefined
                      : (content) => updateDraft({ content })
                  }
                  onSaveStatusChange={(status) => {
                    if (activeVersionPreview) return;
                    if (status === "saving") setSaveState("saving");
                    else if (status === "saved") setSaveState("saved");
                    else if (status === "error") setSaveState("error");
                    else setSaveState("idle");
                  }}
                />
              ) : draft.noteType === "ink" ? (
                <InkCanvas
                  key={`${draft.path}:${inkReloadNonce}:${activeVersionPreview?.versionId ?? "live"}`}
                  ref={inkCanvasRef}
                  pagePath={draft.path}
                  title={draft.title}
                  readOnly={Boolean(activeVersionPreview)}
                  previewSidecarJson={activeVersionPreview?.content}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  onSaveStatusChange={(status) => {
                    if (activeVersionPreview) return;
                    if (status === "saving") setSaveState("saving");
                    else if (status === "saved") setSaveState("saved");
                    else if (status === "error") setSaveState("error");
                    else setSaveState("idle");
                  }}
                />
              ) : (
              <EditorPanel
                draft={draft}
                editorRef={editorRef}
                annotationLayerRef={annotationLayerRef}
                readOnly={Boolean(activeVersionPreview)}
                previewContent={activeVersionPreview?.content}
                previewAnnotationsJson={activeVersionPreview?.annotationsContent ?? undefined}
                onTitleChange={(title) => updateDraft({ title })}
                onContentChange={(content) => updateDraft({ content })}
                onSelectionContextChange={setAiSectionContext}
                onPdfAttachmentOpen={openPdfReader}
                onAnnotationSaveStatusChange={(status) => {
                  if (activeVersionPreview) return;
                  if (status === "saving") setSaveState("saving");
                  else if (status === "saved") setSaveState("saved");
                  else if (status === "error") setSaveState("error");
                }}
                onCommentsChange={async (comments) => {
                  if (activeVersionPreview) return;
                  const path = activePagePathRef.current;
                  if (!path) return;
                  try {
                    // Include the current in-memory content so the comment save
                    // never discards text that the autosave hasn't flushed yet.
                    const pageBody = draftRef.current?.content;
                    await vaultWriteFetch("/api/page/comments", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ path, comments, pageBody }),
                    });
                    syncTreePage(path, (page) => ({
                      ...page,
                      metadata: {
                        ...(page.metadata ?? {}),
                        comments,
                      },
                    }));
                    setDraft((d) =>
                      d ? { ...d, metadata: { ...d.metadata, comments } } : d
                    );
                  } catch {
                    // non-fatal — comments will re-sync on next page load
                  }
                }}
              />
              )
            ) : (
              <EmptyState
                activeNotebook={activeSelection.notebook}
                activeSection={activeSelection.section}
                onCreateNotebook={handleCreateNotebookDialog}
                onCreatePage={() => {
                  if (!activeCreateTarget) {
                    return;
                  }

                  setDialogValue("Untitled page");
                  setDialogState({
                    kind: "createPage",
                    ...activeCreateTarget,
                  });
                }}
                onOpenCapture={openCaptureDialog}
              />
            )}
            </div>
          </div>

          {aiOpen && isWideViewport ? (
            <aside
              ref={aiSidebarRailRef}
              className={cn(
                "min-h-0 shrink-0 border-l border-border bg-[color:var(--rail)] xl:flex xl:flex-col",
                companionOverReader
                  ? "fixed inset-y-0 right-0 z-[var(--z-companion-rail)] shadow-lg"
                  : "relative hidden"
              )}
              // Over the immersive reader the rail is position:fixed, but it still
              // uses the same persisted width + clamps as the notebook companion so
              // width carries between presentations (SN-161).
              style={{ width: aiSidebarWidth }}
              data-testid={companionOverReader ? "pdf-reader-ai-sidebar" : "ai-sidebar-rail"}
              aria-label={companionOverReader ? "Smart Notes AI" : undefined}
            >
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize AI sidebar"
                className="absolute inset-y-0 left-0 z-10 w-3 -translate-x-1.5 cursor-col-resize"
                onPointerDown={handleAiSidebarResizeStart}
                data-testid="ai-sidebar-resize-handle"
              />
              {companionSidebar}
            </aside>
          ) : null}
        </div>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[92vw] max-w-[360px] border-r border-border bg-[color:var(--rail)] p-0">
          <SheetHeader className="border-b border-border px-4 py-4">
            <SheetTitle className="font-serif text-2xl">Notes</SheetTitle>
          </SheetHeader>
          <Sidebar
            tree={treeWithOverrides}
            isTreeLoading={isLoadingTree}
            activeNotebookPath={activeNotebookPath}
            activeSectionPath={activeSectionPath}
            activePagePath={activePagePath}
            expandedNotebooks={expandedNotebooks}
            expandedSections={expandedSections}
            expandedPages={expandedPages}
            onToggleNotebook={handleSidebarToggleNotebook}
            onToggleSection={handleSidebarToggleSection}
            onTogglePage={handleSidebarTogglePage}
            onSelectNotebook={handleSidebarSelectNotebook}
            onSelectSection={handleSidebarSelectSection}
            onOpenPage={handleSidebarOpenPage}
            onNestPage={handleSidebarNestPage}
            onSetPageKeyNote={handleSidebarSetPageKeyNote}
            onReorderPages={handleSidebarReorderPages}
            onApplyPageDrop={handleSidebarApplyPageDrop}
            onCreateNotebook={handleCreateNotebookDialog}
            onOpenWorkspace={activeProjectWorkspace ? undefined : () => setOpenWorkspaceDialogOpen(true)}
            onRevealNotebook={handleRevealNotebook}
            onCreateSection={handleCreateSectionDialog}
            onRenameNotebook={handleRenameNotebookDialog}
            onDeleteNotebook={handleDeleteNotebookDialog}
            onCloseNotebook={closeNotebook}
            onOpenNotebook={openNotebook}
            closedNotebooks={closedNotebooks}
            pinnedNotebooks={pinnedNotebooks}
            pinnedPages={pinnedPages}
            onTogglePinnedNotebook={handleTogglePinnedNotebook}
            onTogglePinnedPage={handleTogglePinnedPage}
            notebookOrder={notebookOrder}
            notebookGroups={notebookGroups}
            archivedNotebooks={archivedNotebooks}
            onReorderNotebooks={handleReorderNotebooks}
            onCreateNotebookGroup={handleCreateNotebookGroup}
            onRenameNotebookGroup={handleRenameNotebookGroup}
            onDeleteNotebookGroup={handleDeleteNotebookGroup}
            onToggleNotebookGroup={handleToggleNotebookGroup}
            onMoveNotebookToGroup={handleMoveNotebookToGroup}
            onArchiveNotebook={handleArchiveNotebook}
            onUnarchiveNotebook={handleUnarchiveNotebook}
            onCreatePage={handleCreatePageDialog}
            onCreateJupyterNotebook={handleCreateJupyterDialog}
            onCreateLogPage={handleCreateLogDialog}
            onCreateDesignPage={handleCreateDesignDialog}
            onCreateSpreadsheetPage={handleCreateSpreadsheetDialog}
            onLinkDesign={(initialPath) => {
              handleLinkDesign(initialPath);
            }}
            onDirectCreatePage={handleDirectCreatePage}
            onImportDocx={openDocxImportPicker}
            onRenameSection={handleRenameSectionDialog}
            onDeleteSection={handleDeleteSectionDialog}
            onRenamePage={handleRenamePageDialog}
            onMovePage={handleMovePageDialog}
            onDeletePage={handleDeletePageDialog}
            ghostVersions={ghostVersions}
            onTogglePageVersions={handleSidebarTogglePageVersions}
            onPreviewGhostVersion={handleSidebarPreviewGhostVersion}
            previewedVersionId={activeVersionPreview?.versionId ?? null}
            onRestoreGhostVersion={handleSidebarRestoreGhostVersion}
            onDismissGhostVersions={dismissGhostVersions}
            onExportPage={() => void handleExportCurrentPage()}
            onExportDocxPage={() => void handleExportCurrentPageDocx()}
          />
        </SheetContent>
      </Sheet>

      <MobileAiSheet
        open={aiOpen && !isWideViewport}
        onOpenChange={setAiOpen}
        overReader={companionOverReader}
      >
        {companionSidebar}
      </MobileAiSheet>

      <SearchModal
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
        isServerFallback={isShowingServerSearch}
        fallbackState={serverSearchState}
        onOpenChange={handleSearchOpenChange}
        onQueryChange={setSearchQuery}
        onSelectResult={handleSearchResultSelect}
      />

      {pdfReader ? (
        <ImmersivePdfReader
          key={pdfReader.href}
          href={pdfReader.href}
          fileName={pdfReader.fileName}
          onClose={closePdfReader}
          open={pdfReaderOpen}
          companionOpen={pdfReaderOpen && aiOpen}
          companionAnswerReady={companionIconReady}
          companionWorking={companionIconWorking}
          onToggleCompanion={() => setAiOpen((current) => !current)}
          onPageChange={handlePdfReaderPageChange}
        />
      ) : null}

      <CreateNotebookDialog
        open={createNotebookDialogOpen}
        onOpenChange={setCreateNotebookDialogOpen}
        onCreateVaultNotebook={handleCreateVaultNotebookFromDialog}
        onRemoteRegistered={handleRemoteNotebookRegistered}
        isSubmitting={isDialogSubmitting}
        error={createNotebookError}
      />

      <LinkDesignSourceDialog
        open={linkDesignDialog.open}
        mode={linkDesignDialog.mode}
        initialPath={linkDesignDialog.initialPath}
        replaceCurrent={Boolean(linkDesignDialog.replacePath)}
        onOpenChange={(open) =>
          setLinkDesignDialog((current) => ({
            ...current,
            open,
          }))
        }
        onConfirm={handleConfirmLinkDesignSource}
      />

      <Dialog open={dialogState !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle(dialogState)}</DialogTitle>
            <DialogDescription>{dialogDescription(dialogState)}</DialogDescription>
          </DialogHeader>

          {dialogState?.kind === "deleteNotebook" ||
          dialogState?.kind === "deleteSection" ||
          dialogState?.kind === "deletePage" ||
          dialogState?.kind === "confirmRemoteReload" ? (
            <p className="text-sm text-muted-foreground">{deleteDialogCopy(dialogState)}</p>
          ) : dialogState?.kind === "movePage" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Destination section</label>
              <select
                value={dialogSelectValue}
                onChange={(event) => setDialogSelectValue(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="move-page-select"
              >
                {allSections.map((section) => (
                  <option key={section.sectionPath} value={section.sectionPath}>
                    {section.notebookName} / {section.sectionName}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <Input
              value={dialogValue}
              onChange={(event) => setDialogValue(event.target.value)}
              autoFocus
              data-testid="dialog-input"
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isDialogSubmitting}>
              Cancel
            </Button>
            <Button
              variant={
                dialogState?.kind === "deleteNotebook" ||
                dialogState?.kind === "deleteSection" ||
                dialogState?.kind === "deletePage" ||
                dialogState?.kind === "confirmRemoteReload"
                  ? "destructive"
                  : "default"
              }
              onClick={() => void handleDialogSubmit()}
              disabled={isDialogSubmitting || isDialogInvalid(dialogState, dialogValue, dialogSelectValue)}
            >
              {isDialogSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : dialogActionLabel(dialogState)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={captureDialog.open}
        onOpenChange={(open) => setCaptureDialog((current) => ({ ...current, open }))}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Quick capture</DialogTitle>
            <DialogDescription>
              Save clipped text to Inbox or turn it into a new page in a real notebook section.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Destination</label>
                <select
                  value={captureDialog.destination}
                  onChange={(event) =>
                    setCaptureDialog((current) => ({
                      ...current,
                      destination: event.target.value as "inbox" | "page",
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="capture-destination-select"
                >
                  <option value="inbox">Inbox</option>
                  <option value="page">New page</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Title</label>
                <Input
                  value={captureDialog.title}
                  onChange={(event) =>
                    setCaptureDialog((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  data-testid="capture-title-input"
                />
              </div>
            </div>

            {captureDialog.destination === "inbox" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Notebook</label>
                <select
                  value={captureDialog.notebookPath}
                  onChange={(event) =>
                    setCaptureDialog((current) => ({
                      ...current,
                      notebookPath: event.target.value,
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="capture-notebook-select"
                >
                  {tree.map((notebook) => (
                    <option key={notebook.path} value={notebook.path}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Section</label>
                <select
                  value={captureDialog.sectionPath}
                  onChange={(event) =>
                    setCaptureDialog((current) => ({
                      ...current,
                      sectionPath: event.target.value,
                    }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="capture-section-select"
                >
                  {allSections.map((section) => (
                    <option key={section.sectionPath} value={section.sectionPath}>
                      {section.notebookName} / {section.sectionName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Captured content</label>
              <Textarea
                value={captureDialog.content}
                onChange={(event) =>
                  setCaptureDialog((current) => ({
                    ...current,
                    content: event.target.value,
                  }))
                }
                className="min-h-[260px] rounded border-border bg-background/70 px-4 py-3 font-mono text-sm leading-6"
                placeholder="Paste text, links, or copied AI output."
                data-testid="capture-content-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCaptureDialog((current) => ({ ...current, open: false }))}
              disabled={captureDialog.isSubmitting}
              data-testid="capture-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleCaptureSubmit()}
              disabled={
                captureDialog.isSubmitting ||
                !captureDialog.content.trim() ||
                (captureDialog.destination === "page" && !captureDialog.sectionPath)
              }
              data-testid="capture-submit-btn"
            >
              {captureDialog.isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : captureDialog.destination === "inbox" ? (
                "Save to Inbox"
              ) : (
                "Create new page"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TopBar({
  header,
  saveLabel,
  syncConnectionState,
  isReloading,
  hasPendingPageReload,
  hasPendingVaultReload,
  isAiOpen,
  isAiReady,
  isAiWorking,
  canCreateSection,
  canCreatePage,
  canExportPage,
  canRefreshNote,
  isRefreshingNote,
  onRefreshNote,
  onReload,
  onOpenSearch,
  onOpenSidebar,
  onToggleAi,
  onOpenSettings,
  onExportPage,
  onPrintPage,
  onOpenAdvancedPrintSettings,
  onCreateNotebook,
  onCreateSection,
  onCreatePage,
  onCreateJupyterPage,
  onCreateDesignPage,
  onCreateSpreadsheetPage,
  onLinkDesign,
  onOpenCapture,
  onOpenWorkspace,
}: {
  header: { title: string; subtitle: string | null };
  saveLabel: string;
  syncConnectionState: SyncConnectionState;
  isReloading: boolean;
  hasPendingPageReload: boolean;
  hasPendingVaultReload: boolean;
  isAiOpen: boolean;
  isAiReady: boolean;
  isAiWorking: boolean;
  canCreateSection: boolean;
  canCreatePage: boolean;
  canExportPage: boolean;
  canRefreshNote: boolean;
  isRefreshingNote: boolean;
  onRefreshNote: () => void;
  onReload: () => void;
  onOpenSearch: () => void;
  onOpenSidebar: () => void;
  onToggleAi: () => void;
  onOpenSettings: () => void;
  onExportPage: () => void;
  onPrintPage: () => void;
  onOpenAdvancedPrintSettings: () => void;
  onCreateNotebook: () => void;
  onCreateSection: () => void;
  onCreatePage: () => void;
  onCreateJupyterPage: () => void;
  onCreateDesignPage: () => void;
  onCreateSpreadsheetPage: () => void;
  onLinkDesign: () => void;
  onOpenCapture: () => void;
  onOpenWorkspace?: () => void;
}) {
  const connection = useConnectionStatus();
  const connectionLost = connection.status === "lost";
  const syncConnected = syncConnectionState === "connected";
  const syncLabel = connectionLost
    ? connection.message ?? "Write failed"
    : syncConnected
      ? "Connected / Idle"
      : syncConnectionState === "connecting"
        ? "Connecting"
        : "Disconnected";

  return (
    <header
      className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-background/95 pl-1 pr-3 backdrop-blur md:h-14 md:pl-2 md:pr-4 xl:h-[var(--desktop-chrome-height)] xl:pr-3"
      data-print-chrome="true"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 xl:gap-1.5">
        <Button variant="ghost" size="icon" className="shrink-0 xl:hidden" onClick={onOpenSidebar} data-testid="open-sidebar-btn">
          <Menu className="size-4" />
        </Button>
        <div className="flex min-w-0 items-center gap-2 md:gap-3 xl:gap-2">
          <div className="hidden size-10 items-center justify-center rounded border border-border bg-surface sm:flex xl:size-8">
            <NotebookPen className="size-4 text-accent xl:size-3.5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-serif text-base md:text-lg xl:text-base">{header.title}</p>
            {header.subtitle ? (
              <p className="truncate text-[11px] text-muted-foreground xl:text-[10px]">{header.subtitle}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2 xl:gap-1">
        {connectionLost ? (
          <div
            className="flex items-center gap-1.5 rounded border border-destructive/60 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
            data-testid="connection-lost-indicator"
            role="status"
            aria-live="polite"
            title={connection.message ?? undefined}
          >
            <WifiOff className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">{connection.message}</span>
          </div>
        ) : null}
        <div
          className={cn(
            "flex items-center gap-1.5 rounded border px-2 py-1 text-xs",
            syncConnected
              ? "border-border bg-surface text-muted-foreground"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          )}
          data-testid="sync-state-indicator"
          role="status"
          aria-live="polite"
          title={syncLabel}
        >
          {syncConnected ? <CheckCircle2 className="size-3.5" /> : <WifiOff className="size-3.5" />}
          <span className="hidden md:inline">{syncLabel}</span>
        </div>
        <div className="hidden rounded border border-border bg-surface px-3 py-1 text-xs text-muted-foreground md:block xl:px-2 xl:text-[11px]" data-testid="save-status">
          {saveLabel}
        </div>
        <Button variant="ghost" size="icon" onClick={onOpenSearch} aria-label="Open search" data-testid="open-search-btn">
          <Search className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onOpenCapture} data-testid="capture-btn">
          <Inbox className="size-4" />
        </Button>
        {onOpenWorkspace ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenWorkspace}
            aria-label="Open workspace"
            title="Open workspace"
            data-testid="open-workspace-btn"
          >
            <FolderOpen className="size-4" />
          </Button>
        ) : null}
        {canExportPage ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={onExportPage}
              aria-label="Export page as HTML"
              title="Export page as HTML"
              data-testid="export-page-btn"
            >
              <Download className="size-4" />
            </Button>
            <div className="flex items-center" data-testid="print-page-controls">
              <Button
                variant="ghost"
                size="icon"
                onClick={onPrintPage}
                aria-label="Print page"
                title="Print page (Ctrl+P)"
                data-testid="print-page-btn"
                className="rounded-r-none"
              >
                <Printer className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="inline-flex h-9 w-6 items-center justify-center rounded-r-sm border-l border-border/60 text-foreground/70 hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Print options"
                  data-testid="print-page-menu-trigger"
                >
                  <ChevronDown className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={onOpenAdvancedPrintSettings}
                    data-testid="print-advanced-settings-item"
                  >
                    Advanced print settings…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex size-9 items-center justify-center rounded-sm text-foreground/70 hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="add-menu-trigger"
          >
            <Plus className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onCreateNotebook}>New notebook</DropdownMenuItem>
            {onOpenWorkspace ? (
              <DropdownMenuItem onClick={onOpenWorkspace} data-testid="open-workspace-menu-item">
                <FolderOpen className="mr-2 size-3.5" />
                Open workspace…
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onCreateSection} disabled={!canCreateSection}>
              New section
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreatePage} disabled={!canCreatePage}>
              New page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateJupyterPage} disabled={!canCreatePage}>
              New Jupyter notebook
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateDesignPage} disabled={!canCreatePage}>
              New design page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateSpreadsheetPage} disabled={!canCreatePage} data-testid="create-spreadsheet-menu-item">
              <Table2 className="mr-2 size-3.5 text-chart-2" />
              New spreadsheet
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLinkDesign} data-testid="link-design-menu-item">
              <Link2 className="mr-2 size-3.5" />
              Link design…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          onClick={hasPendingPageReload || hasPendingVaultReload ? onReload : onRefreshNote}
          disabled={isReloading || isRefreshingNote || (!canRefreshNote && !hasPendingPageReload && !hasPendingVaultReload)}
          aria-label={
            hasPendingPageReload
              ? "Reload latest page changes"
              : hasPendingVaultReload
                ? "Reload vault structure"
                : "Refresh note from saved version"
          }
          title={
            hasPendingPageReload
              ? "Reload latest page changes"
              : hasPendingVaultReload
                ? "Reload vault structure"
                : "Refresh note from saved version"
          }
          className={cn(
            "relative",
            (hasPendingPageReload || hasPendingVaultReload) && "bg-accent/10 text-accent hover:bg-accent/15"
          )}
          data-testid="reload-btn"
        >
          {isReloading || isRefreshingNote ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          {hasPendingPageReload ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-accent"
              aria-hidden="true"
              data-testid="pending-page-reload-indicator"
            />
          ) : hasPendingVaultReload ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-accent"
              aria-hidden="true"
              data-testid="pending-vault-reload-indicator"
            />
          ) : null}
        </Button>
        {hasPendingPageReload || hasPendingVaultReload ? (
          <span
            className="inline-flex size-8 items-center justify-center text-accent"
            role="status"
            aria-live="polite"
            aria-label={hasPendingPageReload ? "Remote note update available" : "Vault structure changed"}
            title={hasPendingPageReload ? "Remote note update available" : "Vault structure changed"}
            data-testid="reload-status-indicator"
          >
            <AlertTriangle className="size-4" />
          </span>
        ) : null}
        <Button
          variant={isAiOpen ? "default" : "ghost"}
          size="icon"
          onClick={onToggleAi}
          aria-label={
            isAiOpen
              ? "Close Smart Notes AI"
              : isAiReady
                ? "Open Smart Notes AI — answer ready"
                : isAiWorking
                  ? "Open Smart Notes AI — working"
                  : "Open Smart Notes AI"
          }
          data-testid="ai-toggle-btn"
          className={cn(
            "relative",
            isAiOpen &&
              "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:bg-[color:var(--accent)]/90",
            !isAiOpen && isAiReady && "bg-accent/10 text-accent hover:bg-accent/15"
          )}
        >
          <Sparkles className="size-4" />
          {/* SN-211: closed-panel companion affordance. Ready is a solid accent dot
              (attention); working is a quiet, slower muted pulse that yields to
              reduced-motion. Both clear once the companion is opened. */}
          {isAiReady ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-accent"
              role="status"
              aria-live="polite"
              aria-label="Companion answer ready"
              data-testid="companion-ready-indicator"
            />
          ) : isAiWorking ? (
            <span
              className="absolute right-1 top-1 size-2 rounded-full bg-muted-foreground/70 animate-pulse motion-reduce:animate-none"
              aria-hidden="true"
              data-testid="companion-working-indicator"
            />
          ) : null}
        </Button>
        <AppSettingsTrigger onClick={onOpenSettings} />
      </div>
    </header>
  );
}

export const Sidebar = React.memo(function Sidebar({
  variant = "mobile",
  tree,
  isTreeLoading = false,
  activeNotebookPath,
  activeSectionPath,
  activePagePath,
  expandedNotebooks,
  expandedSections,
  expandedPages,
  closedNotebooks,
  pinnedNotebooks,
  pinnedPages,
  onTogglePinnedNotebook,
  onTogglePinnedPage,
  notebookOrder,
  notebookGroups,
  archivedNotebooks,
  onReorderNotebooks,
  onCreateNotebookGroup,
  onRenameNotebookGroup,
  onDeleteNotebookGroup,
  onToggleNotebookGroup,
  onMoveNotebookToGroup,
  onArchiveNotebook,
  onUnarchiveNotebook,
  onToggleNotebook,
  onToggleSection,
  onTogglePage,
  onSelectNotebook,
  onSelectSection,
  onOpenPage,
  onNestPage,
  onSetPageKeyNote,
  onReorderPages,
  onApplyPageDrop,
  onCreateNotebook,
  onOpenWorkspace,
  onRevealNotebook,
  onCreateSection,
  onRenameNotebook,
  onDeleteNotebook,
  onCloseNotebook,
  onOpenNotebook,
  onCreatePage,
  onCreateJupyterNotebook,
  onCreateLogPage,
  onCreateDesignPage,
  onCreateSpreadsheetPage,
  onLinkDesign,
  onDirectCreatePage,
  onImportDocx,
  onRenameSection,
  onDeleteSection,
  onRenamePage,
  onMovePage,
  onDeletePage,
  ghostVersions,
  onTogglePageVersions,
  onPreviewGhostVersion,
  previewedVersionId,
  onRestoreGhostVersion,
  onDismissGhostVersions,
  onCollapseTree,
  onExportPage,
  onExportDocxPage,
}: {
  variant?: "desktop" | "mobile";
  tree: VaultNotebook[];
  isTreeLoading?: boolean;
  activeNotebookPath: string | null;
  activeSectionPath: string | null;
  activePagePath: string | null;
  expandedNotebooks: Set<string>;
  expandedSections: Set<string>;
  expandedPages: Set<string>;
  closedNotebooks: Set<string>;
  pinnedNotebooks: Set<string>;
  pinnedPages: Set<string>;
  onTogglePinnedNotebook: (path: string) => void;
  onTogglePinnedPage: (path: string) => void;
  notebookOrder: string[];
  notebookGroups: NotebookGroup[];
  archivedNotebooks: Set<string>;
  onReorderNotebooks: (sourcePath: string, targetPath: string) => void;
  onCreateNotebookGroup: (name: string) => void;
  onRenameNotebookGroup: (id: string, name: string) => void;
  onDeleteNotebookGroup: (id: string) => void;
  onToggleNotebookGroup: (id: string) => void;
  onMoveNotebookToGroup: (notebookPath: string, groupId: string | null) => void;
  onArchiveNotebook: (path: string) => void;
  onUnarchiveNotebook: (path: string) => void;
  onToggleNotebook: (path: string) => void;
  onToggleSection: (path: string) => void;
  onTogglePage: (path: string) => void;
  onSelectNotebook: (path: string) => void;
  onSelectSection: (path: string) => void;
  onOpenPage: (pagePath: string) => void;
  onNestPage: (pagePath: string, parentId: string | null) => Promise<void>;
  onSetPageKeyNote: (pagePath: string, keyNote: boolean) => Promise<void>;
  onReorderPages: (sectionPath: string, orderedIds: string[]) => Promise<void>;
  onApplyPageDrop: (
    sectionPath: string,
    pagePath: string,
    parentId: string | null,
    orderedIds: string[]
  ) => Promise<void>;
  onCreateNotebook: () => void;
  onOpenWorkspace?: () => void;
  onRevealNotebook: (notebookPath: string) => void | Promise<void>;
  onCreateSection: (notebookPath: string, notebookName: string) => void;
  onRenameNotebook: (path: string, name: string, isPortable?: boolean) => void;
  onDeleteNotebook: (path: string, name: string, isPortable?: boolean) => void;
  onCloseNotebook: (path: string) => void;
  onOpenNotebook: (path: string) => void;
  onCreatePage: (target: CreatePageTarget) => void;
  onCreateJupyterNotebook: (target: CreatePageTarget) => void;
  onCreateLogPage: (target: CreatePageTarget) => void;
  onCreateDesignPage: (target: CreatePageTarget) => void;
  onCreateSpreadsheetPage: (target: CreatePageTarget) => void;
  onLinkDesign: (initialPath?: string) => void;
  onDirectCreatePage: (target: CreatePageTarget) => Promise<void>;
  onImportDocx: (sectionPath: string) => void;
  onRenameSection: (path: string, name: string, notebookPath: string) => void;
  onDeleteSection: (path: string, name: string) => void;
  onRenamePage: (pagePath: string, title: string) => void;
  onMovePage: (pagePath: string, title: string, currentSectionPath: string) => void;
  onDeletePage: (pagePath: string, title: string) => void;
  ghostVersions: VisibleGhostVersions | null;
  onTogglePageVersions: (pagePath: string) => void;
  onPreviewGhostVersion: (parentPagePath: string, versionId: string, versionTs: string) => void;
  previewedVersionId: string | null;
  onRestoreGhostVersion: (parentPagePath: string, versionId: string) => void;
  onDismissGhostVersions: () => void;
  onCollapseTree?: () => void;
  onExportPage: () => void;
  onExportDocxPage: () => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [draggedPagePath, setDraggedPagePath] = React.useState<string | null>(null);
  const [dragOverPagePath, setDragOverPagePath] = React.useState<string | null>(null);
  const [dragIntent, setDragIntent] = React.useState<"nest" | "unnest" | "reorder" | null>(null);
  const [dragDropSide, setDragDropSide] = React.useState<"before" | "after" | null>(null);
  const [pageContextMenu, setPageContextMenu] = React.useState<PageContextMenuState | null>(null);
  const [ghostContextMenu, setGhostContextMenu] = React.useState<GhostContextMenuState | null>(null);
  const dragStartXRef = React.useRef<number>(0);
  // Ref (not state) so onDragOver closures see the current section path synchronously
  const draggedPageSectionPathRef = React.useRef<string | null>(null);
  const visibleNotebooks = React.useMemo(
    () => tree.filter((notebook) => !closedNotebooks.has(notebook.path) && !archivedNotebooks.has(notebook.path)),
    [archivedNotebooks, closedNotebooks, tree]
  );
  const pageRowsByNotebook = React.useMemo(() => {
    const byNotebookPath = new Map<
      string,
      {
        flatNodes: ReturnType<typeof flattenPageTree>;
        nestingLookup: ReturnType<typeof buildPageNestingActionLookup>;
      }
    >();

    for (const notebook of visibleNotebooks) {
      if (!expandedNotebooks.has(notebook.path)) {
        continue;
      }

      const pageTree = buildPageTree(notebook.pages);
      const flatNodes = flattenPageTree(pageTree, expandedPages);
      byNotebookPath.set(notebook.path, {
        flatNodes,
        nestingLookup: buildPageNestingActionLookup(flatNodes),
      });
    }

    return byNotebookPath;
  }, [expandedNotebooks, expandedPages, visibleNotebooks]);
  const pageRowsBySection = React.useMemo(() => {
    const bySectionPath = new Map<
      string,
      {
        flatNodes: ReturnType<typeof flattenPageTree>;
        nestingLookup: ReturnType<typeof buildPageNestingActionLookup>;
      }
    >();

    for (const notebook of visibleNotebooks) {
      if (!expandedNotebooks.has(notebook.path)) {
        continue;
      }

      for (const section of notebook.sections) {
        if (!expandedSections.has(section.path)) {
          continue;
        }

        const pageTree = buildPageTree(section.pages);
        const flatNodes = flattenPageTree(pageTree, expandedPages);
        bySectionPath.set(section.path, {
          flatNodes,
          nestingLookup: buildPageNestingActionLookup(flatNodes),
        });
      }
    }

    return bySectionPath;
  }, [expandedNotebooks, expandedPages, expandedSections, visibleNotebooks]);

  React.useEffect(() => {
    const dismissMenus = () => {
      setPageContextMenu(null);
      setGhostContextMenu(null);
    };
    window.addEventListener("click", dismissMenus);
    window.addEventListener("scroll", dismissMenus, true);
    return () => {
      window.removeEventListener("click", dismissMenus);
      window.removeEventListener("scroll", dismissMenus, true);
    };
  }, []);

  const compactDesktop = variant === "desktop";
  const notebookRootPageIndentBase = compactDesktop ? 4 : 8;
  const sectionPageIndentBase = compactDesktop ? 14 : 20;
  const ghostIndentOffset = compactDesktop ? 14 : 16;
  const resolvePageIndent = (base: number, depth: number) =>
    compactDesktop ? `calc(${base}px + ${depth} * var(--desktop-tree-indent-step))` : base + depth * 12;
  const resolveGhostIndent = (base: number, depth: number) =>
    compactDesktop
      ? `calc(${base}px + ${depth} * var(--desktop-tree-indent-step) + ${ghostIndentOffset}px)`
      : base + depth * 12 + ghostIndentOffset;

  return (
    <div
      className={cn("minimal-scrollbar h-full overflow-auto", compactDesktop ? "p-1.5" : "p-2")}
      data-testid="tree"
      data-density-variant={variant}
      data-vault-ready={isTreeLoading ? "false" : "true"}
    >
      <div className={cn("flex items-center justify-between gap-2 px-1.5", compactDesktop ? "mb-1" : "mb-2")}>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Vault</p>
          <p className={cn("mt-0.5 font-serif leading-none", compactDesktop ? "text-base" : "text-xl")}>Notebooks</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={cn("shrink-0 text-muted-foreground", compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11")}
            onClick={() => setPickerOpen(true)}
            aria-label="Open notebook picker"
            data-testid="open-closed-notebook-btn"
          >
            <FolderOpen className={cn(compactDesktop ? "size-3.5" : "size-4")} />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className={cn("shrink-0", compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11")}
            onClick={onCreateNotebook}
            data-testid="new-notebook-btn"
            aria-label="New notebook"
          >
            <Plus className={cn(compactDesktop ? "size-3.5" : "size-4")} />
          </Button>
          {onCollapseTree ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={cn("shrink-0 text-muted-foreground", compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11")}
              aria-label="Collapse notebook tree"
              data-testid="tree-sidebar-collapse"
              onClick={onCollapseTree}
            >
              <PanelLeftClose className={cn(compactDesktop ? "size-3.5" : "size-4")} />
            </Button>
          ) : null}
        </div>
      </div>

      {onOpenWorkspace ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "mb-2 w-full justify-start",
            compactDesktop ? "h-7 px-2 text-xs" : "min-h-11"
          )}
          onClick={onOpenWorkspace}
          data-testid={`sidebar-open-workspace-${variant}`}
        >
          <FolderOpen className="size-4" />
          Open workspace
        </Button>
      ) : null}

      <OpenClosedNotebooksDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        tree={tree}
        closedNotebooks={closedNotebooks}
        archivedNotebooks={archivedNotebooks}
        pinnedNotebooks={pinnedNotebooks}
        pinnedPages={pinnedPages}
        notebookOrder={notebookOrder}
        notebookGroups={notebookGroups}
        onTogglePinnedNotebook={onTogglePinnedNotebook}
        onTogglePinnedPage={onTogglePinnedPage}
        onReorderNotebooks={onReorderNotebooks}
        onCreateNotebookGroup={onCreateNotebookGroup}
        onRenameNotebookGroup={onRenameNotebookGroup}
        onDeleteNotebookGroup={onDeleteNotebookGroup}
        onToggleNotebookGroup={onToggleNotebookGroup}
        onMoveNotebookToGroup={onMoveNotebookToGroup}
        onArchiveNotebook={onArchiveNotebook}
        onUnarchiveNotebook={onUnarchiveNotebook}
        onOpenNotebook={onOpenNotebook}
        onSelectNotebook={onSelectNotebook}
        onOpenPage={onOpenPage}
      />

      {isTreeLoading ? (
        <div
          className="flex items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-muted-foreground"
          data-testid="vault-loading"
        >
          <LoaderCircle className="size-4 animate-spin" />
          Loading notebooks…
        </div>
      ) : null}

      <div className={cn(compactDesktop ? "space-y-1" : "space-y-2")}>
        {visibleNotebooks.map((notebook) => {
          const notebookOpen = expandedNotebooks.has(notebook.path);
          const notebookActive = notebook.path === activeNotebookPath;
          const rootTarget: CreatePageTarget = {
            notebookPath: notebook.path,
            notebookName: notebook.name,
            sectionPath: null,
            sectionName: null,
            parentId: null,
            targetLabel: notebook.name,
          };

          return (
            <div
              key={notebook.path}
              className="rounded border border-transparent bg-transparent"
              data-testid={`notebook-${notebook.path}`}
            >
              <div
                className={cn(
                  "flex items-center rounded transition",
                  compactDesktop ? "min-h-[var(--desktop-tree-section-row-height)] gap-1 px-1.5 py-0.5" : "gap-1.5 px-2 py-1",
                  notebookActive ? "bg-surface" : "hover:bg-surface"
                )}
              >
                <button
                  type="button"
                  className={cn("flex min-w-0 flex-1 items-center text-left", compactDesktop ? "gap-2" : "gap-3")}
                  onClick={() => {
                    onSelectNotebook(notebook.path);
                    onToggleNotebook(notebook.path);
                  }}
                >
                  {notebookOpen ? (
                    <ChevronDown className={cn("text-muted-foreground", compactDesktop ? "size-3.5" : "size-4")} />
                  ) : (
                    <ChevronRight className={cn("text-muted-foreground", compactDesktop ? "size-3.5" : "size-4")} />
                  )}
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: notebook.color }} />
                  <span className={cn("min-w-0 truncate font-medium", compactDesktop ? "text-[13px]" : "text-sm")}>{notebook.name}</span>
                  {notebook.isPortable ? (
                    <span className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Remote</span>
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center rounded opacity-80 transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11"
                    )}
                    data-testid={`notebook-menu-${notebook.path}`}
                  >
                    <MoreHorizontal className={cn(compactDesktop ? "size-3.5" : "size-4")} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => onCreatePage(rootTarget)}
                      data-testid={`notebook-create-page-${notebook.path}`}
                    >
                      New page
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onCreateJupyterNotebook(rootTarget)}
                      data-testid={`notebook-create-jupyter-${notebook.path}`}
                    >
                      New Jupyter notebook
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onCreateLogPage(rootTarget)}
                      data-testid={`notebook-create-log-${notebook.path}`}
                    >
                      New log
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onCreateDesignPage(rootTarget)}
                      data-testid={`notebook-create-design-${notebook.path}`}
                    >
                      New design page
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onCreateSpreadsheetPage(rootTarget)}
                      data-testid={`notebook-create-spreadsheet-${notebook.path}`}
                    >
                      <Table2 className="mr-2 size-3.5 text-chart-2" />
                      New spreadsheet
                    </DropdownMenuItem>
                    {notebook.isPortable ? (
                      <DropdownMenuItem
                        onClick={() => onLinkDesign(notebook.rootPath)}
                        data-testid={`notebook-link-design-${notebook.path}`}
                      >
                        <Link2 className="mr-2 size-3.5" />
                        Link design…
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onCreateSection(notebook.path, notebook.name)}>
                      New section
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRenameNotebook(notebook.path, notebook.name, notebook.isPortable)}>
                      Rename notebook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCloseNotebook(notebook.path)}>
                      Close notebook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void onRevealNotebook(notebook.path)}>
                      Reveal in Explorer
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDeleteNotebook(notebook.path, notebook.name, notebook.isPortable)}
                    >
                      {notebook.isPortable ? "Remove notebook" : "Delete notebook"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {notebookOpen ? (
                <div className={cn("mt-1", compactDesktop ? "space-y-0.5 pl-3" : "space-y-1 pl-4")}>
                  {(() => {
                    const notebookRows = pageRowsByNotebook.get(notebook.path);
                    const flatNodes = notebookRows?.flatNodes ?? [];
                    const nestingLookup = notebookRows?.nestingLookup ?? EMPTY_PAGE_NESTING_ACTION_LOOKUP;

                    return flatNodes.map((node) => {
                      const nestingState = getPageNestingActionState(nestingLookup, node.page.path);
                      const active = node.page.path === activePagePath;
                      const isInkPage = node.page.noteType === "ink";
                      const isJupyterPage = node.page.noteType === "jupyter";
                      const isLogPage = node.page.noteType === "log";
                      const isDesignPage = node.page.noteType === "design";
                      const isAppPage = node.page.noteType === "app";
                      const isSpreadsheetPage = node.page.noteType === "spreadsheet";
                      const isDragging = node.page.path === draggedPagePath;
                      const isNestTarget =
                        node.page.path === dragOverPagePath &&
                        dragIntent === "nest" &&
                        !isDragging &&
                        node.depth < 2;
                      const isNestBlocked =
                        node.page.path === dragOverPagePath &&
                        dragIntent === "nest" &&
                        !isDragging &&
                        node.depth >= 2;
                      const isReorderTarget =
                        node.page.path === dragOverPagePath &&
                        (dragIntent === "reorder" || dragIntent === "unnest") &&
                        !isDragging;
                      const indentPx = resolvePageIndent(notebookRootPageIndentBase, node.depth);

                      return (
                        <div
                          key={node.page.path}
                          className={cn(
                            "group relative flex items-center gap-1 rounded pr-1 transition",
                            compactDesktop ? "min-h-[var(--desktop-tree-page-row-height)] py-0" : "min-h-11 py-0.5",
                            active
                              ? "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/30 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                              : "hover:bg-surface/70",
                            isDragging && "opacity-40",
                            isNestTarget && "ring-1 ring-inset ring-accent bg-accent/5",
                            isNestBlocked && "ring-1 ring-inset ring-destructive/50",
                          )}
                          style={{ paddingLeft: indentPx }}
                          data-testid={`page-${node.page.path}`}
                          data-selected={active ? "true" : "false"}
                          aria-current={active ? "page" : undefined}
                          onClick={(event) => {
                            const target = event.target as HTMLElement;
                            if (target.closest("button[data-page-menu]")) return;
                            onOpenPage(node.page.path);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setGhostContextMenu(null);
                            setPageContextMenu({
                              pagePath: node.page.path,
                              pageTitle: node.page.title,
                              noteType: node.page.noteType,
                              keyNote: isPageKeyNote(node.page),
                              notebookPath: notebook.path,
                              notebookName: notebook.name,
                              sectionPath: null,
                              sectionName: null,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          draggable
                          onDragStart={(e) => {
                            dragStartXRef.current = e.clientX;
                            draggedPageSectionPathRef.current = notebook.path;
                            setDraggedPagePath(node.page.path);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            const source = draggedPagePath;
                            if (!source) return;
                            const delta = e.clientX - dragStartXRef.current;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const dropSide = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                            const sourceNesting = getPageNestingActionState(nestingLookup, source);
                            if (delta > 36) {
                              setDragIntent("nest");
                              setDragDropSide(null);
                            } else if (delta < -36 && sourceNesting.canOutdent) {
                              setDragIntent("unnest");
                              setDragDropSide(dropSide);
                            } else if (draggedPageSectionPathRef.current === notebook.path) {
                              setDragIntent("reorder");
                              setDragDropSide(dropSide);
                            } else {
                              setDragIntent(null);
                              setDragDropSide(null);
                            }
                            setDragOverPagePath(node.page.path);
                          }}
                          onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setDragOverPagePath(null);
                              setDragDropSide(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const source = draggedPagePath;
                            if (source && dragIntent && source !== node.page.path) {
                              const drop = resolveSidebarPageDrop({
                                intent: dragIntent,
                                sourcePath: source,
                                targetPath: node.page.path,
                                dropSide: dragDropSide,
                                pages: notebook.pages,
                                nestingLookup,
                              });
                              if (drop) {
                                void onApplyPageDrop(
                                  notebook.path,
                                  source,
                                  drop.parentId,
                                  drop.orderedIds
                                ).catch(() => {});
                              }
                            }
                            draggedPageSectionPathRef.current = null;
                            setDraggedPagePath(null);
                            setDragOverPagePath(null);
                            setDragIntent(null);
                            setDragDropSide(null);
                          }}
                          onDragEnd={() => {
                            draggedPageSectionPathRef.current = null;
                            setDraggedPagePath(null);
                            setDragOverPagePath(null);
                            setDragIntent(null);
                            setDragDropSide(null);
                          }}
                        >
                          {isReorderTarget && dragDropSide === "before" && (
                            <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-accent" />
                          )}
                          {isReorderTarget && dragDropSide === "after" && (
                            <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />
                          )}
                          <GripVertical
                            className="size-3 shrink-0 cursor-grab text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden
                          />
                          {node.children.length > 0 ? (
                            <button
                              type="button"
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              onClick={(event) => {
                                event.stopPropagation();
                                onTogglePage(node.page.path);
                              }}
                              aria-label={expandedPages.has(node.page.path) ? "Collapse" : "Expand"}
                            >
                              {expandedPages.has(node.page.path) ? (
                                <ChevronDown className="size-3" />
                              ) : (
                                <ChevronRight className="size-3" />
                              )}
                            </button>
                          ) : (
                            <span className="size-3 shrink-0" />
                          )}
                          <button
                            type="button"
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left",
                                  compactDesktop ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11"
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenPage(node.page.path);
                            }}
                          >
                            {isJupyterPage ? (
                              <span
                                className={cn(
                                  "inline-flex shrink-0 items-center justify-center rounded border border-border bg-secondary/70 text-primary",
                                  compactDesktop ? "size-4" : "size-5"
                                )}
                                aria-hidden
                              >
                                <NotebookPen className="size-3" />
                              </span>
                            ) : isLogPage ? (
                              <ClipboardList className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Log page" />
                            ) : isDesignPage ? (
                              <Palette className="size-3 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" aria-label="Design page" />
                            ) : isAppPage ? (
                              <AppWindow className="size-3 shrink-0 text-accent" aria-label="App page" />
                            ) : isSpreadsheetPage ? (
                              <Table2 className="size-3 shrink-0 text-chart-2" aria-label="Spreadsheet page" />
                            ) : isInkPage ? (
                              <PenLine className="size-3 shrink-0 text-indigo-400" aria-hidden />
                            ) : (
                              <FileText className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                            )}
                            {isPageKeyNote(node.page) ? (
                              <Gem
                                className="size-3 shrink-0 text-accent"
                                aria-label="Key note"
                                data-testid={`page-key-note-gem-${node.page.path}`}
                              />
                            ) : null}
                            <p
                              className={cn(
                                "truncate font-medium",
                                compactDesktop ? "text-[13px]" : "text-sm",
                                isInkPage && "text-indigo-600 dark:text-indigo-400",
                                isLogPage && "text-emerald-700 dark:text-emerald-300",
                                isDesignPage && "text-fuchsia-700 dark:text-fuchsia-300",
                                isAppPage && "text-accent",
                                isSpreadsheetPage && "text-chart-2"
                              )}
                            >
                              {node.page.title}
                            </p>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              data-page-menu="true"
                              className={cn(
                                "inline-flex shrink-0 items-center justify-center rounded opacity-70 transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11"
                              )}
                              data-testid={`page-menu-${node.page.path}`}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                data-testid={`page-create-child-${node.page.path}`}
                                onClick={() =>
                                  onCreatePage({
                                    notebookPath: notebook.path,
                                    notebookName: notebook.name,
                                    sectionPath: null,
                                    sectionName: null,
                                    parentId: node.page.path,
                                    targetLabel: node.page.title,
                                  })
                                }
                              >
                                New child page
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`page-create-child-jupyter-${node.page.path}`}
                                onClick={() =>
                                  onCreateJupyterNotebook({
                                    notebookPath: notebook.path,
                                    notebookName: notebook.name,
                                    sectionPath: null,
                                    sectionName: null,
                                    parentId: node.page.path,
                                    targetLabel: node.page.title,
                                  })
                                }
                              >
                                New child Jupyter notebook
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`page-indent-${node.page.path}`}
                                disabled={!nestingState.canIndent}
                                onClick={() => {
                                  if (!nestingState.indentParentId) return;
                                  void onNestPage(node.page.path, nestingState.indentParentId).catch(() => {});
                                }}
                              >
                                Indent
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`page-outdent-${node.page.path}`}
                                disabled={!nestingState.canOutdent}
                                onClick={() => {
                                  void onNestPage(node.page.path, nestingState.outdentParentId).catch(() => {});
                                }}
                              >
                                Outdent
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                data-testid={`page-export-${node.page.path}`}
                                disabled={activePagePath !== node.page.path || node.page.noteType !== "text"}
                                onClick={onExportPage}
                              >
                                Export HTML
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`page-export-docx-${node.page.path}`}
                                disabled={activePagePath !== node.page.path || node.page.noteType !== "text"}
                                onClick={onExportDocxPage}
                              >
                                <FileDown className="mr-2 size-3.5" />
                                {node.page.noteType !== "text" ? "Export DOCX (text only)" : "Export DOCX"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`page-view-versions-${node.page.path}`}
                                disabled={node.page.noteType === "jupyter"}
                                onClick={() => onTogglePageVersions(node.page.path)}
                              >
                                {node.page.noteType === "jupyter"
                                  ? "Versions unavailable"
                                  : getVersionsControlLabel(node.page.path, ghostVersions)}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-testid={`page-key-note-${node.page.path}`}
                                onClick={() => {
                                  void onSetPageKeyNote(node.page.path, !isPageKeyNote(node.page));
                                }}
                              >
                                {keyNoteMenuLabel(isPageKeyNote(node.page))}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onRenamePage(node.page.path, node.page.title)}>
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => onDeletePage(node.page.path, node.page.title)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    });
                  })()}

                  {notebook.sections.map((section) => {
                    const sectionOpen = expandedSections.has(section.path);
                    const sectionActive = section.path === activeSectionPath;

                    return (
                      <div key={section.path} data-testid={`section-${section.path}`}>
                        <div
                          className={cn(
                            "flex items-center rounded transition",
                            compactDesktop ? "min-h-[var(--desktop-tree-section-row-height)] gap-1 px-1.5 py-0.5" : "gap-1.5 px-1.5 py-1",
                            sectionActive ? "bg-surface/80" : "hover:bg-surface/70"
                          )}
                        >
                          <button
                            type="button"
                            className={cn("flex min-w-0 flex-1 items-center text-left", compactDesktop ? "gap-1.5" : "gap-2")}
                            onClick={() => {
                              onSelectSection(section.path);
                              onToggleSection(section.path);
                            }}
                          >
                            {sectionOpen ? (
                              <ChevronDown className={cn("text-muted-foreground", compactDesktop ? "size-3" : "size-3.5")} />
                            ) : (
                              <ChevronRight className={cn("text-muted-foreground", compactDesktop ? "size-3" : "size-3.5")} />
                            )}
                            {section.name === "Inbox" ? (
                              <Inbox className={cn("text-accent", compactDesktop ? "size-3" : "size-3.5")} />
                            ) : null}
                            <span className={cn("truncate text-foreground", compactDesktop ? "text-[13px]" : "text-sm")}>{section.name}</span>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className={cn(
                                "inline-flex shrink-0 items-center justify-center rounded opacity-80 transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11"
                              )}
                              data-testid={`section-menu-${section.path}`}
                            >
                              <MoreHorizontal className="size-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => onCreatePage({
                                  notebookPath: notebook.path,
                                  notebookName: notebook.name,
                                  sectionPath: section.path,
                                  sectionName: section.name,
                                  parentId: null,
                                  targetLabel: section.name,
                                })}
                              >
                                New page
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onCreateJupyterNotebook({
                                  notebookPath: notebook.path,
                                  notebookName: notebook.name,
                                  sectionPath: section.path,
                                  sectionName: section.name,
                                  parentId: null,
                                  targetLabel: section.name,
                                })}
                                data-testid={`section-create-jupyter-${section.path}`}
                              >
                                New Jupyter notebook
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onCreateLogPage({
                                  notebookPath: notebook.path,
                                  notebookName: notebook.name,
                                  sectionPath: section.path,
                                  sectionName: section.name,
                                  parentId: null,
                                  targetLabel: section.name,
                                })}
                                data-testid={`section-create-log-${section.path}`}
                              >
                                New log
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onCreateDesignPage({
                                  notebookPath: notebook.path,
                                  notebookName: notebook.name,
                                  sectionPath: section.path,
                                  sectionName: section.name,
                                  parentId: null,
                                  targetLabel: section.name,
                                })}
                                data-testid={`section-create-design-${section.path}`}
                              >
                                New design page
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onCreateSpreadsheetPage({
                                  notebookPath: notebook.path,
                                  notebookName: notebook.name,
                                  sectionPath: section.path,
                                  sectionName: section.name,
                                  targetLabel: section.name,
                                })}
                                data-testid={`section-create-spreadsheet-${section.path}`}
                              >
                                <Table2 className="mr-2 size-3.5 text-chart-2" />
                                New spreadsheet
                              </DropdownMenuItem>
                              {notebook.isPortable ? (
                                <DropdownMenuItem
                                  onClick={() => onLinkDesign(notebook.rootPath)}
                                  data-testid={`section-link-design-${section.path}`}
                                >
                                  <Link2 className="mr-2 size-3.5" />
                                  Link design…
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                onClick={() => onImportDocx(section.path)}
                                data-testid={`section-import-docx-${section.path}`}
                              >
                                <FileUp className="mr-2 size-3.5" />
                                Import DOCX
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onRenameSection(section.path, section.name, notebook.path)}>
                                Rename section
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => onDeleteSection(section.path, section.name)}
                              >
                                Delete section
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {sectionOpen ? (
                          <div className={cn("mt-1 space-y-0.5", compactDesktop && "mt-0.5")}>
                            {(() => {
                              const sectionRows = pageRowsBySection.get(section.path);
                              const flatNodes = sectionRows?.flatNodes ?? [];
                              const nestingLookup = sectionRows?.nestingLookup ?? EMPTY_PAGE_NESTING_ACTION_LOOKUP;

                              if (!flatNodes.length) {
                                return (
                                  <div className="ml-5 space-y-2 rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                                    <p>No pages yet</p>
                                    {notebook.isPortable ? (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 rounded-sm text-foreground/80 underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        data-testid={`section-empty-link-design-${section.path}`}
                                        onClick={() => onLinkDesign(notebook.rootPath)}
                                      >
                                        <Link2 className="size-3.5" />
                                        Link an existing HTML design…
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              }

                              return flatNodes.flatMap((node) => {
                                const nestingState = getPageNestingActionState(nestingLookup, node.page.path);
                                const active = node.page.path === activePagePath;
                                const isInkPage = node.page.noteType === "ink";
                                const isJupyterPage = node.page.noteType === "jupyter";
                                const isLogPage = node.page.noteType === "log";
                                const isDesignPage = node.page.noteType === "design";
                                const isAppPage = node.page.noteType === "app";
                                const isSpreadsheetPage = node.page.noteType === "spreadsheet";
                                const isDragging = node.page.path === draggedPagePath;
                                const isNestTarget =
                                  node.page.path === dragOverPagePath &&
                                  dragIntent === "nest" &&
                                  !isDragging &&
                                  node.depth < 2;
                                const isNestBlocked =
                                  node.page.path === dragOverPagePath &&
                                  dragIntent === "nest" &&
                                  !isDragging &&
                                  node.depth >= 2;
                                const isReorderTarget =
                                  node.page.path === dragOverPagePath &&
                                  (dragIntent === "reorder" || dragIntent === "unnest") &&
                                  !isDragging;
                                const indentPx = resolvePageIndent(sectionPageIndentBase, node.depth);
                                const visibleGhosts =
                                  ghostVersions?.parentPagePath === node.page.path ? ghostVersions.versions : [];

                                const pageRow = (
                                  <div
                                    key={node.page.path}
                                    className={cn(
                                      "group relative flex items-center gap-1 rounded pr-1 transition",
                                      compactDesktop ? "min-h-[var(--desktop-tree-page-row-height)] py-0" : "min-h-11 py-0.5",
                                      active
                                        ? "bg-accent/10 text-foreground ring-1 ring-inset ring-accent/30 before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                                        : "hover:bg-surface/70",
                                      isDragging && "opacity-40",
                                      isNestTarget && "ring-1 ring-inset ring-accent bg-accent/5",
                                      isNestBlocked && "ring-1 ring-inset ring-destructive/50",
                                    )}
                                    style={{ paddingLeft: indentPx }}
                                    data-testid={`page-${node.page.path}`}
                                    data-selected={active ? "true" : "false"}
                                    aria-current={active ? "page" : undefined}
                                    onClick={(event) => {
                                      const target = event.target as HTMLElement;
                                      if (target.closest("button[data-page-menu]")) return;
                                      onOpenPage(node.page.path);
                                    }}
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      setGhostContextMenu(null);
                                      setPageContextMenu({
                                        pagePath: node.page.path,
                                        pageTitle: node.page.title,
                                        noteType: node.page.noteType,
                                        keyNote: isPageKeyNote(node.page),
                                        notebookPath: notebook.path,
                                        notebookName: notebook.name,
                                        sectionPath: section.path,
                                        sectionName: section.name,
                                        x: event.clientX,
                                        y: event.clientY,
                                      });
                                    }}
                                    draggable
                                    onDragStart={(e) => {
                                      dragStartXRef.current = e.clientX;
                                      draggedPageSectionPathRef.current = section.path;
                                      setDraggedPagePath(node.page.path);
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      const source = draggedPagePath;
                                      if (!source) return;
                                      const delta = e.clientX - dragStartXRef.current;
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const dropSide = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                                      const sourceNesting = getPageNestingActionState(nestingLookup, source);
                                      if (delta > 36) {
                                        setDragIntent("nest");
                                        setDragDropSide(null);
                                      } else if (delta < -36 && sourceNesting.canOutdent) {
                                        setDragIntent("unnest");
                                        setDragDropSide(dropSide);
                                      } else if (draggedPageSectionPathRef.current === section.path) {
                                        setDragIntent("reorder");
                                        setDragDropSide(dropSide);
                                      } else {
                                        setDragIntent(null);
                                        setDragDropSide(null);
                                      }
                                      setDragOverPagePath(node.page.path);
                                    }}
                                    onDragLeave={(e) => {
                                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                        setDragOverPagePath(null);
                                        setDragDropSide(null);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const source = draggedPagePath;
                                      if (source && dragIntent && source !== node.page.path) {
                                        const drop = resolveSidebarPageDrop({
                                          intent: dragIntent,
                                          sourcePath: source,
                                          targetPath: node.page.path,
                                          dropSide: dragDropSide,
                                          pages: section.pages,
                                          nestingLookup,
                                        });
                                        if (drop) {
                                          void onApplyPageDrop(
                                            section.path,
                                            source,
                                            drop.parentId,
                                            drop.orderedIds
                                          ).catch(() => {});
                                        }
                                      }
                                      draggedPageSectionPathRef.current = null;
                                      setDraggedPagePath(null);
                                      setDragOverPagePath(null);
                                      setDragIntent(null);
                                      setDragDropSide(null);
                                    }}
                                    onDragEnd={() => {
                                      draggedPageSectionPathRef.current = null;
                                      setDraggedPagePath(null);
                                      setDragOverPagePath(null);
                                      setDragIntent(null);
                                      setDragDropSide(null);
                                    }}
                                  >
                                    {isReorderTarget && dragDropSide === "before" && (
                                      <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded-full bg-accent" />
                                    )}
                                    {isReorderTarget && dragDropSide === "after" && (
                                      <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />
                                    )}
                                    <GripVertical
                                      className="size-3 shrink-0 cursor-grab text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
                                      aria-hidden
                                    />
                                    {node.children.length > 0 ? (
                                      <button
                                        type="button"
                                        className="shrink-0 text-muted-foreground hover:text-foreground"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onTogglePage(node.page.path);
                                        }}
                                        aria-label={expandedPages.has(node.page.path) ? "Collapse" : "Expand"}
                                      >
                                        {expandedPages.has(node.page.path) ? (
                                          <ChevronDown className="size-3" />
                                        ) : (
                                          <ChevronRight className="size-3" />
                                        )}
                                      </button>
                                    ) : (
                                      <span className="size-3 shrink-0" />
                                    )}
                                    <button
                                      type="button"
                                      className={cn(
                                        "flex min-w-0 flex-1 items-center gap-1.5 px-1 text-left",
                                            compactDesktop ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11"
                                      )}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onOpenPage(node.page.path);
                                      }}
                                    >
                                      {isJupyterPage ? (
                                        <span
                                          className={cn(
                                            "inline-flex shrink-0 items-center justify-center rounded border border-border bg-secondary/70 text-primary",
                                            compactDesktop ? "size-4" : "size-5"
                                          )}
                                          aria-hidden
                                        >
                                          <NotebookPen className="size-3" />
                                        </span>
                                      ) : isLogPage ? (
                                        <ClipboardList className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Log page" />
                                      ) : isDesignPage ? (
                                        <Palette className="size-3 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" aria-label="Design page" />
                                      ) : isAppPage ? (
                                        <AppWindow className="size-3 shrink-0 text-accent" aria-label="App page" />
                                      ) : isSpreadsheetPage ? (
                                        <Table2 className="size-3 shrink-0 text-chart-2" aria-label="Spreadsheet page" />
                                      ) : isInkPage ? (
                                        <PenLine className="size-3 shrink-0 text-indigo-400" aria-hidden />
                                      ) : (
                                        <FileText className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                                      )}
                                      {isPageKeyNote(node.page) ? (
                                        <Gem
                                          className="size-3 shrink-0 text-accent"
                                          aria-label="Key note"
                                          data-testid={`page-key-note-gem-${node.page.path}`}
                                        />
                                      ) : null}
                                      <p className={cn(
                                        "truncate font-medium",
                                        compactDesktop ? "text-[13px]" : "text-sm",
                                        isInkPage && "text-indigo-600 dark:text-indigo-400",
                                        isLogPage && "text-emerald-700 dark:text-emerald-300",
                                        isDesignPage && "text-fuchsia-700 dark:text-fuchsia-300",
                                        isAppPage && "text-accent",
                                        isSpreadsheetPage && "text-chart-2",
                                      )}>{node.page.title}</p>
                                    </button>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        data-page-menu="true"
                                        className={cn(
                                          "inline-flex shrink-0 items-center justify-center rounded opacity-70 transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                          compactDesktop ? "size-[var(--desktop-tree-affordance-size)]" : "size-11"
                                        )}
                                        data-testid={`page-menu-${node.page.path}`}
                                      >
                                        <MoreHorizontal className="size-3.5" />
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          data-testid={`page-create-child-${node.page.path}`}
                                          onClick={() =>
                                            onCreatePage({
                                              notebookPath: notebook.path,
                                              notebookName: notebook.name,
                                              sectionPath: section.path,
                                              sectionName: section.name,
                                              parentId: node.page.path,
                                              targetLabel: node.page.title,
                                            })
                                          }
                                        >
                                          New child page
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`page-create-child-jupyter-${node.page.path}`}
                                          onClick={() =>
                                            onCreateJupyterNotebook({
                                              notebookPath: notebook.path,
                                              notebookName: notebook.name,
                                              sectionPath: section.path,
                                              sectionName: section.name,
                                              parentId: node.page.path,
                                              targetLabel: node.page.title,
                                            })
                                          }
                                        >
                                          New child Jupyter notebook
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          data-testid={`page-indent-${node.page.path}`}
                                          disabled={!nestingState.canIndent}
                                          onClick={() => {
                                            if (!nestingState.indentParentId) return;
                                            void onNestPage(node.page.path, nestingState.indentParentId).catch(() => {});
                                          }}
                                        >
                                          Indent
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`page-outdent-${node.page.path}`}
                                          disabled={!nestingState.canOutdent}
                                          onClick={() => {
                                            void onNestPage(node.page.path, nestingState.outdentParentId).catch(() => {});
                                          }}
                                        >
                                          Outdent
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          data-testid={`page-export-${node.page.path}`}
                                          disabled={
                                            activePagePath !== node.page.path ||
                                            node.page.noteType !== "text"
                                          }
                                          onClick={onExportPage}
                                        >
                                          Export HTML
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`page-export-docx-${node.page.path}`}
                                          disabled={
                                            activePagePath !== node.page.path ||
                                            node.page.noteType !== "text"
                                          }
                                          onClick={onExportDocxPage}
                                        >
                                          <FileDown className="mr-2 size-3.5" />
                                          {node.page.noteType !== "text" ? "Export DOCX (text only)" : "Export DOCX"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`page-view-versions-${node.page.path}`}
                                          disabled={node.page.noteType === "jupyter"}
                                          onClick={() => onTogglePageVersions(node.page.path)}
                                        >
                                          {node.page.noteType === "jupyter"
                                            ? "Versions unavailable"
                                            : getVersionsControlLabel(node.page.path, ghostVersions)}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          data-testid={`page-key-note-${node.page.path}`}
                                          onClick={() => {
                                            void onSetPageKeyNote(node.page.path, !isPageKeyNote(node.page));
                                          }}
                                        >
                                          {keyNoteMenuLabel(isPageKeyNote(node.page))}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => onRenamePage(node.page.path, node.page.title)}>
                                          Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => onMovePage(node.page.path, node.page.title, section.path)}
                                        >
                                          Move
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => onDeletePage(node.page.path, node.page.title)}
                                        >
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                );

                                const ghostRows = visibleGhosts.map((version) => {
                                  const ghostIndentPx = resolveGhostIndent(sectionPageIndentBase, node.depth);
                                  const isPreviewing = previewedVersionId === version.id;
                                  return (
                                    <div
                                      key={`${node.page.path}::${version.id}`}
                                      className={cn(
                                        "group flex items-center gap-1 rounded pr-1 transition-opacity duration-300",
                                        compactDesktop ? "py-0.5" : "py-1",
                                        ghostVersions?.dismissing ? "opacity-0" : "opacity-70",
                                        isPreviewing
                                          ? "bg-accent/10 ring-1 ring-inset ring-accent/40 opacity-100"
                                          : "text-muted-foreground hover:bg-surface/50"
                                      )}
                                      style={{ paddingLeft: ghostIndentPx }}
                                      data-testid={`ghost-version-${node.page.path}-${version.id}`}
                                      onContextMenu={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setPageContextMenu(null);
                                        setGhostContextMenu({
                                          parentPagePath: node.page.path,
                                          versionId: version.id,
                                          x: event.clientX,
                                          y: event.clientY,
                                        });
                                      }}
                                    >
                                      <span className="size-3 shrink-0" />
                                      <button
                                        type="button"
                                        className={cn("flex min-w-0 flex-1 items-center text-left", compactDesktop ? "gap-1" : "gap-1.5")}
                                        onClick={() =>
                                          onPreviewGhostVersion(node.page.path, version.id, version.ts)
                                        }
                                      >
                                        <Lock className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                                        <p className="truncate text-xs font-medium italic">
                                          {formatVersionLabel(version.ts)}
                                        </p>
                                      </button>
                                    </div>
                                  );
                                });

                                return [pageRow, ...ghostRows];
                              });
                            })()}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {!notebook.sections.length ? (
                    <div className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                      No sections yet
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {visibleNotebooks.length === 0 ? (
          <div className="rounded border border-dashed border-border bg-background/60 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="notebook-tree-empty">
            {closedNotebooks.size > 0
              ? "All notebooks are closed"
              : archivedNotebooks.size > 0
                ? "All notebooks are archived"
                : "No notebooks yet"}
          </div>
        ) : null}
      </div>

      {pageContextMenu ? (
        <div
          className="fixed z-50 min-w-[12rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ top: pageContextMenu.y, left: pageContextMenu.x }}
          onClick={(event) => event.stopPropagation()}
          data-testid={`page-context-menu-${pageContextMenu.pagePath}`}
        >
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              void onDirectCreatePage({
                notebookPath: pageContextMenu.notebookPath,
                notebookName: pageContextMenu.notebookName,
                sectionPath: pageContextMenu.sectionPath ?? null,
                sectionName: pageContextMenu.sectionName ?? null,
                parentId: pageContextMenu.pagePath,
                targetLabel: pageContextMenu.pageTitle,
              });
            }}
            data-testid={`page-context-create-${pageContextMenu.pagePath}`}
          >
            New child page
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              onCreateJupyterNotebook({
                notebookPath: pageContextMenu.notebookPath,
                notebookName: pageContextMenu.notebookName,
                sectionPath: pageContextMenu.sectionPath ?? null,
                sectionName: pageContextMenu.sectionName ?? null,
                parentId: pageContextMenu.pagePath,
                targetLabel: pageContextMenu.pageTitle,
              });
            }}
            data-testid={`page-context-create-jupyter-${pageContextMenu.pagePath}`}
          >
            New child Jupyter notebook
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              onCreateLogPage({
                notebookPath: pageContextMenu.notebookPath,
                notebookName: pageContextMenu.notebookName,
                sectionPath: pageContextMenu.sectionPath ?? null,
                sectionName: pageContextMenu.sectionName ?? null,
                parentId: pageContextMenu.pagePath,
                targetLabel: pageContextMenu.pageTitle,
              });
            }}
            data-testid={`page-context-create-log-${pageContextMenu.pagePath}`}
          >
            New child log
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              onCreateSpreadsheetPage({
                notebookPath: pageContextMenu.notebookPath,
                notebookName: pageContextMenu.notebookName,
                sectionPath: pageContextMenu.sectionPath ?? null,
                sectionName: pageContextMenu.sectionName ?? null,
                parentId: pageContextMenu.pagePath,
                targetLabel: pageContextMenu.pageTitle,
              });
            }}
            data-testid={`page-context-create-spreadsheet-${pageContextMenu.pagePath}`}
          >
            New child spreadsheet
          </button>
          <div className="my-1 h-px bg-border" role="separator" />
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm",
              pageContextMenu.noteType === "jupyter"
                ? "cursor-not-allowed text-muted-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
            onClick={() => {
              if (pageContextMenu.noteType === "jupyter") return;
              onTogglePageVersions(pageContextMenu.pagePath);
            }}
            disabled={pageContextMenu.noteType === "jupyter"}
          >
            {pageContextMenu.noteType === "jupyter"
              ? "Versions unavailable"
              : getVersionsControlLabel(pageContextMenu.pagePath, ghostVersions)}
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              void onSetPageKeyNote(pageContextMenu.pagePath, !pageContextMenu.keyNote);
            }}
            data-testid={`page-context-key-note-${pageContextMenu.pagePath}`}
          >
            {keyNoteMenuLabel(pageContextMenu.keyNote)}
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              onTogglePinnedPage(pageContextMenu.pagePath);
            }}
            data-testid={`page-context-pin-${pageContextMenu.pagePath}`}
          >
            {pinnedPages.has(pageContextMenu.pagePath) ? (
              <PinOff className="mr-2 size-3.5" />
            ) : (
              <Pin className="mr-2 size-3.5" />
            )}
            {pinnedPages.has(pageContextMenu.pagePath) ? "Unpin page" : "Pin page"}
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setPageContextMenu(null);
              onRenamePage(pageContextMenu.pagePath, pageContextMenu.pageTitle);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className={cn(
              "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm",
              pageContextMenu.sectionPath
                ? "hover:bg-accent hover:text-accent-foreground"
                : "cursor-not-allowed text-muted-foreground"
            )}
            disabled={!pageContextMenu.sectionPath}
            onClick={() => {
              if (!pageContextMenu.sectionPath) return;
              setPageContextMenu(null);
              onMovePage(pageContextMenu.pagePath, pageContextMenu.pageTitle, pageContextMenu.sectionPath);
            }}
          >
            Move
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={() => {
              setPageContextMenu(null);
              onDeletePage(pageContextMenu.pagePath, pageContextMenu.pageTitle);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      {ghostContextMenu ? (
        <div
          className="fixed z-50 min-w-[12rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{ top: ghostContextMenu.y, left: ghostContextMenu.x }}
          onClick={(event) => event.stopPropagation()}
          data-testid={`ghost-context-menu-${ghostContextMenu.versionId}`}
        >
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => onRestoreGhostVersion(ghostContextMenu.parentPagePath, ghostContextMenu.versionId)}
          >
            Restore this version
          </button>
          <button
            type="button"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setGhostContextMenu(null);
              onDismissGhostVersions();
            }}
          >
            Dismiss versions
          </button>
        </div>
      ) : null}
    </div>
  );
});

Sidebar.displayName = "Sidebar";

function extractComments(metadata: Record<string, unknown>): PageComment[] {
  const raw = metadata.comments;
  if (!Array.isArray(raw)) return [];
  return raw as PageComment[];
}

function VersionPreviewBanner({
  versionTs,
  onExit,
}: {
  versionTs: string;
  onExit: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2 text-sm md:px-6"
      data-testid="version-preview-banner"
    >
      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-muted-foreground">
        Viewing read-only snapshot from {formatVersionLabel(versionTs)}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto shrink-0"
        onClick={onExit}
        data-testid="version-preview-exit"
      >
        Back to current
      </Button>
    </div>
  );
}

/**
 * AC8 (SN-84): Visible banner that appears when the active page has been
 * changed on disk by an external API write (e.g. companion page_write).
 * Distinct from the subtle toolbar dot — this bar is hard to miss.
 */
function PageChangedBanner({ onReload }: { onReload: () => void }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-sm md:px-6"
      data-testid="page-changed-banner"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-accent">
        Page updated externally — click Reload to view the latest content in the editor.
      </span>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="ml-auto shrink-0 bg-accent text-accent-foreground hover:bg-accent/90"
        onClick={onReload}
        data-testid="page-changed-reload-btn"
      >
        Reload
      </Button>
    </div>
  );
}

function EditorPanel({
  draft,
  editorRef,
  annotationLayerRef,
  readOnly = false,
  previewContent,
  previewAnnotationsJson,
  onTitleChange,
  onContentChange,
  onSelectionContextChange,
  onPdfAttachmentOpen,
  onAnnotationSaveStatusChange,
  onCommentsChange,
}: {
  draft: PageDraft;
  editorRef: React.RefObject<RichTextEditorHandle | null>;
  annotationLayerRef: React.RefObject<AnnotationLayerHandle | null>;
  readOnly?: boolean;
  previewContent?: string;
  previewAnnotationsJson?: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onSelectionContextChange: (context: EditorSectionContext | null) => void;
  onPdfAttachmentOpen?: (target: PdfAttachmentTarget) => void;
  onAnnotationSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  onCommentsChange?: (comments: PageComment[]) => void;
}) {
  const [annotationMode, setAnnotationMode] = React.useState<"edit" | "draw">("edit");
  const [annotationHistory, setAnnotationHistory] = React.useState({
    canUndo: false,
    canRedo: false,
  });
  const [annotationScene, setAnnotationScene] = React.useState<unknown | null>(null);
  const [drawableBottom, setDrawableBottom] = React.useState<number | undefined>(undefined);
  const [inkTool, setInkTool] = React.useState<AnnotationTool>("draw");
  const [inkColor, setInkColor] = React.useState<TLDefaultColorStyle>("black");
  const [inkStroke, setInkStroke] = React.useState<AnnotationStrokeSize>("m");
  const [localPdfReader, setLocalPdfReader] = React.useState<PdfAttachmentTarget | null>(null);
  const isDrawMode = annotationMode === "draw" && !readOnly;
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const displayedPathRef = React.useRef(draft.path);

  React.useEffect(() => {
    setAnnotationMode("edit");
    setAnnotationScene(null);
    setDrawableBottom(undefined);
    setInkTool("draw");
    setInkColor("black");
    setInkStroke("m");
  }, [draft.path]);

  React.useEffect(() => {
    if (previewAnnotationsJson !== undefined) return;
    const cached = pageContentCache.get(draft.path);
    if (cached?.drawableBottom != null) {
      setDrawableBottom(cached.drawableBottom);
    }
    void fetchAnnotationsScene(draft.path)
      .then(({ drawableBottom: nextDrawableBottom }) => {
        if (nextDrawableBottom != null) {
          setDrawableBottom(nextDrawableBottom);
        }
      })
      .catch(() => undefined);
  }, [draft.path, previewAnnotationsJson]);

  const handleDrawableBottomChange = React.useCallback((value: number) => {
    setDrawableBottom((current) => (current === value ? current : value));
  }, []);

  const openPdfReader = React.useCallback(
    (target: PdfAttachmentTarget) => {
      if (onPdfAttachmentOpen) {
        onPdfAttachmentOpen(target);
        return;
      }
      setLocalPdfReader(target);
    },
    [onPdfAttachmentOpen]
  );

  const handlePdfAttachmentOpenCapture = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
      if (readOnly || isDrawMode) return;
      const target = resolvePdfAttachmentTarget(
        event.target instanceof Element ? event.target : null
      );
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openPdfReader(target);
    },
    [isDrawMode, openPdfReader, readOnly]
  );

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel || readOnly) return;

    const openPdfAttachment = (event: MouseEvent | PointerEvent) => {
      if (isDrawMode) return;
      if (!(event.target instanceof Node) || !panel.contains(event.target)) return;
      const target = resolvePdfAttachmentTarget(
        event.target instanceof Element ? event.target : null
      );
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      openPdfReader(target);
    };

    document.addEventListener("pointerdown", openPdfAttachment, true);
    document.addEventListener("click", openPdfAttachment, true);
    return () => {
      document.removeEventListener("pointerdown", openPdfAttachment, true);
      document.removeEventListener("click", openPdfAttachment, true);
    };
  }, [isDrawMode, openPdfReader, readOnly]);

  const handleAnnotationModeChange = React.useCallback(
    async (nextMode: "edit" | "draw") => {
      if (annotationMode === "draw" && nextMode === "edit") {
        try {
          const layerRef = annotationLayerRef;
          if (layerRef && typeof layerRef !== "function" && layerRef.current) {
            await layerRef.current.flush();
          }
        } catch {
          // keep in-memory ink visible even if flush fails
        }
      }
      setAnnotationMode(nextMode);
    },
    [annotationLayerRef, annotationMode]
  );

  const effectiveContent = React.useMemo(
    () => buildEffectiveEditorHtml(draft, previewContent),
    [draft, previewContent]
  );

  const initialComments = React.useMemo(
    () => extractComments(draft.metadata),
    // Re-derive only when the page changes (key) or metadata.comments reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.path, draft.metadata]
  );

  React.useLayoutEffect(() => {
    if (previewContent !== undefined || previewAnnotationsJson !== undefined) {
      displayedPathRef.current = draft.path;
      return;
    }

    if (draft.path === displayedPathRef.current) {
      return;
    }

    const previousPath = displayedPathRef.current;
    displayedPathRef.current = draft.path;

    if (previousPath && previousPath !== draft.path) {
      void annotationLayerRef.current?.flush().catch(() => undefined);
    }

    const swapPlan = planPageSwap(draft, pageContentCache.get(draft.path), previewContent);
    editorRef.current?.swapContent(swapPlan.html);
  }, [annotationLayerRef, draft, editorRef, previewAnnotationsJson, previewContent]);

  function handleContentChange(content: string) {
    if (readOnly) return;
    const match = content.match(/<h1[^>]*>(.*?)<\/h1>/is);
    if (match?.[1]) {
      const title = match[1].replace(/<[^>]+>/g, "").trim();
      if (title) onTitleChange(title);
    }
    onContentChange(content);
  }

  return (
    <div
      ref={panelRef}
      className="relative flex h-full min-h-0 flex-col px-0 py-2 md:px-8 md:py-3 xl:px-6 xl:py-2"
      data-testid="annotated-editor-panel"
      onClickCapture={handlePdfAttachmentOpenCapture}
      onPointerDownCapture={handlePdfAttachmentOpenCapture}
    >
      <RichTextEditor
        ref={editorRef as React.Ref<RichTextEditorHandle>}
        content={effectiveContent}
        pagePath={draft.path}
        readOnly={readOnly}
        annotationMode={readOnly ? "edit" : annotationMode}
        onAnnotationModeChange={handleAnnotationModeChange}
        annotationLayerRef={
          annotationLayerRef
        }
        annotationHistory={annotationHistory}
        annotationScene={annotationScene}
        inkTool={inkTool}
        inkColor={inkColor}
        inkStroke={inkStroke}
        onInkToolChange={setInkTool}
        onInkColorChange={setInkColor}
        onInkStrokeChange={setInkStroke}
        annotationOverlay={
          <AnnotationLayer
            handleRef={annotationLayerRef}
            pagePath={draft.path}
            mode={readOnly ? "edit" : annotationMode}
            readOnly={readOnly}
            previewSidecarJson={previewAnnotationsJson}
            onSaveStatusChange={onAnnotationSaveStatusChange}
            onHistoryChange={setAnnotationHistory}
            onSceneChange={setAnnotationScene}
            inkColor={inkColor}
            inkStroke={inkStroke}
            inkTool={inkTool}
          />
        }
        onChange={handleContentChange}
        onSelectionContextChange={onSelectionContextChange}
        placeholder="Start writing..."
        pageTitle={draft.title}
        drawableBottom={drawableBottom}
        onDrawableBottomChange={handleDrawableBottomChange}
        onPdfAttachmentOpen={openPdfReader}
        className="min-h-0 flex-1"
        initialComments={readOnly ? [] : initialComments}
        onCommentsChange={readOnly ? undefined : onCommentsChange}
      />
      {localPdfReader ? (
        <ImmersivePdfReader
          key={localPdfReader.href}
          href={localPdfReader.href}
          fileName={localPdfReader.fileName}
          onClose={() => setLocalPdfReader(null)}
        />
      ) : null}
    </div>
  );
}

function EmptyState({
  activeNotebook,
  activeSection,
  onCreateNotebook,
  onCreatePage,
  onOpenCapture,
}: {
  activeNotebook: VaultNotebook | null;
  activeSection: VaultSection | null;
  onCreateNotebook: () => void;
  onCreatePage: () => void;
  onOpenCapture: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-lg rounded border border-border bg-background/80 p-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {activeSection ? "Section ready" : activeNotebook ? "Notebook ready" : "Vault empty"}
        </p>
        <p className="mt-2 font-serif text-3xl">
          {activeSection ? `No pages in ${activeSection.name}` : activeNotebook ? `No section selected in ${activeNotebook.name}` : "Start with a notebook"}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {activeSection
            ? "Create a page in this real vault section, or capture text directly to Inbox."
            : activeNotebook
              ? "Add a section, or use capture to let Inbox be created and selected for you."
              : "Create a notebook to establish the vault hierarchy, then add sections and pages."}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={activeSection ? onCreatePage : onCreateNotebook}>
            {activeSection ? (
              <>
                <Plus className="size-4" />
                New page
              </>
            ) : (
              <>
                <FolderPlus className="size-4" />
                New notebook
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onOpenCapture}>
            <Inbox className="size-4" />
            Capture to Inbox
          </Button>
        </div>
      </div>
    </div>
  );
}

function apiDocumentToVaultPage(page: ApiPageDocument): VaultPage {
  return {
    id: page.path,
    path: page.path,
    title: page.title,
    slug: page.slug,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    preview: page.preview,
    content: page.content,
    hasFrontmatterError: page.hasFrontmatterError,
    parentId: page.parentId,
    noteType: page.noteType,
    keyNote: isPageKeyNote(page),
    metadata: page.metadata,
    designLinked: page.designLinked,
    sourceMissing: page.sourceMissing,
  };
}

function appendPageToTree(
  tree: VaultNotebook[],
  apiPage: ApiPageDocument,
  page: VaultPage
): VaultNotebook[] {
  return tree.map((notebook) => {
    if (notebook.path !== apiPage.notebookPath) {
      return notebook;
    }

    if (!apiPage.sectionPath) {
      if (notebook.pages.some((existing) => existing.path === page.path)) {
        return notebook;
      }
      return { ...notebook, pages: [...notebook.pages, page] };
    }

    return {
      ...notebook,
      sections: notebook.sections.map((section) => {
        if (section.path !== apiPage.sectionPath) {
          return section;
        }

        if (section.pages.some((existing) => existing.path === page.path)) {
          return section;
        }

        return {
          ...section,
          pages: [...section.pages, page],
        };
      }),
    };
  });
}

function resolveCreateTargetFromSelection(selection: TreeSelection): CreatePageTarget | null {
  if (!selection.notebook) {
    return null;
  }

  if (selection.page) {
    return {
      notebookPath: selection.notebook.path,
      notebookName: selection.notebook.name,
      sectionPath: selection.section?.path ?? null,
      sectionName: selection.section?.name ?? null,
      parentId: selection.page.path,
      targetLabel: selection.page.title,
    };
  }

  if (selection.section) {
    return {
      notebookPath: selection.notebook.path,
      notebookName: selection.notebook.name,
      sectionPath: selection.section.path,
      sectionName: selection.section.name,
      parentId: null,
      targetLabel: selection.section.name,
    };
  }

  return {
    notebookPath: selection.notebook.path,
    notebookName: selection.notebook.name,
    sectionPath: null,
    sectionName: null,
    parentId: null,
    targetLabel: selection.notebook.name,
  };
}

function selectionFromApiPage(tree: VaultNotebook[], page: ApiPageDocument): TreeSelection {
  const vaultPage = apiDocumentToVaultPage(page);
  const notebook = tree.find((item) => item.path === page.notebookPath) ?? null;
  const section = page.sectionPath
    ? notebook?.sections.find((item) => item.path === page.sectionPath) ?? null
    : null;
  return { notebook, section, page: vaultPage };
}

function resolveSelection(
  tree: VaultNotebook[],
  preferred: { notebookPath?: string | null; sectionPath?: string | null; pagePath?: string | null }
): TreeSelection {
  if (preferred.pagePath) {
    for (const notebook of tree) {
      const rootPage = notebook.pages.find((item) => item.path === preferred.pagePath);
      if (rootPage) {
        return { notebook, section: null, page: rootPage };
      }

      for (const section of notebook.sections) {
        const page = section.pages.find((item) => item.path === preferred.pagePath);
        if (page) {
          return { notebook, section, page };
        }
      }
    }
  }

  if (preferred.sectionPath) {
    for (const notebook of tree) {
      const section = notebook.sections.find((item) => item.path === preferred.sectionPath);
      if (section) {
        return {
          notebook,
          section,
          page: section.pages[0] ?? null,
        };
      }
    }
  }

  if (preferred.notebookPath) {
    const notebook = tree.find((item) => item.path === preferred.notebookPath) ?? null;
    if (notebook) {
      return {
        notebook,
        section: notebook.sections[0] ?? null,
        page: notebook.pages[0] ?? notebook.sections[0]?.pages[0] ?? null,
      };
    }
  }

  for (const notebook of tree) {
    if (notebook.pages[0]) {
      return { notebook, section: null, page: notebook.pages[0] };
    }

    for (const section of notebook.sections) {
      if (section.pages[0]) {
        return { notebook, section, page: section.pages[0] };
      }
    }
  }

  const notebook = tree[0] ?? null;
  return {
    notebook,
    section: notebook?.sections[0] ?? null,
    page: null,
  };
}

function draftFromTreePage(selection: TreeSelection): PageDraft {
  if (!selection.notebook || !selection.page) {
    throw new Error("Cannot create a page draft from an empty selection.");
  }

  const portableRoot = selection.notebook.rootPath?.trim() || "";
  let resolvedDiskPath: string | undefined;
  if (portableRoot && selection.page.path.startsWith(`${selection.notebook.path}/`)) {
    const remainder = selection.page.path.slice(selection.notebook.path.length + 1);
    resolvedDiskPath = `${portableRoot.replace(/[\\/]+$/, "")}/${remainder}`;
  }

  return {
    ...selection.page,
    body: selection.page.content,
    metadata: selection.page.metadata ?? {},
    notebookPath: selection.notebook.path,
    notebookName: selection.notebook.name,
    sectionPath: selection.section?.path ?? null,
    sectionName: selection.section?.name ?? null,
    resolvedDiskPath,
    designLinked: selection.page.designLinked,
    sourceMissing: selection.page.sourceMissing,
  };
}

function buildHeaderContext(selection: TreeSelection) {
  if (selection.page && selection.section && selection.notebook) {
    return {
      title: selection.page.title,
      subtitle: `${selection.notebook.name} / ${selection.section.name}`,
    };
  }

  if (selection.page && selection.notebook) {
    return {
      title: selection.page.title,
      subtitle: `${selection.notebook.name} / Root`,
    };
  }

  if (selection.section && selection.notebook) {
    return {
      title: selection.section.name,
      subtitle: selection.notebook.name,
    };
  }

  if (selection.notebook) {
    return {
      title: selection.notebook.name,
      subtitle: "Notebook",
    };
  }

  return {
    title: "Smart Notes",
    subtitle: null,
  };
}

function remapSelectionAfterRename(input: {
  notebook: string | null;
  section: string | null;
  page: string | null;
  previousPath: string;
  nextPath: string;
}) {
  return {
    notebookPath: replacePathPrefix(input.notebook, input.previousPath, input.nextPath),
    sectionPath: replacePathPrefix(input.section, input.previousPath, input.nextPath),
    pagePath: replacePathPrefix(input.page, input.previousPath, input.nextPath),
  };
}

function replacePathPrefix(currentPath: string | null, previousPath: string, nextPath: string) {
  if (!currentPath || (currentPath !== previousPath && !currentPath.startsWith(`${previousPath}/`))) {
    return currentPath;
  }

  return `${nextPath}${currentPath.slice(previousPath.length)}`;
}

function snapshotDraft(page: Pick<PageDraft, "path" | "title" | "content">) {
  return buildReloadDraftSnapshot(page);
}

function isPageReloadPending(latestPage: ApiPageDocument, visibleDraft: PageDraft) {
  if (latestPage.path !== visibleDraft.path) {
    return false;
  }

  return (
    latestPage.title !== visibleDraft.title ||
    latestPage.body !== visibleDraft.content ||
    latestPage.content !== visibleDraft.content
  );
}

function toggleSetValue(source: Set<string>, id: string) {
  const next = new Set(source);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function getSaveLabel(state: SaveState, error: string | null, updatedAt?: string | null) {
  if (state === "saving") return "Saving...";
  if (state === "dirty") return "Unsaved changes";
  if (state === "error") return error || "Save failed";
  if (updatedAt) return `Saved ${formatTime(updatedAt)}`;
  return "Idle";
}

function wordCount(content: string | undefined | null) {
  if (!content) return 0;
  return content
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildPreview(content: string | undefined | null) {
  if (!content) return "Empty page";
  return content.replace(/\s+/g, " ").trim().slice(0, 140) || "Empty page";
}

function nextPagePathAfterDelete(tree: VaultNotebook[], pagePath: string) {
  const paths = tree.flatMap((notebook) =>
    [
      ...notebook.pages.map((page) => page.path),
      ...notebook.sections.flatMap((section) => section.pages.map((page) => page.path)),
    ]
  );
  const index = paths.indexOf(pagePath);
  if (index < 0) return paths[0] ?? null;
  return paths[index + 1] ?? paths[index - 1] ?? null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dialogTitle(dialog: DialogState) {
  switch (dialog?.kind) {
    case "renameNotebook":
      return "Rename notebook";
    case "deleteNotebook":
      return dialog.isPortable ? "Remove notebook" : "Delete notebook";
    case "createSection":
      return "Create section";
    case "renameSection":
      return "Rename section";
    case "deleteSection":
      return "Delete section";
    case "createPage":
      return dialog.noteType === "jupyter"
        ? "Create Jupyter notebook"
        : dialog.noteType === "log"
          ? "Create log"
          : "Create page";
    case "renamePage":
      return "Rename page";
    case "deletePage":
      return "Delete page";
    case "movePage":
      return "Move page";
    case "confirmRemoteReload":
      return "Reload external changes?";
    default:
      return "Edit";
  }
}

function dialogDescription(dialog: DialogState) {
  switch (dialog?.kind) {
    case "renameNotebook":
      return dialog.isPortable
        ? "Change the display name shown in the sidebar."
        : "Rename the backing notebook directory and keep paths in sync.";
    case "deleteNotebook":
      return dialog.isPortable
        ? "Remove this folder from Smart Notes. Files on disk are not deleted."
        : "Delete the notebook directory and everything inside it.";
    case "createSection":
      return `Create a new section inside ${dialog.notebookName}.`;
    case "renameSection":
      return "Rename the backing section directory and keep page paths aligned.";
    case "deleteSection":
      return "Delete this section directory and all of its pages.";
    case "createPage":
      return dialog.noteType === "jupyter"
        ? `Create a Jupyter notebook inside ${dialog.targetLabel ?? dialog.sectionName}. Smart Notes will make a vault folder with a notebook file and launch a local Jupyter server when you open it.`
        : dialog.noteType === "log"
          ? `Create a form-backed log inside ${dialog.targetLabel ?? dialog.sectionName}. Schema and rows are stored in a vault-native sidecar next to the page.`
          : `Create a new page inside ${dialog.targetLabel ?? dialog.sectionName}.`;
    case "renamePage":
      return "Rename the Markdown file and any adjacent asset folder.";
    case "deletePage":
      return "Delete the Markdown file and any adjacent asset folder.";
    case "movePage":
      return "Move this page to a different section in the vault.";
    case "confirmRemoteReload":
      return "The saved page changed while this editor has unsaved local edits.";
    default:
      return "";
  }
}

function deleteDialogCopy(dialog: Exclude<DialogState, null>) {
  switch (dialog.kind) {
    case "deleteNotebook":
      return dialog.isPortable
        ? `This removes "${dialog.name}" from Smart Notes but leaves its files on disk.`
        : `This removes "${dialog.name}" and all sections and pages inside it.`;
    case "deleteSection":
      return `This removes "${dialog.name}" and all pages inside it.`;
    case "deletePage":
      return `This removes "${dialog.title}" from the local vault.`;
    case "confirmRemoteReload":
      return `Reloading "${dialog.title}" will discard the unsaved local edits currently visible in the editor and show the latest saved page from disk.`;
    default:
      return "";
  }
}

function dialogActionLabel(dialog: DialogState) {
  switch (dialog?.kind) {
    case "renameNotebook":
      return "Rename";
    case "deleteNotebook":
      return dialog.isPortable ? "Remove" : "Delete";
    case "createSection":
      return "Create";
    case "renameSection":
      return "Rename";
    case "deleteSection":
      return "Delete";
    case "createPage":
      return "Create";
    case "renamePage":
      return "Rename";
    case "deletePage":
      return "Delete";
    case "movePage":
      return "Move";
    case "confirmRemoteReload":
      return "Discard and reload";
    default:
      return "Save";
  }
}

function isDialogInvalid(dialog: DialogState, value: string, selectValue: string) {
  if (!dialog) {
    return true;
  }

  if (dialog.kind === "movePage") {
    return !selectValue;
  }

  if (
    dialog.kind === "deleteNotebook" ||
    dialog.kind === "deleteSection" ||
    dialog.kind === "deletePage" ||
    dialog.kind === "confirmRemoteReload"
  ) {
    return false;
  }

  return !value.trim();
}

async function fetchVaultTree(options?: { sequential?: boolean; skipCache?: boolean }): Promise<VaultTreeResponse> {
  const params = new URLSearchParams();
  if (options?.sequential) {
    params.set("sequential", "1");
  }
  if (options?.skipCache) {
    params.set("skipCache", "1");
  }
  const query = params.toString();
  const response = await fetch(`/api/vault${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load vault."));
  }
  return response.json();
}

async function fetchVaultPage(pagePath: string): Promise<ApiPageDocument> {
  const response = await fetch(`/api/page?path=${encodeURIComponent(pagePath)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to load page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  pageContentCache.set(body.page.path, { html: body.page.content });
  return body.page;
}

async function createVaultPage(payload: CreatePagePayload) {
  const response = await vaultWriteFetch("/api/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function importVaultPageDocx(sectionPath: string, file: File) {
  const formData = new FormData();
  formData.set("sectionPath", sectionPath);
  formData.set("file", file);

  const response = await vaultWriteFetch("/api/page/docx", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to import DOCX."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function exportVaultPageDocx(payload: { path: string; title: string; bodyHtml: string }) {
  const response = await vaultWriteFetch("/api/page/docx", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to export DOCX."));
  }

  return response.blob();
}

function sanitizeDownloadFilename(title: string) {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return sanitized || "Untitled page";
}

function triggerBlobDownload(fileName: string, blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function saveVaultPage(payload: SavePagePayload) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to save page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

function createSyncOriginId() {
  return `smart-notes:${safeRandomUUID()}`;
}

async function renameVaultPage(payload: RenamePagePayload) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to rename page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function moveVaultPage(payload: MovePagePayload) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to move page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function nestVaultPage(pagePath: string, parentId: string | null) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "nest", path: pagePath, parentId }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to nest page."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function setVaultPageKeyNote(pagePath: string, keyNote: boolean) {
  const response = await vaultWriteFetch("/api/page", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "keyNote", path: pagePath, keyNote }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to update key note."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function reorderVaultSectionPages(sectionPath: string, orderedIds: string[]) {
  const response = await vaultWriteFetch("/api/section", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sectionPath, orderedIds }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to reorder pages."));
  }
}

async function deleteVaultPage(pagePath: string) {
  const response = await vaultWriteFetch(`/api/page?path=${encodeURIComponent(pagePath)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete page."));
  }
}

async function createVaultNotebook(payload: CreateNotebookPayload) {
  const response = await vaultWriteFetch("/api/notebook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create notebook."));
  }

  const body = (await response.json()) as { notebook: NotebookMutationResult };
  return body.notebook;
}

async function renameVaultNotebook(payload: RenameNotebookPayload) {
  const response = await vaultWriteFetch("/api/notebook", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to rename notebook."));
  }

  const body = (await response.json()) as { notebook: NotebookMutationResult };
  return body.notebook;
}

async function deleteVaultNotebook(notebookPath: string) {
  const response = await vaultWriteFetch(`/api/notebook?path=${encodeURIComponent(notebookPath)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete notebook."));
  }
}

async function createVaultSection(payload: CreateSectionPayload) {
  const response = await vaultWriteFetch("/api/section", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to create section."));
  }

  const body = (await response.json()) as { section: SectionMutationResult };
  return body.section;
}

async function renameVaultSection(payload: RenameSectionPayload) {
  const response = await vaultWriteFetch("/api/section", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to rename section."));
  }

  const body = (await response.json()) as { section: SectionMutationResult };
  return body.section;
}

async function deleteVaultSection(sectionPath: string) {
  const response = await vaultWriteFetch(`/api/section?path=${encodeURIComponent(sectionPath)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to delete section."));
  }
}

async function captureVaultPage(payload: CapturePayload) {
  const response = await vaultWriteFetch("/api/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "Failed to capture note."));
  }

  const body = (await response.json()) as { page: ApiPageDocument };
  return body.page;
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}
