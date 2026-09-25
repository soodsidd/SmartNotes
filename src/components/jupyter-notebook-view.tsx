"use client";

import * as React from "react";
import { AlertTriangle, LoaderCircle, RotateCw, Send, X } from "lucide-react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  closeJupyterFastLaneSession,
  launchJupyterSession,
  launchJupyterWorkspaceSession,
  sendJupyterFastLanePrompt,
  stopJupyterWorkspaceSession,
  streamJupyterFastLanePrompt,
  warmJupyterFastLaneSession,
  type JupyterErrorCode,
  type JupyterSessionView,
  type JupyterWorkspaceSessionRequest,
} from "@/lib/api/jupyter";
import {
  createJupyterCommandMessage,
  createJupyterApplyAnswerMessage,
  parseJupyterApplyAnswerResult,
  parseJupyterContextMenuMessage,
  parseJupyterCommandResult,
  parseJupyterFocusMessage,
  parseJupyterInlineAiKeybindingMessage,
  parseJupyterOverlayDismissMessage,
  type JupyterFocusSelection,
  type JupyterApplyAnswerResult,
  type JupyterContextMenuEvent,
  type JupyterDeepWorkCommand,
  type JupyterFocusState,
} from "@/lib/jupyter-focus";
import {
  JupyterDeepWorkToolbar,
  type JupyterDeepWorkIdentity,
  type JupyterToolbarCommandState,
} from "@/components/jupyter-deep-work-toolbar";
import { shouldOpenEditorContextMenu } from "@/lib/editor-context-menu";
import {
  buildJupyterCommentAnswerCompanionHandoff,
  buildJupyterInlineAiActions,
  buildJupyterInlineAiPrompt,
  findJupyterNaturalLanguageComment,
  formatJupyterInlineAiNotebookAnswer,
  hasJupyterTextSelection,
  isJupyterInlineAiConversationalProse,
  jupyterInlineAiAnswerRoute,
  jupyterInlineAiExpectsCode,
  jupyterInlineAiStreamsToOverlay,
  type JupyterInlineAiActionId,
} from "@/lib/jupyter-inline-ai";
import { workspacePathBlockReason } from "@/lib/deep-work";
import {
  fetchWorkspaceAnnotations,
  fetchWorkspaceSource,
  saveWorkspaceAnnotations,
} from "@/lib/api/workspace";
import type { LoadedWorkspaceAnnotation, WorkspaceAnnotation } from "@/server/jupyter/workspace-state";

export interface JupyterNotebookBridgeController {
  /** Returns the request id when queued, or null when no current live target exists. */
  applyAnswer: (
    answer: string,
    focus?: JupyterFocusState,
    requestId?: string,
    selectionOverride?: JupyterFocusSelection
  ) => string | null;
  /** Dispatches one allow-listed semantic command through the authenticated Lab bridge. */
  dispatchCommand: (
    command: JupyterDeepWorkCommand,
    requestId?: string,
    target?: { path?: string; line?: number }
  ) => string | null;
}

export interface JupyterAskInCompanionPayload {
  draft: string;
  comment: string;
  modelReply: string;
  pagePath: string;
  pageTitle?: string;
}

export interface JupyterNotebookViewProps {
  pagePath: string;
  title?: string;
  /** Project-backed Deep Work launch descriptor. Omit for a note-owned `.jupyter` session. */
  workspace?: JupyterWorkspaceSessionRequest & {
    projectName: string;
    worktreeLabel?: string;
    activeFile?: string;
    activeLine?: number;
  };
  onOpenSidebar?: () => void;
  onBack?: () => void;
  backLabel?: string;
  onRevealWorkspace?: () => void;
  onViewDiff?: () => void;
  onFocusChange?: (focus: JupyterFocusState | null) => void;
  onContextMenu?: (event: JupyterContextMenuEvent) => void;
  onAnswerApplied?: (result: JupyterApplyAnswerResult) => void;
  onBridgeReady?: (bridge: JupyterNotebookBridgeController | null) => void;
  onWorkspaceReady?: (session: JupyterSessionView | null) => void;
  /** SN-254: open Companion with a prefilled composer when Answer comment gives prose. */
  onAskInCompanion?: (payload: JupyterAskInCompanionPayload) => void;
  /**
   * SN-270: an external (Companion) write landed on the focused Deep Work
   * document. Bumping `nonce` reloads that one document in place through the
   * Lab bridge. It deliberately is NOT part of this component's React key: a
   * remount would relaunch the workspace session and drop the rooted
   * workspace, its capability, and the active file.
   */
  externalReload?: { path: string; nonce: number } | null;
}

type ViewState =
  | { phase: "launching" }
  | { phase: "ready"; url: string; session: JupyterSessionView }
  | { phase: "stopped" }
  | { phase: "error"; code?: JupyterErrorCode; message: string };

type InlineSurfacePhase =
  | "actions"
  | "ask"
  | "fix-hint"
  | "working"
  | "stream"
  | "applying"
  | "answer"
  | "error";

interface InlineSurfaceState {
  trigger: "selection" | "contextmenu" | "keybinding";
  focus: JupyterFocusState;
  x: number;
  y: number;
  phase: InlineSurfacePhase;
  action?: JupyterInlineAiActionId;
  question: string;
  answer?: string;
  error?: string;
  requestId?: string;
  /** SN-253: the owner's original comment, echoed at the top of the stream. */
  streamPrompt?: string;
  /** SN-253: answer text accumulated so far for a streaming turn. */
  streamText?: string;
  /** SN-253: one-line status under the stream ("Thinking…", "Applying…"). */
  streamStatus?: string;
}

function isNotebookRoutedInlineSurfaceProtected(surface: InlineSurfaceState | null): boolean {
  if (!surface?.action || jupyterInlineAiAnswerRoute(surface.action) !== "notebook") return false;
  return (
    surface.phase === "working" ||
    surface.phase === "stream" ||
    surface.phase === "applying" ||
    surface.phase === "error"
  );
}

/** Human guidance per failure code. Jupyter owns execution; we own clarity. */
function errorGuidance(code: JupyterErrorCode | undefined): { heading: string; hint: string } {
  switch (code) {
    case "JUPYTER_MISSING":
      return {
        heading: "Jupyter isn't installed",
        hint: "Install JupyterLab in your Python environment (pip install jupyterlab), then retry.",
      };
    case "NOTEBOOK_UNAVAILABLE":
      return {
        heading: "Notebook files are missing",
        hint: "This note's working folder or notebook file could not be found. It may have been moved or deleted outside Smart Notes.",
      };
    case "PORT_CONFLICT":
      return {
        heading: "Port was already in use",
        hint: "Another process claimed the port before Jupyter could start. Retry to pick a new one.",
      };
    case "SERVER_DOWN":
      return {
        heading: "Jupyter server stopped",
        hint: "The notebook server is no longer responding. Retry to relaunch it.",
      };
    case "PROXY_UNAVAILABLE":
      return {
        heading: "Notebook connection failed",
        hint: "Smart Notes could not reach Jupyter through the same-origin notebook proxy. Retry after checking the server connection.",
      };
    case "MOBILE_BROWSER_UNSUPPORTED":
      return {
        heading: "Browser can't run this notebook",
        hint: "This browser mode does not expose the cookie or WebSocket support JupyterLab needs to run kernels.",
      };
    case "SERVER_LAUNCH_FAILED":
    default:
      return {
        heading: "Couldn't start Jupyter",
        hint: "The Jupyter server failed to launch. Check that your Python environment is healthy, then retry.",
      };
  }
}

function unsupportedBrowserReason(): string | null {
  if (typeof window === "undefined") return null;
  if (!("WebSocket" in window)) {
    return "WebSocket support is unavailable, so Jupyter kernel channels cannot connect.";
  }
  if (typeof navigator !== "undefined" && navigator.cookieEnabled === false) {
    return "Cookies are disabled, so JupyterLab cannot keep its authenticated session.";
  }
  return null;
}

/**
 * Embedded JupyterLab surface for `note_type: jupyter` pages.
 *
 * Smart Notes owns the launch/connect lifecycle and failure messaging; the
 * iframe hands off all code execution, autocomplete, terminals, and output
 * rendering to the local Jupyter runtime.
 */
export function JupyterNotebookView({
  pagePath,
  title,
  workspace,
  onOpenSidebar,
  onBack,
  backLabel,
  onRevealWorkspace,
  onViewDiff,
  onFocusChange,
  onContextMenu,
  onAnswerApplied,
  onBridgeReady,
  onWorkspaceReady,
  onAskInCompanion,
  externalReload,
}: JupyterNotebookViewProps) {
  const [state, setState] = React.useState<ViewState>({ phase: "launching" });
  const workspaceAccessMode = workspace
    ? state.phase === "ready"
      ? state.session.accessMode ?? workspace.requestedAccess ?? "read-only"
      : workspace.requestedAccess ?? "read-only"
    : undefined;
  const [attempt, setAttempt] = React.useState(0);
  const [frameLoaded, setFrameLoaded] = React.useState(false);
  const [frameReloadNonce, setFrameReloadNonce] = React.useState(0);
  const [activeFocus, setActiveFocus] = React.useState<JupyterFocusState | null>(null);
  const protectedWorkspacePathReason =
    workspace && activeFocus?.workspacePath
      ? workspacePathBlockReason(activeFocus.workspacePath)
      : null;
  const [commandState, setCommandState] = React.useState<JupyterToolbarCommandState>({
    pending: null,
    failed: null,
  });
  const [inlineSurface, setInlineSurface] = React.useState<InlineSurfaceState | null>(null);
  const [annotationsOpen, setAnnotationsOpen] = React.useState(false);
  const [annotations, setAnnotations] = React.useState<LoadedWorkspaceAnnotation[]>([]);
  const [annotationsRevision, setAnnotationsRevision] = React.useState<string | null>(null);
  const [annotationNote, setAnnotationNote] = React.useState("");
  const [annotationStatus, setAnnotationStatus] = React.useState<{
    loading: boolean;
    error?: string;
  }>({ loading: false });
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const latestFocusRef = React.useRef<JupyterFocusState | null>(null);
  const inlineSurfaceRef = React.useRef<InlineSurfaceState | null>(null);
  const inlineRequestRef = React.useRef<AbortController | null>(null);
  inlineSurfaceRef.current = inlineSurface;
  const runInlineActionRef = React.useRef<
    ((
      action: JupyterInlineAiActionId,
      focus: JupyterFocusState,
      question?: string,
      options?: { skipHintPrompt?: boolean }
    ) => Promise<void>) | null
  >(null);
  const onFocusChangeRef = React.useRef(onFocusChange);
  const onContextMenuRef = React.useRef(onContextMenu);
  const onAnswerAppliedRef = React.useRef(onAnswerApplied);
  const onBridgeReadyRef = React.useRef(onBridgeReady);
  const onWorkspaceReadyRef = React.useRef(onWorkspaceReady);
  const onAskInCompanionRef = React.useRef(onAskInCompanion);
  onFocusChangeRef.current = onFocusChange;
  onContextMenuRef.current = onContextMenu;
  onAnswerAppliedRef.current = onAnswerApplied;
  onBridgeReadyRef.current = onBridgeReady;
  onWorkspaceReadyRef.current = onWorkspaceReady;
  onAskInCompanionRef.current = onAskInCompanion;

  const applyAnswer = React.useCallback<JupyterNotebookBridgeController["applyAnswer"]>((answer, focus, requestId, selectionOverride) => {
    const target = focus ?? latestFocusRef.current;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!target || target.pagePath !== pagePath || !frameWindow) return null;
    const id = requestId ?? globalThis.crypto?.randomUUID?.() ?? `jupyter-answer-${Date.now()}`;
    const message = createJupyterApplyAnswerMessage(id, answer, target, selectionOverride);
    if (!message) return null;
    frameWindow.postMessage(message, window.location.origin);
    return id;
  }, [pagePath]);

  const dispatchCommand = React.useCallback<JupyterNotebookBridgeController["dispatchCommand"]>((command, requestId, target) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow || state.phase !== "ready") return null;
    const id = requestId ?? globalThis.crypto?.randomUUID?.() ?? `jupyter-command-${Date.now()}`;
    const message = createJupyterCommandMessage(id, command, target);
    if (!message) return null;
    setCommandState({ pending: command, failed: null });
    frameWindow.postMessage(message, window.location.origin);
    return id;
  }, [state.phase]);

  const initialFocusSentRef = React.useRef<string | null>(null);
  const initialFocusAttemptRef = React.useRef<{ file: string; attempts: number; requestIds: Set<string> } | null>(null);
  React.useEffect(() => {
    if (
      state.phase !== "ready" ||
      !frameLoaded ||
      !workspace?.activeFile ||
      initialFocusSentRef.current === workspace.activeFile
    ) return;
    const stateForFile =
      initialFocusAttemptRef.current?.file === workspace.activeFile
        ? initialFocusAttemptRef.current
        : { file: workspace.activeFile, attempts: 0, requestIds: new Set<string>() };
    initialFocusAttemptRef.current = stateForFile;
    let cancelled = false;
    let timer = 0;
    const tryFocus = () => {
      if (cancelled || initialFocusSentRef.current === workspace.activeFile) return;
      if (stateForFile.attempts >= 8) {
        setCommandState({
          pending: null,
          failed: "focus-file",
          error: "JupyterLab did not acknowledge the initial file focus. Use the file browser to open it.",
        });
        return;
      }
      stateForFile.attempts += 1;
      const requestId = dispatchCommand("focus-file", undefined, {
        path: workspace.activeFile,
        line: workspace.activeLine,
      });
      if (requestId) stateForFile.requestIds.add(requestId);
      timer = window.setTimeout(tryFocus, 500);
    };
    timer = window.setTimeout(tryFocus, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dispatchCommand, frameLoaded, state.phase, workspace?.activeFile, workspace?.activeLine]);

  // SN-270: apply a Companion/external write to the focused Deep Work document
  // *in place*. This is deliberately a dispatched bridge command rather than a
  // key/remount: remounting would re-run the launch effect and destroy the
  // workspace session, its Companion capability, the focus state, and the
  // rooted Lab frame - i.e. it would drop the owner out of the Deep Work root
  // in order to show a changed cell.
  //
  // The command names its target document. The shell validated the write
  // against the focused path when the socket event arrived, but this effect
  // runs later and the frame handles the message later still, so the owner can
  // switch tabs in between. Carrying the path lets the bridge re-check identity
  // against the live focus immediately before running `docmanager:reload`, and
  // refuse rather than reload an unrelated document. The bridge independently
  // refuses while the live model is dirty, so unsaved cells are never
  // discarded; both reasons surface through the ordinary command-result path.
  const handledExternalReloadRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!workspace || !externalReload || state.phase !== "ready" || !frameLoaded) return;
    if (handledExternalReloadRef.current === externalReload.nonce) return;
    handledExternalReloadRef.current = externalReload.nonce;
    dispatchCommand("reload-document", undefined, { path: externalReload.path });
  }, [dispatchCommand, externalReload, frameLoaded, state.phase, workspace]);

  const dismissInlineSurface = React.useCallback(() => {
    inlineRequestRef.current?.abort();
    inlineRequestRef.current = null;
    setInlineSurface(null);
  }, []);

  const dismissInlineSurfaceFromPassiveEvent = React.useCallback(() => {
    if (isNotebookRoutedInlineSurfaceProtected(inlineSurfaceRef.current)) return;
    dismissInlineSurface();
  }, [dismissInlineSurface]);

  /** SN-255: close any leftover Lab context menu under the portaled chip. */
  const dismissEmbeddedLabMenus = React.useCallback(() => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;
    try {
      // Construct on the host — iframe Window typing omits KeyboardEvent in Next's DOM lib.
      frameWindow.document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    } catch {
      // Same-origin proxy only; ignore if the frame is mid-reload.
    }
  }, []);

  const handoffAnswerCommentToCompanion = React.useCallback(() => {
    if (!inlineSurface || inlineSurface.action !== "comment-answer") return;
    const comment =
      inlineSurface.streamPrompt?.trim() ||
      findJupyterNaturalLanguageComment(inlineSurface.focus)?.text ||
      "";
    const modelReply = inlineSurface.answer?.trim() || "";
    const draft = buildJupyterCommentAnswerCompanionHandoff({
      comment,
      modelReply,
      pagePath,
      pageTitle: title,
    });
    onAskInCompanionRef.current?.({
      draft,
      comment,
      modelReply,
      pagePath,
      pageTitle: title,
    });
    dismissInlineSurface();
  }, [dismissInlineSurface, inlineSurface, pagePath, title]);

  const retryInlineAction = React.useCallback(() => {
    if (!inlineSurface?.action) return;
    void runInlineActionRef.current?.(
      inlineSurface.action,
      inlineSurface.focus,
      inlineSurface.question,
      inlineSurface.action === "fix" ? { skipHintPrompt: true } : undefined
    );
  }, [inlineSurface]);

  const focusAnchor = React.useCallback((
    focus: JupyterFocusState,
    options?: { allowFallback?: boolean }
  ) => {
    const frameRect = iframeRef.current?.getBoundingClientRect();
    if (!frameRect) return null;
    const rect = focus.selectionRects.at(-1);
    if (rect) {
      return { x: frameRect.left + rect.left, y: frameRect.top + rect.bottom + 8 };
    }
    // The append chord may arrive with an empty selectionRects list. Its
    // comment offsets are still valid, so keep a stable progress anchor.
    if (!options?.allowFallback) return null;
    return { x: frameRect.left + 16, y: frameRect.top + 16 };
  }, []);

  const showSelectionActions = React.useCallback((focus: JupyterFocusState) => {
    if (workspace && focus.workspacePath && workspacePathBlockReason(focus.workspacePath)) {
      dismissInlineSurfaceFromPassiveEvent();
      return;
    }
    const hasSelection = hasJupyterTextSelection(focus);
    // SN-264: ordinary focus snapshots are selection-only triggers. Comment
    // actions remain available through explicit Alt+Right-click, while the
    // append chord has its own message path below.
    if (!hasSelection) {
      if (inlineSurfaceRef.current?.trigger === "selection") {
        dismissInlineSurfaceFromPassiveEvent();
      }
      return;
    }
    const anchor = focusAnchor(focus);
    if (!anchor) return;
    setInlineSurface((current) => {
      if (
        isNotebookRoutedInlineSurfaceProtected(current) ||
        (current && (current.phase === "working" || current.phase === "stream" || current.phase === "applying"))
      ) return current;
      return {
        trigger: "selection",
        focus,
        ...anchor,
        phase: "actions",
        question: "",
      };
    });
  }, [dismissInlineSurfaceFromPassiveEvent, focusAnchor, workspace]);

  const runInlineAction = React.useCallback(async (
    action: JupyterInlineAiActionId,
    focus: JupyterFocusState,
    question = "",
    options?: { skipHintPrompt?: boolean }
  ) => {
    if (workspaceAccessMode === "read-only" && jupyterInlineAiAnswerRoute(action) !== "overlay") {
      setInlineSurface((current) => current
        ? { ...current, phase: "error", action, error: "This project workspace is read-only." }
        : current);
      return;
    }
    if (action === "ask" && !question.trim()) {
      setInlineSurface((current) => current ? { ...current, phase: "ask", action, error: undefined } : current);
      return;
    }
    // Fix always collects an optional hint first (Ask-like flow, SN-251), even
    // when the owner leaves it empty — `skipHintPrompt` marks the follow-up
    // call made once the hint form is submitted.
    if (action === "fix" && !options?.skipHintPrompt) {
      setInlineSurface((current) => current ? { ...current, phase: "fix-hint", action, question, error: undefined } : current);
      return;
    }

    // SN-255: right-click actions must not leave Lab's native menu stacked
    // under the portaled chip (Paste Cell Below was still visible under the
    // timeout error in production). Call outside setState so Strict Mode
    // double-invoke cannot dispatch Escape twice.
    if (inlineSurfaceRef.current?.trigger === "contextmenu") {
      dismissEmbeddedLabMenus();
    }

    const controller = new AbortController();
    inlineRequestRef.current?.abort();
    inlineRequestRef.current = controller;

    // SN-253/SN-255: notebook-routed code actions and Answer comment turn the
    // chip into a live stream so the owner can watch progress instead of an
    // opaque spinner (and Answer comment may legitimately end as prose).
    const streams = jupyterInlineAiStreamsToOverlay(action);
    const comment = findJupyterNaturalLanguageComment(focus);
    const streamPrompt =
      action === "comment-answer" || action === "comment-to-code" || action === "comment-to-code-append"
        ? comment?.text ?? question.trim()
        : question.trim() || undefined;
    setInlineSurface((current) => current ? {
      ...current,
      phase: streams ? "stream" : "working",
      action,
      question,
      answer: undefined,
      error: undefined,
      streamPrompt: streams ? streamPrompt : undefined,
      streamText: streams ? "" : undefined,
      streamStatus: streams ? "Thinking…" : undefined,
    } : current);

    try {
      const prompt = buildJupyterInlineAiPrompt(action, focus, question);
      const inlineOwnerPath = workspace
        ? state.phase === "ready" ? state.session.capability : null
        : pagePath;
      if (!inlineOwnerPath) throw new Error("The Deep Work capability is not ready. Retry after the workspace finishes launching.");
      const result = streams
        ? await streamJupyterFastLanePrompt(inlineOwnerPath, prompt, focus, {
            signal: controller.signal,
            onDelta: (_chunk, accumulated) => {
              if (controller.signal.aborted) return;
              setInlineSurface((current) => current?.phase === "stream"
                ? { ...current, streamText: accumulated, streamStatus: "Answering…" }
                : current);
            },
          })
        : await sendJupyterFastLanePrompt(inlineOwnerPath, prompt, focus, controller.signal);
      if (controller.signal.aborted) return;
      inlineRequestRef.current = null;

      if (jupyterInlineAiAnswerRoute(action) === "overlay") {
        setInlineSurface((current) => current ? {
          ...current,
          phase: "answer",
          action,
          answer: result.text.trim(),
        } : current);
        return;
      }

      const formatted = formatJupyterInlineAiNotebookAnswer(action, result.text, focus);
      if (!formatted) {
        // SN-253: the reply is conversational, so nothing is written into the
        // notebook. It stays in the overlay until the owner dismisses it —
        // never forced into `# …` lines over the original comment.
        setInlineSurface((current) => current ? {
          ...current,
          phase: "answer",
          action,
          answer: result.text.trim(),
          streamStatus: undefined,
        } : current);
        return;
      }
      if (jupyterInlineAiExpectsCode(action) && isJupyterInlineAiConversationalProse(formatted.text)) {
        // SN-251: never write a conversational refusal/clarification into the
        // cell — surface it as an error instead so the owner can retry with a hint.
        setInlineSurface((current) => current ? {
          ...current,
          phase: "error",
          action,
          error: `The model replied with text instead of code, so nothing was applied to the cell:\n\n${formatted.text.slice(0, 400)}`,
        } : current);
        return;
      }
      const requestId = applyAnswer(formatted.text, focus, undefined, formatted.selection);
      if (!requestId) {
        throw new Error("The live Jupyter cell is no longer available.");
      }
      setInlineSurface((current) => current ? {
        ...current,
        // A streaming turn keeps its transcript visible while the code lands,
        // then dismisses on the bridge's apply-answer-result.
        phase: current.phase === "stream" ? "stream" : "applying",
        streamStatus: current.phase === "stream"
          // SN-269: Write code from a *selected* comment also appends below it.
          ? (action === "comment-answer" ||
            action === "comment-to-code-append" ||
            (action === "comment-to-code" && comment?.origin === "selection")
            ? "Adding code below your comment…"
            : "Applying to cell…")
          : current.streamStatus,
        action,
        requestId,
      } : current);
    } catch (error) {
      if (controller.signal.aborted) return;
      inlineRequestRef.current = null;
      if (inlineSurfaceRef.current?.trigger === "contextmenu") {
        dismissEmbeddedLabMenus();
      }
      setInlineSurface((current) => current ? {
        ...current,
        phase: "error",
        action,
        error: error instanceof Error ? error.message : "The inline AI request failed.",
      } : current);
    }
  }, [applyAnswer, dismissEmbeddedLabMenus, pagePath, state, workspace, workspaceAccessMode]);
  runInlineActionRef.current = runInlineAction;

  React.useEffect(() => {
    onBridgeReadyRef.current?.({ applyAnswer, dispatchCommand });
    return () => onBridgeReadyRef.current?.(null);
  }, [applyAnswer, dispatchCommand]);

  React.useEffect(() => {
    onWorkspaceReadyRef.current?.(workspace && state.phase === "ready" ? state.session : null);
    return () => onWorkspaceReadyRef.current?.(null);
  }, [state, workspace]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow
      ) {
        return;
      }
      const focus = parseJupyterFocusMessage(event.data, pagePath);
      if (focus) {
        latestFocusRef.current = focus;
        setActiveFocus(focus);
        onFocusChangeRef.current?.(focus);
        showSelectionActions(focus);
        return;
      }
      const contextMenu = parseJupyterContextMenuMessage(event.data, pagePath);
      if (contextMenu) {
        latestFocusRef.current = contextMenu.focus;
        setActiveFocus(contextMenu.focus);
        onFocusChangeRef.current?.(contextMenu.focus);
        onContextMenuRef.current?.(contextMenu);
        const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        if (shouldOpenEditorContextMenu({
          pointerType: "mouse",
          coarsePointer,
          viewportWidth: window.innerWidth,
        })) {
          const frameRect = iframeRef.current?.getBoundingClientRect();
          if (frameRect) {
            setInlineSurface((current) => isNotebookRoutedInlineSurfaceProtected(current)
              ? current
              : {
                  trigger: "contextmenu",
                  focus: contextMenu.focus,
                  x: frameRect.left + contextMenu.x,
                  y: frameRect.top + contextMenu.y,
                  phase: "actions",
                  question: "",
                });
          }
        }
        return;
      }
      const keybindingEvent = parseJupyterInlineAiKeybindingMessage(event.data, pagePath);
      if (keybindingEvent) {
        latestFocusRef.current = keybindingEvent.focus;
        setActiveFocus(keybindingEvent.focus);
        onFocusChangeRef.current?.(keybindingEvent.focus);
        if (workspaceAccessMode === "read-only") return;
        if (isNotebookRoutedInlineSurfaceProtected(inlineSurfaceRef.current)) return;
        // SN-252: the host is the single source of truth for comment
        // detection — the bridge forwards the chord unconditionally and this
        // silently no-ops when the caret isn't on a natural-language comment.
        const comment = findJupyterNaturalLanguageComment(keybindingEvent.focus);
        if (!comment) return;
        const anchor = focusAnchor(keybindingEvent.focus, { allowFallback: true });
        if (anchor) {
          setInlineSurface({
            trigger: "keybinding",
            focus: keybindingEvent.focus,
            ...anchor,
            phase: "actions",
            question: "",
          });
        }
        // Apply even when Lab omitted a caret rect — the comment line offsets
        // are enough for a collapsed insert below the comment.
        void runInlineAction("comment-to-code-append", keybindingEvent.focus);
        return;
      }
      if (parseJupyterOverlayDismissMessage(event.data, pagePath)) {
        dismissInlineSurfaceFromPassiveEvent();
        return;
      }
      const answerResult = parseJupyterApplyAnswerResult(event.data, pagePath);
      if (answerResult) {
        if (answerResult.focus) {
          latestFocusRef.current = answerResult.focus;
          setActiveFocus(answerResult.focus);
          onFocusChangeRef.current?.(answerResult.focus);
        }
        onAnswerAppliedRef.current?.(answerResult);
        setInlineSurface((current) => {
          if (!current?.requestId || current.requestId !== answerResult.requestId) return current;
          return answerResult.ok
            ? null
            : { ...current, phase: "error", error: answerResult.reason ?? "Jupyter rejected the cell update." };
        });
        return;
      }
      const commandResult = parseJupyterCommandResult(event.data, pagePath);
      if (commandResult) {
        if (
          commandResult.command === "focus-file" &&
          commandResult.ok &&
          initialFocusAttemptRef.current?.requestIds.has(commandResult.requestId)
        ) {
          initialFocusSentRef.current = initialFocusAttemptRef.current.file;
        }
        if (commandResult.focus) {
          latestFocusRef.current = commandResult.focus;
          setActiveFocus(commandResult.focus);
          onFocusChangeRef.current?.(commandResult.focus);
        }
        setCommandState({
          pending: null,
          failed: commandResult.ok ? null : commandResult.command,
          error: commandResult.ok ? undefined : commandResult.reason ?? "JupyterLab could not complete the command.",
        });
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dismissInlineSurfaceFromPassiveEvent, focusAnchor, pagePath, runInlineAction, showSelectionActions, workspaceAccessMode]);

  React.useEffect(() => {
    return () => {
      inlineRequestRef.current?.abort();
      latestFocusRef.current = null;
      setActiveFocus(null);
      onFocusChangeRef.current?.(null);
    };
  }, [pagePath]);

  React.useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissInlineSurface();
    };
    window.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("scroll", dismissInlineSurfaceFromPassiveEvent, true);
    return () => {
      window.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("scroll", dismissInlineSurfaceFromPassiveEvent, true);
    };
  }, [dismissInlineSurface, dismissInlineSurfaceFromPassiveEvent]);

  // SN-247: warm the fast-lane companion session when this Jupyter page opens,
  // and tear it down when it closes (unmount or pagePath change). Deliberately
  // a separate effect, keyed only on pagePath (not `attempt`), so a Jupyter
  // kernel Retry does not churn the fast-lane session. Both calls are
  // fire-and-forget: warm-up runs off the request path, and teardown must not
  // block navigation/unmount.
  React.useEffect(() => {
    const ownerPath = workspace
      ? state.phase === "ready" ? state.session.capability : null
      : pagePath;
    if (!ownerPath) return;
    warmJupyterFastLaneSession(ownerPath);
    return () => closeJupyterFastLaneSession(ownerPath);
  }, [pagePath, state, workspace]);

  React.useEffect(() => {
    if (state.phase !== "ready") {
      latestFocusRef.current = null;
      setActiveFocus(null);
      onFocusChangeRef.current?.(null);
    }
  }, [pagePath, state.phase]);

  React.useEffect(() => {
    let cancelled = false;
    setState({ phase: "launching" });
    setFrameLoaded(false);

    const unsupported = unsupportedBrowserReason();
    if (unsupported) {
      setState({
        phase: "error",
        code: "MOBILE_BROWSER_UNSUPPORTED",
        message: unsupported,
      });
      return () => {
        cancelled = true;
      };
    }

    const launch = workspace
      ? launchJupyterWorkspaceSession(workspace)
      : launchJupyterSession(pagePath);
    launch
      .then((view: JupyterSessionView) => {
        if (cancelled) return;
        if (view.status === "ready" && view.url) {
          setState({ phase: "ready", url: view.url, session: view });
        } else {
          setState({
            phase: "error",
            code: view.errorCode,
            message: view.errorMessage ?? "The notebook session is not ready.",
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = (error as { code?: JupyterErrorCode }).code;
        setState({
          phase: "error",
          code,
          message: error instanceof Error ? error.message : "Failed to start the Jupyter session.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    pagePath,
    attempt,
    workspace?.rootPath,
    workspace?.projectId,
    workspace?.repoId,
    workspace?.branch,
    workspace?.isDefaultBranch,
    workspace?.requestedAccess,
    workspace?.ownerOpen,
    workspace?.defaultBranchEditConfirmed,
  ]);

  React.useEffect(() => {
    if (state.phase !== "ready" || frameLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      setState({
        phase: "error",
        code: "PROXY_UNAVAILABLE",
        message: "The JupyterLab frame did not finish loading through the Smart Notes proxy.",
      });
    }, 30_000);

    return () => window.clearTimeout(timer);
  }, [frameLoaded, state]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  const reloadLab = React.useCallback(() => {
    setCommandState({ pending: null, failed: null });
    setFrameLoaded(false);
    setFrameReloadNonce((current) => current + 1);
  }, []);
  const stopWorkspace = React.useCallback(async () => {
    if (!workspace) return;
    try {
      await stopJupyterWorkspaceSession(workspace);
      setCommandState({ pending: null, failed: null });
      setState({ phase: "stopped" });
    } catch (error) {
      setCommandState({
        pending: null,
        failed: null,
        error: error instanceof Error ? error.message : "The workspace could not be stopped.",
      });
    }
  }, [workspace]);
  const workspaceCapability =
    workspace && state.phase === "ready" ? state.session.capability ?? null : null;
  const activeWorkspacePath = workspace ? activeFocus?.workspacePath ?? null : null;
  const loadWorkspaceAnnotations = React.useCallback(async () => {
    if (!workspaceCapability || !activeWorkspacePath || workspacePathBlockReason(activeWorkspacePath)) return;
    setAnnotationStatus({ loading: true });
    try {
      const result = await fetchWorkspaceAnnotations(workspaceCapability, activeWorkspacePath);
      setAnnotations(result.annotations);
      setAnnotationsRevision(result.revision);
      setAnnotationStatus({ loading: false });
    } catch (error) {
      setAnnotationStatus({
        loading: false,
        error: error instanceof Error ? error.message : "Source annotations could not be loaded.",
      });
    }
  }, [activeWorkspacePath, workspaceCapability]);

  React.useEffect(() => {
    if (annotationsOpen) void loadWorkspaceAnnotations();
  }, [annotationsOpen, loadWorkspaceAnnotations]);

  const addWorkspaceAnnotation = React.useCallback(async () => {
    if (!workspaceCapability || !activeWorkspacePath || !activeFocus?.selection) return;
    const start = Math.min(activeFocus.selection.start.offset, activeFocus.selection.end.offset);
    const end = Math.max(activeFocus.selection.start.offset, activeFocus.selection.end.offset);
    if (start === end || activeFocus.documentKind !== "file") return;
    setAnnotationStatus({ loading: true });
    try {
      const current = await fetchWorkspaceSource(workspaceCapability, activeWorkspacePath);
      if (current.truncated) throw new Error("Annotations are unavailable for files larger than the bounded source window.");
      const selectedText = current.source.slice(start, end);
      const focusStart = activeFocus.content?.activeCellSourceStart ?? 0;
      const focusSource = activeFocus.content?.activeCellSource ?? "";
      const capturedSelection = focusSource.slice(start - focusStart, end - focusStart);
      if (!selectedText || selectedText !== capturedSelection) {
        throw new Error("The selected source changed. Select it again before annotating.");
      }
      const next: WorkspaceAnnotation[] = [
        ...annotations.map(({ status: _status, currentRange: _currentRange, ...annotation }) => annotation),
        {
          id: globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}`,
          anchor: {
            revision: current.revision,
            start,
            end,
            selectedText,
            quotedText: selectedText,
          },
          data: {
            note: annotationNote.trim(),
            createdAt: new Date().toISOString(),
          },
        },
      ];
      await saveWorkspaceAnnotations(workspaceCapability, activeWorkspacePath, next);
      setAnnotationNote("");
      await loadWorkspaceAnnotations();
    } catch (error) {
      setAnnotationStatus({
        loading: false,
        error: error instanceof Error ? error.message : "The source annotation was not saved.",
      });
    }
  }, [
    activeFocus,
    activeWorkspacePath,
    annotationNote,
    annotations,
    loadWorkspaceAnnotations,
    workspaceCapability,
  ]);

  const annotationsDisabledReason = !workspaceCapability
    ? "Annotations become available after the workspace capability is issued."
    : !activeWorkspacePath
      ? "Focus a project file to view annotations."
      : protectedWorkspacePathReason ?? undefined;
  const canAddAnnotation = Boolean(
    !annotationsDisabledReason &&
    activeFocus?.documentKind === "file" &&
    activeFocus.selection &&
    activeFocus.selection.start.offset !== activeFocus.selection.end.offset &&
    !annotations.some((annotation) => annotation.status !== "current") &&
    !annotationStatus.loading
  );
  const toolbarIdentity: JupyterDeepWorkIdentity | undefined = workspace
    ? {
        projectName: workspace.projectName,
        branch: state.phase === "ready" ? state.session.branch ?? workspace.branch : workspace.branch,
        worktreeLabel: workspace.worktreeLabel,
        accessMode: workspaceAccessMode ?? "read-only",
      }
    : undefined;
  const sessionStatus = state.phase === "ready"
    ? "ready"
    : state.phase === "launching"
      ? "starting"
      : state.phase === "error"
        ? "error"
        : "stopped";

  return (
    <div className="relative flex h-full w-full flex-col bg-background">
      <JupyterDeepWorkToolbar
        title={title}
        identity={toolbarIdentity}
        focus={activeFocus}
        sessionStatus={sessionStatus}
        commandState={commandState}
        onCommand={dispatchCommand}
        onOpenSidebar={onOpenSidebar}
        onBack={onBack}
        backLabel={backLabel}
        onReloadLab={state.phase === "ready" ? reloadLab : undefined}
        onStopWorkspace={workspace ? () => void stopWorkspace() : undefined}
        onRevealFolder={onRevealWorkspace}
        onViewDiff={onViewDiff}
        onAnnotations={annotationsDisabledReason ? undefined : () => setAnnotationsOpen((value) => !value)}
        annotationCount={annotations.length}
        annotationsDisabledReason={annotationsDisabledReason}
      />
      {annotationsOpen && workspace ? (
        <section
          aria-label="Source annotations"
          data-testid="jupyter-workspace-annotations"
          className="absolute right-2 top-12 z-30 w-[min(24rem,calc(100%-1rem))] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg md:top-10"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Source annotations</h2>
              <p className="truncate font-mono text-[10px] text-muted-foreground">{activeWorkspacePath}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAnnotationsOpen(false)}>
              Close
            </Button>
          </div>
          <div className="max-h-48 space-y-2 overflow-auto" aria-live="polite">
            {annotationStatus.loading ? <p className="text-xs text-muted-foreground">Loading annotations…</p> : null}
            {!annotationStatus.loading && annotations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No annotations for this file.</p>
            ) : null}
            {annotations.map((annotation) => (
              <article key={annotation.id} className="rounded border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate">{annotation.anchor.selectedText}</code>
                  <span
                    data-status={annotation.status}
                    className={annotation.status === "stale" ? "text-destructive" : "text-muted-foreground"}
                  >
                    {annotation.status}
                  </span>
                </div>
                {typeof (annotation.data as { note?: unknown } | undefined)?.note === "string" ? (
                  <p className="mt-1 whitespace-pre-wrap">{(annotation.data as { note: string }).note}</p>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-3 space-y-2 border-t border-border pt-2">
            <label className="block text-xs font-medium" htmlFor="workspace-annotation-note">
              Annotate current selection
            </label>
            <textarea
              id="workspace-annotation-note"
              value={annotationNote}
              maxLength={4000}
              onChange={(event) => setAnnotationNote(event.target.value)}
              placeholder="Optional note"
              rows={2}
              className="w-full resize-none rounded border border-input bg-background px-2 py-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={!canAddAnnotation}
              onClick={() => void addWorkspaceAnnotation()}
              data-testid="jupyter-add-workspace-annotation"
            >
              Add annotation
            </Button>
            {!canAddAnnotation && !annotationStatus.loading ? (
              <p className="text-[10px] text-muted-foreground">
                {activeFocus?.documentKind !== "file"
                  ? "Select text in an ordinary project file."
                  : annotations.some((annotation) => annotation.status !== "current")
                    ? "Refresh or resolve relocated/stale anchors before adding another annotation."
                    : "Select unchanged source text to annotate it."}
              </p>
            ) : null}
            {annotationsRevision ? (
              <p className="truncate font-mono text-[9px] text-muted-foreground">Revision {annotationsRevision}</p>
            ) : null}
            {annotationStatus.error ? (
              <p role="alert" className="text-xs text-destructive">{annotationStatus.error}</p>
            ) : null}
          </div>
        </section>
      ) : null}
      {protectedWorkspacePathReason ? (
        <div
          role="status"
          data-testid="jupyter-protected-path-ai"
          className="border-b border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground"
        >
          Inline AI and source annotations are unavailable for this protected path. {protectedWorkspacePathReason}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {state.phase === "launching" ? (
          <div
            data-testid="jupyter-launching"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"
          >
            <LoaderCircle className="size-6 animate-spin text-accent" />
            <p className="text-sm">Launching the local Jupyter server…</p>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <div
            data-testid="jupyter-error"
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <AlertTriangle className="size-8 text-destructive" />
            <div className="max-w-md space-y-1">
              <p className="text-base font-semibold text-foreground">
                {errorGuidance(state.code).heading}
              </p>
              <p className="text-sm text-muted-foreground">{errorGuidance(state.code).hint}</p>
              <p className="pt-1 font-mono text-xs text-muted-foreground/80">{state.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={retry} data-testid="jupyter-retry">
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </div>
        ) : null}

        {state.phase === "stopped" ? (
          <div data-testid="jupyter-stopped" className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium text-foreground">Workspace stopped</p>
            <p className="text-xs text-muted-foreground">JupyterLab kernels and terminals for this workspace are no longer running.</p>
            <Button variant="outline" size="sm" onClick={retry}>Restart workspace</Button>
          </div>
        ) : null}

        {state.phase === "ready" ? (
          <iframe
            ref={iframeRef}
            data-testid="jupyter-frame"
            key={`${state.url}:${frameReloadNonce}`}
            src={state.url}
            title={title ? `Jupyter notebook: ${title}` : "Jupyter notebook"}
            className="absolute inset-0 h-full w-full border-0 bg-background"
            allow="clipboard-read; clipboard-write"
            onLoad={() => setFrameLoaded(true)}
            onError={() =>
              setState({
                phase: "error",
                code: "PROXY_UNAVAILABLE",
                message: "The JupyterLab frame could not load through the Smart Notes proxy.",
              })
            }
          />
        ) : null}
      </div>
      {inlineSurface && typeof document !== "undefined" ? createPortal(
        <div
          role="dialog"
          aria-label="Jupyter inline AI"
          data-testid="jupyter-inline-ai-overlay"
          data-trigger={inlineSurface.trigger}
          className="fixed z-[var(--z-jupyter-inline-ai)] max-w-[min(28rem,calc(100vw-2rem))] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          style={{
            left: Math.max(8, Math.min(inlineSurface.x, window.innerWidth - 300)),
            top: Math.max(8, Math.min(inlineSurface.y, window.innerHeight - 180)),
          }}
        >
          {inlineSurface.phase === "actions" ? (
            <div className="flex max-w-[24rem] flex-wrap items-center gap-1">
              {buildJupyterInlineAiActions(inlineSurface.focus, {
                allowMutations: workspaceAccessMode !== "read-only",
              }).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  data-testid={action.testId}
                  disabled={action.disabled}
                  title={action.hint}
                  onClick={() => void runInlineAction(action.id, inlineSurface.focus)}
                  className="rounded px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-50"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
          {inlineSurface.phase === "ask" ? (
            <form
              className="flex min-w-[18rem] items-end gap-1 p-1"
              onSubmit={(event) => {
                event.preventDefault();
                void runInlineAction("ask", inlineSurface.focus, inlineSurface.question);
              }}
            >
              <textarea
                autoFocus
                data-testid="jupyter-inline-ask-input"
                value={inlineSurface.question}
                onChange={(event) => setInlineSurface((current) => current ? { ...current, question: event.target.value } : current)}
                placeholder="Ask about this code…"
                rows={2}
                className="min-h-14 flex-1 resize-none rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="submit"
                size="icon-sm"
                disabled={!inlineSurface.question.trim()}
                aria-label="Send inline question"
                data-testid="jupyter-inline-ask-send"
              >
                <Send className="size-3.5" />
              </Button>
            </form>
          ) : null}
          {inlineSurface.phase === "fix-hint" ? (
            <form
              className="flex min-w-[18rem] items-end gap-1 p-1"
              onSubmit={(event) => {
                event.preventDefault();
                void runInlineAction("fix", inlineSurface.focus, inlineSurface.question, { skipHintPrompt: true });
              }}
            >
              <textarea
                autoFocus
                data-testid="jupyter-inline-fix-hint-input"
                value={inlineSurface.question}
                onChange={(event) => setInlineSurface((current) => current ? { ...current, question: event.target.value } : current)}
                placeholder="What should I fix? (optional)"
                rows={2}
                className="min-h-14 flex-1 resize-none rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="submit"
                size="icon-sm"
                aria-label="Send fix request"
                data-testid="jupyter-inline-fix-hint-send"
              >
                <Send className="size-3.5" />
              </Button>
            </form>
          ) : null}
          {inlineSurface.phase === "stream" ? (
            // SN-253: the chip becomes a live conversation for this turn —
            // the owner's comment, the answer as it streams in, and a status
            // line. It dismisses itself once the code lands in the cell.
            <div
              className="flex min-w-[18rem] max-w-[28rem] flex-col gap-2 p-2"
              data-testid="jupyter-inline-stream"
              aria-live="polite"
            >
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs font-medium text-muted-foreground">
                  {inlineSurface.streamPrompt}
                </p>
                <button
                  type="button"
                  onClick={dismissInlineSurface}
                  aria-label="Cancel inline AI turn"
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {inlineSurface.streamText ? (
                <p
                  data-testid="jupyter-inline-stream-text"
                  className="max-h-48 min-w-0 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground"
                >
                  {inlineSurface.streamText}
                </p>
              ) : null}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin text-accent" />
                <span data-testid="jupyter-inline-stream-status">{inlineSurface.streamStatus}</span>
              </div>
            </div>
          ) : null}
          {inlineSurface.phase === "working" || inlineSurface.phase === "applying" ? (
            <div className="flex min-w-[12rem] items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground" data-testid="jupyter-inline-working">
              <LoaderCircle className="size-3.5 animate-spin text-accent" />
              {inlineSurface.phase === "applying" ? "Applying to cell…" : "Working…"}
            </div>
          ) : null}
          {inlineSurface.phase === "answer" ? (
            <div className="min-w-[18rem] max-w-[28rem] space-y-2 p-2" data-testid="jupyter-inline-answer">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{inlineSurface.answer}</p>
                <button type="button" onClick={dismissInlineSurface} aria-label="Close inline answer" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
              {inlineSurface.action === "comment-answer" ? (
                // SN-254: prose/give-up stays visible; Companion owns deeper follow-up.
                // Bubble remains a disposable turn — no multi-turn chat here.
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    data-testid="jupyter-inline-ask-in-companion"
                    onClick={handoffAnswerCommentToCompanion}
                  >
                    Ask in Companion
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="jupyter-inline-answer-retry"
                    onClick={retryInlineAction}
                  >
                    <RotateCw className="size-3.5" />
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {inlineSurface.phase === "error" ? (
            <div className="flex min-w-[18rem] flex-col gap-2 p-2" data-testid="jupyter-inline-error">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs text-destructive">{inlineSurface.error}</p>
                <button type="button" onClick={dismissInlineSurface} aria-label="Close inline AI error" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
              {inlineSurface.action ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="jupyter-inline-error-retry"
                    onClick={retryInlineAction}
                  >
                    <RotateCw className="size-3.5" />
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

export default JupyterNotebookView;
