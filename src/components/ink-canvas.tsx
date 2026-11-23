"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ChevronRight, Eraser, FilePlus, Fingerprint, Grid2X2, Maximize2, Menu, Minimize2, MousePointer2, PenLine, Printer, Redo2, Undo2 } from "lucide-react";
import type { InkBackgroundMode } from "@/lib/api/ink";
import { MusicStaff, MUSIC_PAPER_HEIGHT, MUSIC_PAPER_WIDTH } from "@/components/music-staff";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { registerReloadDrain } from "@/lib/reload-guard";
import { InkEngineSurface } from "@/components/ink-engine-surface";
import { INK_COLORS, inkDocumentsMatch, type InkColor, type InkDocument, type InkEngine, type InkScene, type InkSize } from "@/lib/ink-engine";
import { DEFAULT_INK_ENGINE, type AvailableInkEngineId } from "@/lib/ink-engine-preference";
import { inkSidecars } from "@/lib/ink-engine-sidecars";
import { countSmartNotesStrokes } from "@/lib/ink-engine/scene";
import { clampEditorZoom, EDITOR_ZOOM_DEFAULT } from "@/lib/editor-workspace-zoom";

function readMusicTouch(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  if (!second) return { x: first.clientX, y: first.clientY, distance: 0 };
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
    distance: Math.max(1, Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)),
  };
}

const AUTOSAVE_DELAY_MS = 1200;

/** Draw-shape count for draw-mode-debug evidence (never logs shape content). */
function countDrawShapes(snapshot: unknown): number {
  const strokeCount = countSmartNotesStrokes(snapshot);
  if (strokeCount != null) return strokeCount;
  const store = (snapshot as { document?: { store?: Record<string, { typeName?: string; type?: string }> } } | null)
    ?.document?.store;
  return Object.values(store ?? {}).filter((record) => record.typeName === "shape" && record.type === "draw").length;
}

export interface InkCanvasHandle {
  flush: () => Promise<void>;
  flushPending: () => Promise<void>;
}

export interface InkCanvasProps {
  pagePath: string;
  inkEngine?: AvailableInkEngineId;
  handleRef?: React.Ref<InkCanvasHandle>;
  title?: string;
  onOpenSidebar?: () => void;
  onSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  /** Raw ink sidecar JSON to render instead of fetching live scene. */
  previewSidecarJson?: string;
  /** View-only mode — no autosave or drawing tools. */
  readOnly?: boolean;
  music?: boolean;
  /** SN-417: ordered list of sibling music pages in this song (including the current page). */
  musicSiblings?: Array<{ path: string; title: string }>;
  /** SN-417: 0-based index of this page in musicSiblings. */
  musicPageIndex?: number;
  /** SN-417: create the next page in this song immediately after the current one. */
  onAddMusicPage?: () => void;
  /** SN-417: navigate to another page in this song. */
  onNavigateMusicPage?: (pagePath: string) => void;
  musicPlaying?: boolean;
  onMusicPlayingChange?: (playing: boolean) => void;
}

const InkCanvasInner = React.forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvasInner(
  { pagePath, inkEngine = DEFAULT_INK_ENGINE, handleRef, title, onOpenSidebar, onSaveStatusChange, previewSidecarJson, readOnly = false, music = false, musicSiblings, musicPageIndex, onAddMusicPage, onNavigateMusicPage, musicPlaying = false, onMusicPlayingChange },
  ref
) {
  const sidecar = inkSidecars[inkEngine].note;
  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [snapshot, setSnapshot] = React.useState<InkScene>(undefined);
  const [backgroundMode, setBackgroundMode] = React.useState<InkBackgroundMode>("blank");
  const backgroundModeRef = React.useRef<InkBackgroundMode>("blank");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeRef = React.useRef<Promise<void> | null>(null);
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBackgroundRef = React.useRef<InkBackgroundMode>("blank");
  const savedDocumentRef = React.useRef<InkDocument | null>(null);
  const editorRef = React.useRef<InkEngine | null>(null);
  const musicViewportRef = React.useRef<HTMLDivElement | null>(null);
  const musicInkRef = React.useRef<HTMLDivElement | null>(null);
  const [musicFitScale, setMusicFitScale] = React.useState(1);
  const [musicPrinting, setMusicPrinting] = React.useState(false);
  // SN-tablet-pinch: a tablet has no scroll bar and no Ctrl+wheel, so a music
  // page (taller than one screen, auto-fit to width) had no way to see more
  // of it or zoom in on touch. This is a user-driven multiplier on top of the
  // auto-fit scale, independent of musicFitScale, reset per page/mode.
  const [musicUserZoom, setMusicUserZoom] = React.useState(EDITOR_ZOOM_DEFAULT);
  const musicUserZoomRef = React.useRef(musicUserZoom);
  musicUserZoomRef.current = musicUserZoom;
  // Print always lays the paper out at 1:1 A4, whatever the on-screen fit is.
  const musicScale = musicPrinting ? 1 : musicFitScale * musicUserZoom;
  const musicScaleRef = React.useRef(musicScale);
  musicScaleRef.current = musicScale;
  const [musicFullscreen, setMusicFullscreen] = React.useState(false);
  const [musicTool, setMusicTool] = React.useState<"select" | "draw" | "eraser">("draw");
  const [musicFingerInk, setMusicFingerInk] = React.useState(false);
  const [musicColor, setMusicColor] = React.useState<InkColor>("black");
  const [musicSize, setMusicSize] = React.useState<InkSize>("m");
  const smartNotes = inkEngine === "smart-notes";
  const musicColors = smartNotes ? INK_COLORS : INK_COLORS.slice(0, 3);

  const changeMusicTool = (tool: "select" | "draw" | "eraser") => {
    setMusicTool(tool);
    editorRef.current?.setTool(tool);
  };
  const changeMusicColor = (color: InkColor) => {
    setMusicColor(color);
    editorRef.current?.setColor(color);
  };
  const changeMusicSize = (size: InkSize) => {
    setMusicSize(size);
    editorRef.current?.setSize(size);
  };

  React.useEffect(() => {
    if (!music || !musicViewportRef.current) return;
    const viewport = musicViewportRef.current;
    const update = () => {
      // A temporarily hidden PWA viewport can report zero width while its
      // sheet or browser chrome settles. Keep the last usable paper scale.
      const padding = window.getComputedStyle(viewport);
      const width = viewport.clientWidth - parseFloat(padding.paddingLeft || "0") - parseFloat(padding.paddingRight || "0");
      const height = viewport.clientHeight - parseFloat(padding.paddingTop || "0") - parseFloat(padding.paddingBottom || "0");
      if (width > 0 && (!musicPlaying || height > 0)) {
        setMusicFitScale(Math.min(1, width / MUSIC_PAPER_WIDTH, musicPlaying ? height / MUSIC_PAPER_HEIGHT : 1));
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    update();
    return () => observer.disconnect();
  }, [music, musicFullscreen, musicPlaying, snapshot]);

  React.useEffect(() => {
    if (!music) return;
    // flushSync so the 1:1 layout and camera are committed before the browser snapshots the print.
    const setPrinting = (value: boolean) => flushSync(() => setMusicPrinting(value));
    const onBeforePrint = () => setPrinting(true);
    const onAfterPrint = () => setPrinting(false);
    const query = window.matchMedia?.("print");
    const onQueryChange = (event: MediaQueryListEvent) => setPrinting(event.matches);
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    query?.addEventListener?.("change", onQueryChange);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
      query?.removeEventListener?.("change", onQueryChange);
    };
  }, [music]);

  // The ink layer is never CSS-transformed (tldraw maps pointers from its untransformed
  // bounding box), so the paper scale is applied as camera zoom instead. That keeps
  // stored stroke coordinates in 1:1 paper space at every viewport width.
  React.useLayoutEffect(() => {
    if (!music) return;
    editorRef.current?.setCamera({ x: 0, y: 0, z: musicScale }, { force: true });
  }, [music, musicScale]);

  // SN-tablet-pinch: a mode switch or a new page gets a fresh fit, not a
  // carried-over zoom from whatever the owner was looking at before.
  React.useEffect(() => {
    setMusicUserZoom(EDITOR_ZOOM_DEFAULT);
  }, [pagePath, musicFullscreen, musicPlaying]);

  // Navigate the scroll viewport for both engines. Staff and ink keep the
  // same paper scale and the engine camera stays locked to the paper origin.
  React.useEffect(() => {
    if (!music) return;
    const viewport = musicViewportRef.current;
    const paper = viewport?.querySelector<HTMLElement>(".music-page__scaled");
    if (!viewport || !paper) return;
    const fingerInk = musicFingerInk && !readOnly && !musicPlaying;
    let penPointerId: number | null = null;
    let anchor: ReturnType<typeof readMusicTouch> | null = null;
    let pinchStartDistance = 0;
    let pinchStartZoom = EDITOR_ZOOM_DEFAULT;

    const isControl = (event: Event) => event.target instanceof Element &&
      Boolean(event.target.closest("button, [data-sn-ink-controls]"));
    const rebase = (touches: TouchList) => {
      anchor = touches.length ? readMusicTouch(touches) : null;
      pinchStartDistance = anchor?.distance ?? 0;
      pinchStartZoom = musicUserZoomRef.current;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isControl(event)) return;
      if (event.pointerType === "pen") {
        penPointerId = event.pointerId;
        anchor = null;
      }
      if (event.pointerType !== "touch") return;
      if (!fingerInk || penPointerId !== null || anchor) {
        event.stopPropagation();
      } else {
        editorRef.current?.allowFingerInput?.();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !isControl(event) && (!fingerInk || penPointerId !== null || anchor)) {
        event.stopPropagation();
      }
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId === penPointerId) penPointerId = null;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (isControl(event) || (fingerInk && event.touches.length === 1 && penPointerId === null)) return;
      event.preventDefault();
      event.stopPropagation();
      if (penPointerId !== null) return;
      if (fingerInk && !anchor) editorRef.current?.cancel();
      rebase(event.touches);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!anchor || !event.touches.length) return;
      event.preventDefault();
      event.stopPropagation();
      const next = readMusicTouch(event.touches);
      const currentZoom = musicUserZoomRef.current;
      const nextZoom = pinchStartDistance && next.distance
        ? clampEditorZoom(pinchStartZoom * next.distance / pinchStartDistance)
        : currentZoom;
      if (nextZoom === currentZoom) {
        viewport.scrollLeft += anchor.x - next.x;
        viewport.scrollTop += anchor.y - next.y;
      } else {
        const before = paper.getBoundingClientRect();
        // Commit the scale before scrolling so the new extent is available.
        flushSync(() => setMusicUserZoom(nextZoom));
        const after = paper.getBoundingClientRect();
        const ratio = nextZoom / currentZoom;
        viewport.scrollLeft += after.left + (anchor.x - before.left) * ratio - next.x;
        viewport.scrollTop += after.top + (anchor.y - before.top) * ratio - next.y;
      }
      anchor = next;
    };
    const onTouchEnd = (event: TouchEvent) => {
      // Rebase when either finger lifts so the remaining finger can keep panning.
      if (anchor) rebase(event.touches);
    };
    viewport.addEventListener("pointerdown", onPointerDown, true);
    viewport.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    viewport.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    viewport.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    viewport.addEventListener("touchend", onTouchEnd, true);
    viewport.addEventListener("touchcancel", onTouchEnd, true);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown, true);
      viewport.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      viewport.removeEventListener("touchstart", onTouchStart, true);
      viewport.removeEventListener("touchmove", onTouchMove, true);
      viewport.removeEventListener("touchend", onTouchEnd, true);
      viewport.removeEventListener("touchcancel", onTouchEnd, true);
    };
    // snapshot: .music-page__viewport doesn't exist in the DOM yet on the
    // first render (the component returns a loading placeholder until the
    // scene loads), so musicViewportRef.current is still null the one time
    // an effect keyed on `music` alone would run. Re-run once the real
    // branch (and the ref) mounts, matching the ResizeObserver effect above.
  }, [music, musicFingerInk, musicPlaying, readOnly, snapshot]);

  React.useEffect(() => {
    if (!musicFullscreen && !musicPlaying) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (musicPlaying) onMusicPlayingChange?.(false);
      setMusicFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [musicFullscreen, musicPlaying, onMusicPlayingChange]);

  React.useLayoutEffect(() => {
    editorRef.current?.setReadOnly(readOnly || musicPlaying);
    if (musicInkRef.current) musicInkRef.current.inert = musicPlaying;
  }, [readOnly, musicPlaying, snapshot]);

  // Load scene + backgroundMode once per pagePath or preview payload.
  React.useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);

    const load = previewSidecarJson === undefined
      ? sidecar.load(pagePath)
      : Promise.resolve(sidecar.parse(previewSidecarJson));
    load
      .then(({ scene, backgroundMode: mode }) => {
        if (!cancelled) {
          logDrawEvent("ink.scene-load", { path: pagePath, shapes: countDrawShapes(scene) });
          backgroundModeRef.current = mode;
          setBackgroundMode(mode);
          setSnapshot(scene ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null);
      });

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [pagePath, previewSidecarJson, sidecar]);

  const clearAutosave = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const writeScene = React.useCallback(async (trigger: "autosave" | "background" | "flush") => {
    if (writeRef.current) return writeRef.current;
    const editor = editorRef.current;
    if (!editor) return;

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    onSaveStatusChange?.("saving");
    setSaveStatus("saving");

    const snap = editor.getScene();
    const document = editor.getDocument();
    const mode = backgroundModeRef.current;
    const write = sidecar.save(pagePath, snap, mode)
      .then(() => {
        savedDocumentRef.current = document;
        savedBackgroundRef.current = mode;
        logDrawEvent("ink.save", { path: pagePath, trigger, shapes: countDrawShapes(snap), ok: true });
        onSaveStatusChange?.("saved");
        setSaveStatus("saved");
        if (trigger !== "flush" && editorRef.current) {
          idleTimerRef.current = setTimeout(() => {
            onSaveStatusChange?.("idle");
            setSaveStatus("idle");
          }, AUTOSAVE_DELAY_MS);
        }
      })
      .catch(() => {
        logDrawEvent("ink.save", { path: pagePath, trigger, shapes: countDrawShapes(snap), ok: false });
        onSaveStatusChange?.("error");
        setSaveStatus("error");
        throw new Error("Failed to save ink scene.");
      })
      .finally(() => { writeRef.current = null; });
    writeRef.current = write;
    return write;
  }, [onSaveStatusChange, pagePath, sidecar]);

  const hasUnsavedDocument = React.useCallback(() => {
    const editor = editorRef.current;
    const saved = savedDocumentRef.current;
    if (!editor || !saved) return false;
    // Tldraw batches store listener notifications to animation frames. Inspect
    // the live immutable records before a navigation or reload can unmount them.
    return !inkDocumentsMatch(editor.getDocument(), saved);
  }, []);

  const flushPending = React.useCallback(async (trigger: "autosave" | "background" | "flush" = "flush") => {
    if (readOnly || previewSidecarJson !== undefined) return;
    clearAutosave();
    while (editorRef.current && (
      writeRef.current || hasUnsavedDocument() || savedBackgroundRef.current !== backgroundModeRef.current
    )) {
      await writeScene(trigger);
      clearAutosave();
    }
  }, [clearAutosave, hasUnsavedDocument, previewSidecarJson, readOnly, writeScene]);

  const flushSave = React.useCallback(async () => {
    if (readOnly || previewSidecarJson !== undefined) return;
    await writeScene("flush");
    await flushPending();
  }, [flushPending, previewSidecarJson, readOnly, writeScene]);

  const buildHandle = React.useCallback(() => ({ flush: flushSave, flushPending }), [flushSave, flushPending]);
  React.useImperativeHandle(ref, buildHandle, [buildHandle]);
  // next/dynamic does not forward refs. Keep the direct ref for static mounts.
  React.useImperativeHandle(handleRef, buildHandle, [buildHandle]);

  const scheduleSave = React.useCallback(() => {
    clearAutosave();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushPending("autosave").catch(() => {});
    }, AUTOSAVE_DELAY_MS);
  }, [clearAutosave, flushPending]);

  // SN-416: a PWA worker update reloads the page. Flush a debounced or
  // in-flight autosave first so the last strokes are not discarded.
  React.useEffect(() => {
    if (readOnly || previewSidecarJson !== undefined) return;
    return registerReloadDrain(async () => {
      const dirty = !!writeRef.current || hasUnsavedDocument() || savedBackgroundRef.current !== backgroundModeRef.current;
      logDrawEvent("ink.reload-drain", { path: pagePath, dirty });
      if (dirty) {
        await flushPending();
      }
    });
  }, [flushPending, hasUnsavedDocument, pagePath, previewSidecarJson, readOnly]);

  const handleGridToggle = React.useCallback(() => {
    const next = backgroundModeRef.current === "blank" ? "grid" : "blank";
    backgroundModeRef.current = next;
    setBackgroundMode(next);
    editorRef.current?.setGridVisible(next === "grid");
    void flushPending("background").catch(() => {});
  }, [flushPending]);

  const handleMount = React.useCallback(
    (editor: InkEngine) => {
      editorRef.current = editor;
      if (music) {
        editor.setCamera({ x: 0, y: 0, z: musicScaleRef.current });
        editor.lockCamera();
        if (!readOnly) {
          editor.setTool("draw");
          editor.setColor("black");
          editor.setSize("m");
        }
      }
      editor.setGridVisible(!music && backgroundModeRef.current === "grid");
      editor.setReadOnly(readOnly || musicPlaying);
      savedDocumentRef.current = editor.getDocument();
      savedBackgroundRef.current = backgroundModeRef.current;
      // Listen only to user-originated document changes for autosave.
      const cleanup = readOnly || previewSidecarJson !== undefined ? undefined : editor.subscribe(scheduleSave);
      return () => {
        cleanup?.();
        if (editorRef.current === editor) editorRef.current = null;
      };
    },
    [music, musicPlaying, previewSidecarJson, readOnly, scheduleSave]
  );

  const saveLabel =
    readOnly ? "Read-only version" :
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved"  ? "Saved"   :
    saveStatus === "error"  ? "Save error" : "";

  if (snapshot === undefined && !musicPlaying) {
    return (
      <div className="flex h-full w-full flex-col">
        <InkOverlayBar
          title={title}
          saveLabel={saveLabel}
          backgroundMode={backgroundMode}
          onOpenSidebar={onOpenSidebar}
        />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading canvas…
        </div>
      </div>
    );
  }


  const hasMusicSiblings = !!musicSiblings && musicSiblings.length > 1 && musicPageIndex !== undefined && musicPageIndex >= 0;
  const previousMusicPage = hasMusicSiblings ? musicSiblings[musicPageIndex - 1] : undefined;
  const nextMusicPage = hasMusicSiblings ? musicSiblings[musicPageIndex + 1] : undefined;

  if (music) {
    return (
      <div className={`music-page ${musicFullscreen || musicPlaying ? "music-page--fullscreen" : ""} ${musicPlaying ? "music-page--playing" : ""}`} data-testid="music-page">
        <div className="music-page__bar" data-print-chrome="true">
          {!musicPlaying && <button type="button" onClick={onOpenSidebar} aria-label="Open sidebar"><Menu className="size-4" /></button>}
          {hasMusicSiblings && !musicPlaying && (
            <button
              type="button"
              aria-label="Previous page"
              data-testid="music-prev-page"
              disabled={!previousMusicPage}
              onClick={() => { if (previousMusicPage) onNavigateMusicPage?.(previousMusicPage.path); }}
            ><ChevronLeft className="size-4" /></button>
          )}
          <span className="music-page__name">{title || "Untitled music page"}</span>
          <span className="music-page__spacer" />
          {saveLabel && <span className="music-page__status">{saveLabel}</span>}
          {hasMusicSiblings && (
            <span className="music-page__page-indicator" aria-label={`Page ${musicPageIndex + 1} of ${musicSiblings.length}`}>{musicPageIndex + 1}/{musicSiblings.length}</span>
          )}
          {hasMusicSiblings && !musicPlaying && (
            <button
              type="button"
              aria-label="Next page"
              data-testid="music-next-page"
              disabled={!nextMusicPage}
              onClick={() => { if (nextMusicPage) onNavigateMusicPage?.(nextMusicPage.path); }}
            ><ChevronRight className="size-4" /></button>
          )}
          {onMusicPlayingChange && (
            <button type="button" className="music-page__play" onClick={async () => {
              if (musicPlaying) {
                onMusicPlayingChange(false);
                return;
              }
              try {
                await flushPending();
                onMusicPlayingChange(true);
              } catch {
                // The save status is already visible. Keep the editing canvas open.
              }
            }}>
              {musicPlaying ? "Exit play mode" : "Play mode"}
            </button>
          )}
          {!musicPlaying && <button type="button" onClick={() => setMusicFullscreen((value) => !value)} aria-label={musicFullscreen ? "Exit full screen" : "Full screen"} data-testid="music-fullscreen-toggle">
            {musicFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>}
          {!musicPlaying && <button type="button" onClick={() => { void flushPending().then(() => window.print()).catch(() => {}); }} aria-label="Print music page" data-testid="music-print"><Printer className="size-4" /></button>}
        </div>
        <div className="music-page__viewport" ref={musicViewportRef}>
          <div className="music-page__scaled" style={{ width: MUSIC_PAPER_WIDTH * musicScale, height: MUSIC_PAPER_HEIGHT * musicScale }}>
            <div className="music-page__paper" style={{ transform: `scale(${musicScale})` }}>
              <MusicStaff title={title} />
            </div>
            {/* Fullscreen and scrolling can move the paper between tldraw's bounds updates. */}
            <div
              className="music-page__ink"
              ref={musicInkRef}
              onPointerDownCapture={(event) => editorRef.current?.updateViewport(event.currentTarget)}
            >
              {snapshot !== undefined && <InkEngineSurface
                key={previewSidecarJson ?? pagePath}
                engine={inkEngine}
                variant="music"
                scene={snapshot ?? undefined}
                onMount={handleMount}
              />}
            </div>
          </div>
          {!readOnly && !musicPlaying && onAddMusicPage && (
            <div className="music-page__add-row" data-print-chrome="true">
              <button type="button" className="music-page__add-btn" onClick={onAddMusicPage} aria-label="Add next page" data-testid="music-add-page">
                <FilePlus className="size-4" aria-hidden />
                Add next page
              </button>
            </div>
          )}
        </div>
        {musicPlaying && hasMusicSiblings && onNavigateMusicPage && (
          <MusicPageTurns previous={previousMusicPage?.path} next={nextMusicPage?.path} onNavigate={onNavigateMusicPage} />
        )}
        {!readOnly && !musicPlaying && <div className="music-page__dock" role="toolbar" aria-label="Music ink tools" data-print-chrome="true">
          <button type="button" aria-label="Select" aria-pressed={musicTool === "select"} onClick={() => changeMusicTool("select")}><MousePointer2 className="size-4" /></button>
          <button type="button" aria-label="Pen" aria-pressed={musicTool === "draw"} onClick={() => changeMusicTool("draw")}><PenLine className="size-4" /></button>
          <button type="button" aria-label="Eraser" aria-pressed={musicTool === "eraser"} onClick={() => changeMusicTool("eraser")}><Eraser className="size-4" /></button>
          <button type="button" aria-label="Draw with finger" title="Draw with finger" aria-pressed={musicFingerInk} onClick={() => setMusicFingerInk((enabled) => !enabled)}><Fingerprint className="size-4" /></button>
          <span className="music-page__dock-separator" />
          {musicColors.map(({ id, hex }) => <button type="button" key={id} aria-label={`${id} ink`} aria-pressed={musicColor === id} onClick={() => changeMusicColor(id)}><span className={`music-page__color music-page__color--${id}`} style={smartNotes ? { backgroundColor: hex } : undefined} /></button>)}
          <select aria-label="Pen thickness" value={musicSize} onChange={(event) => changeMusicSize(event.target.value as InkSize)}>
            <option value="s">Thin</option><option value="m">Medium</option><option value="l">Thick</option>
            {smartNotes && <option value="xl">Extra thick</option>}
          </select>
          <button type="button" aria-label="Undo" onClick={() => editorRef.current?.undo()}><Undo2 className="size-4" /></button>
          <button type="button" aria-label="Redo" onClick={() => editorRef.current?.redo()}><Redo2 className="size-4" /></button>
        </div>}
      </div>
    );
  }

  return (
    <div className="ink-canvas-host relative flex h-full w-full flex-col">
      <InkOverlayBar
        title={title}
        saveLabel={saveLabel}
        backgroundMode={backgroundMode}
        onOpenSidebar={onOpenSidebar}
        onGridToggle={readOnly || previewSidecarJson !== undefined ? undefined : handleGridToggle}
      />
      {/* Use absolute positioning so Tldraw gets concrete pixel dimensions immediately,
          avoiding the flex-1 resolution race that can cause its ResizeObserver to fire
          before the parent height is established — which breaks toolbar breakpoint detection. */}
      <div className="relative flex-1">
        <div className="absolute inset-0">
          <InkEngineSurface
            key={previewSidecarJson ?? pagePath}
            engine={inkEngine}
            variant="note"
            scene={snapshot ?? undefined}
            onMount={handleMount}
            grid={backgroundMode === "grid"}
          />
        </div>
      </div>
    </div>
  );
});

function MusicPageTurns({ previous, next, onNavigate }: { previous?: string; next?: string; onNavigate: (path: string) => void }) {
  const pointer = React.useRef<{ id: number; x: number; y: number; cancelled: boolean } | null>(null);
  return (
    <nav
      className="music-page__turns"
      aria-label="Turn music page"
      data-print-chrome="true"
      onPointerDown={(event) => {
        if (!event.isPrimary) {
          if (pointer.current) pointer.current.cancelled = true;
          return;
        }
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, cancelled: false };
      }}
      onPointerMove={(event) => {
        const start = pointer.current;
        if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
          start.cancelled = true;
        }
      }}
      onPointerCancel={(event) => {
        if (pointer.current?.id === event.pointerId) pointer.current.cancelled = true;
      }}
      onPointerLeave={(event) => {
        // Touch sends pointerleave before its synthesized click, even for a valid tap.
        if (event.pointerType === "mouse" && event.buttons !== 0 && pointer.current) {
          pointer.current.cancelled = true;
        }
      }}
    >
      <button type="button" disabled={!previous} onClick={(event) => {
        if (previous && (event.detail === 0 || !pointer.current?.cancelled)) onNavigate(previous);
      }}>
        <ChevronLeft aria-hidden="true" /> Previous page
      </button>
      <button type="button" disabled={!next} onClick={(event) => {
        if (next && (event.detail === 0 || !pointer.current?.cancelled)) onNavigate(next);
      }}>
        Next page <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  );
}

function InkOverlayBar({
  title,
  saveLabel,
  backgroundMode,
  onOpenSidebar,
  onGridToggle,
}: {
  title?: string;
  saveLabel: string;
  backgroundMode: InkBackgroundMode;
  onOpenSidebar?: () => void;
  onGridToggle?: () => void;
}) {
  return (
    <div
      data-testid="ink-overlay-bar"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-2 backdrop-blur-sm"
    >
      <button
        data-testid="ink-sidebar-toggle"
        onClick={onOpenSidebar}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open sidebar"
      >
        <Menu className="size-4" />
      </button>
      <PenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {title && (
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {title}
        </span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {saveLabel && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {saveLabel}
          </span>
        )}
        {onGridToggle ? (
        <button
          data-testid="ink-grid-toggle"
          onClick={onGridToggle}
          className={[
            "flex h-7 w-7 items-center justify-center rounded transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            backgroundMode === "grid"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-surface hover:text-foreground",
          ].join(" ")}
          aria-label={backgroundMode === "grid" ? "Hide grid" : "Show grid"}
          aria-pressed={backgroundMode === "grid"}
        >
          <Grid2X2 className="size-4" />
        </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A standalone Ink Note or Music page owns one editor and save lifecycle.
 */
export const InkCanvas = React.forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvas(
  { pagePath, inkEngine, handleRef, title, onOpenSidebar, onSaveStatusChange, previewSidecarJson, readOnly, music, musicSiblings, musicPageIndex, onAddMusicPage, onNavigateMusicPage, musicPlaying, onMusicPlayingChange },
  ref
) {
  return (
    <InkCanvasInner
      key={`${inkEngine ?? DEFAULT_INK_ENGINE}:${pagePath}:${previewSidecarJson === undefined ? "live" : "preview"}`}
      ref={ref}
      handleRef={handleRef}
      inkEngine={inkEngine}
      pagePath={pagePath}
      title={title}
      onOpenSidebar={onOpenSidebar}
      onSaveStatusChange={onSaveStatusChange}
      previewSidecarJson={previewSidecarJson}
      readOnly={readOnly}
      music={music}
      musicSiblings={musicSiblings}
      musicPageIndex={musicPageIndex}
      onAddMusicPage={onAddMusicPage}
      onNavigateMusicPage={onNavigateMusicPage}
      musicPlaying={musicPlaying}
      onMusicPlayingChange={onMusicPlayingChange}
    />
  );
});
