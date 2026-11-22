"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { Tldraw, DefaultColorStyle, DefaultSizeStyle, type Editor, type TLStoreSnapshot, type TLGridProps, type TLDefaultColorStyle } from "tldraw";
import "tldraw/tldraw.css";
import { Eraser, Grid2X2, Maximize2, Menu, Minimize2, MousePointer2, PenLine, Printer, Redo2, Undo2 } from "lucide-react";
import { fetchInkScene, parseInkSidecarJson, saveInkScene, type InkBackgroundMode } from "@/lib/api/ink";
import { MusicStaff, MUSIC_PAPER_HEIGHT, MUSIC_PAPER_WIDTH } from "@/components/music-staff";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { registerReloadDrain } from "@/lib/reload-guard";

const AUTOSAVE_DELAY_MS = 1200;

/** Draw-shape count for draw-mode-debug evidence (never logs shape content). */
function countDrawShapes(snapshot: unknown): number {
  const store = (snapshot as { document?: { store?: Record<string, { typeName?: string; type?: string }> } } | null)
    ?.document?.store;
  return Object.values(store ?? {}).filter((record) => record.typeName === "shape" && record.type === "draw").length;
}

export interface InkCanvasHandle {
  flush: () => Promise<void>;
}

export interface InkCanvasProps {
  pagePath: string;
  title?: string;
  onOpenSidebar?: () => void;
  onSaveStatusChange?: (status: "idle" | "saving" | "saved" | "error") => void;
  /** Raw ink sidecar JSON to render instead of fetching live scene. */
  previewSidecarJson?: string;
  /** View-only mode — no autosave or drawing tools. */
  readOnly?: boolean;
  music?: boolean;
}

// Custom grid component: renders graph-paper style lines that pan and scale with the camera.
// Receives camera position (x, y), zoom (z), and base grid size (size) from TLDraw.
function InkGridLines({ x, y, z, size }: TLGridProps) {
  const id = React.useId();
  const minorS = Math.max(size * z * 5, 1);  // minor grid cell — 5 grid units in screen px
  const majorS = minorS * 5;                  // major grid cell — 25 grid units in screen px

  // Compute pattern phase: positive modulo of camera offset in screen coordinates
  const rawX = 0.5 + x * z;
  const rawY = 0.5 + y * z;
  const gxo = ((rawX % majorS) + majorS) % majorS;
  const gyo = ((rawY % majorS) + majorS) % majorS;

  return (
    <svg
      className="tl-grid"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Minor grid: thin lines every 5 grid units */}
        <pattern
          id={`${id}-minor`}
          width={minorS}
          height={minorS}
          patternUnits="userSpaceOnUse"
          x={gxo}
          y={gyo}
        >
          <path
            d={`M ${minorS} 0 L 0 0 0 ${minorS}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
            opacity="0.15"
          />
        </pattern>
        {/* Major grid: slightly bolder lines every 25 grid units */}
        <pattern
          id={`${id}-major`}
          width={majorS}
          height={majorS}
          patternUnits="userSpaceOnUse"
          x={gxo}
          y={gyo}
        >
          <path
            d={`M ${majorS} 0 L 0 0 0 ${majorS}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.28"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-minor)`} />
      <rect width="100%" height="100%" fill={`url(#${id}-major)`} />
    </svg>
  );
}

// components object is stable (defined outside React) so it doesn't cause re-renders.
const COMPONENTS_GRID = { PageMenu: null, Grid: InkGridLines } as const;
const COMPONENTS_BLANK = { PageMenu: null } as const;
const COMPONENTS_MUSIC = {
  PageMenu: null,
  MainMenu: null,
  MenuPanel: null,
  StylePanel: null,
  Toolbar: null,
  NavigationPanel: null,
  QuickActions: null,
  HelperButtons: null,
} as const;

const InkCanvasInner = React.forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvasInner(
  { pagePath, title, onOpenSidebar, onSaveStatusChange, previewSidecarJson, readOnly = false, music = false },
  ref
) {
  const [saveStatus, setSaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [snapshot, setSnapshot] = React.useState<TLStoreSnapshot | null | undefined>(undefined);
  const [backgroundMode, setBackgroundMode] = React.useState<InkBackgroundMode>("blank");
  const backgroundModeRef = React.useRef<InkBackgroundMode>("blank");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const editorRef = React.useRef<Editor | null>(null);
  const musicViewportRef = React.useRef<HTMLDivElement | null>(null);
  const [musicFitScale, setMusicFitScale] = React.useState(1);
  const [musicPrinting, setMusicPrinting] = React.useState(false);
  // Print always lays the paper out at 1:1 A4, whatever the on-screen fit is.
  const musicScale = musicPrinting ? 1 : musicFitScale;
  const musicScaleRef = React.useRef(musicScale);
  musicScaleRef.current = musicScale;
  const [musicFullscreen, setMusicFullscreen] = React.useState(false);
  const [musicTool, setMusicTool] = React.useState<"select" | "draw" | "eraser">("draw");
  const [musicColor, setMusicColor] = React.useState<TLDefaultColorStyle>("black");
  const [musicSize, setMusicSize] = React.useState<"s" | "m" | "l">("m");

  const changeMusicTool = (tool: "select" | "draw" | "eraser") => {
    setMusicTool(tool);
    editorRef.current?.setCurrentTool(tool);
  };
  const changeMusicColor = (color: TLDefaultColorStyle) => {
    setMusicColor(color);
    editorRef.current?.setStyleForNextShapes(DefaultColorStyle, color);
  };
  const changeMusicSize = (size: "s" | "m" | "l") => {
    setMusicSize(size);
    editorRef.current?.setStyleForNextShapes(DefaultSizeStyle, size);
  };

  React.useEffect(() => {
    if (!music || !musicViewportRef.current) return;
    const viewport = musicViewportRef.current;
    const update = () => setMusicFitScale(Math.min(1, viewport.clientWidth / MUSIC_PAPER_WIDTH));
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    update();
    return () => observer.disconnect();
  }, [music, musicFullscreen, snapshot]);

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
  React.useEffect(() => {
    if (!music) return;
    editorRef.current?.setCamera({ x: 0, y: 0, z: musicScale }, { force: true });
  }, [music, musicScale]);

  React.useEffect(() => {
    if (!musicFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMusicFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [musicFullscreen]);

  // Keep ref in sync with state so scheduleSave always captures the latest value.
  React.useEffect(() => {
    backgroundModeRef.current = backgroundMode;
  }, [backgroundMode]);

  // Load scene + backgroundMode once per pagePath or preview payload.
  React.useEffect(() => {
    let cancelled = false;
    setSnapshot(undefined);

    if (previewSidecarJson !== undefined) {
      const { scene, backgroundMode: mode } = parseInkSidecarJson(previewSidecarJson);
      setSnapshot((scene as TLStoreSnapshot | null) ?? null);
      setBackgroundMode(mode);
      backgroundModeRef.current = mode;
      return;
    }

    fetchInkScene(pagePath)
      .then(({ scene, backgroundMode: mode }) => {
        if (!cancelled) {
          logDrawEvent("ink.scene-load", { path: pagePath, shapes: countDrawShapes(scene) });
          setSnapshot((scene as TLStoreSnapshot | null) ?? null);
          setBackgroundMode(mode);
          backgroundModeRef.current = mode;
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
    };
  }, [pagePath, previewSidecarJson]);

  // Sync backgroundMode into TLDraw's isGridMode whenever it changes post-mount.
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateInstanceState({ isGridMode: backgroundMode === "grid" });
  }, [backgroundMode]);

  const flushSave = React.useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (savingRef.current) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!savingRef.current) {
            resolve();
            return;
          }
          window.setTimeout(check, 50);
        };
        check();
      });
    }

    savingRef.current = true;
    onSaveStatusChange?.("saving");
    setSaveStatus("saving");

    const snap = editor.getSnapshot();
    const mode = backgroundModeRef.current;
    try {
      await saveInkScene(pagePath, snap, mode);
      logDrawEvent("ink.save", { path: pagePath, trigger: "flush", shapes: countDrawShapes(snap), ok: true });
      onSaveStatusChange?.("saved");
      setSaveStatus("saved");
    } catch {
      logDrawEvent("ink.save", { path: pagePath, trigger: "flush", shapes: countDrawShapes(snap), ok: false });
      onSaveStatusChange?.("error");
      setSaveStatus("error");
      throw new Error("Failed to save ink scene.");
    } finally {
      savingRef.current = false;
      pendingRef.current = false;
    }
  }, [onSaveStatusChange, pagePath]);

  React.useImperativeHandle(ref, () => ({ flush: flushSave }), [flushSave]);

  const scheduleSave = React.useCallback(() => {
    if (readOnly) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const editor = editorRef.current;
      if (!editor) return;

      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }

      savingRef.current = true;
      onSaveStatusChange?.("saving");
      setSaveStatus("saving");

      const snap = editor.getSnapshot();
      const mode = backgroundModeRef.current;
      saveInkScene(pagePath, snap, mode)
        .then(() => {
          logDrawEvent("ink.save", { path: pagePath, trigger: "autosave", shapes: countDrawShapes(snap), ok: true });
          onSaveStatusChange?.("saved");
          setSaveStatus("saved");
          setTimeout(() => { onSaveStatusChange?.("idle"); setSaveStatus("idle"); }, 1200);
        })
        .catch(() => {
          logDrawEvent("ink.save", { path: pagePath, trigger: "autosave", shapes: countDrawShapes(snap), ok: false });
          onSaveStatusChange?.("error");
          setSaveStatus("error");
        })
        .finally(() => {
          savingRef.current = false;
          if (pendingRef.current) {
            pendingRef.current = false;
            scheduleSave();
          }
        });
    }, AUTOSAVE_DELAY_MS);
  }, [onSaveStatusChange, pagePath, readOnly]);

  // SN-416: a PWA worker update reloads the page. Flush a debounced or
  // in-flight autosave first so the last strokes are not discarded.
  React.useEffect(() => {
    if (readOnly || previewSidecarJson !== undefined) return;
    return registerReloadDrain(async () => {
      const dirty = Boolean(timerRef.current) || savingRef.current || pendingRef.current;
      logDrawEvent("ink.reload-drain", { path: pagePath, dirty });
      if (dirty) {
        await flushSave();
      }
    });
  }, [flushSave, pagePath, previewSidecarJson, readOnly]);

  // Save immediately (no debounce) — used when toggling background mode.
  const saveNow = React.useCallback((mode: InkBackgroundMode) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snap = editor.getSnapshot();
    saveInkScene(pagePath, snap, mode).catch(() => {/* silent — best-effort immediate save */});
  }, [pagePath]);

  const handleGridToggle = React.useCallback(() => {
    setBackgroundMode((prev) => {
      const next: InkBackgroundMode = prev === "blank" ? "grid" : "blank";
      backgroundModeRef.current = next;
      // Sync TLDraw's grid mode immediately so the visual updates before the async save.
      editorRef.current?.updateInstanceState({ isGridMode: next === "grid" });
      saveNow(next);
      return next;
    });
  }, [saveNow]);

  const handleMount = React.useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      if (music) {
        editor.setCamera({ x: 0, y: 0, z: musicScaleRef.current });
        editor.setCameraOptions({ isLocked: true, wheelBehavior: "none" });
        if (!readOnly) {
          editor.setCurrentTool("draw");
          editor.setStyleForNextShapes(DefaultColorStyle, "black");
          editor.setStyleForNextShapes(DefaultSizeStyle, "m");
        }
      }
      editor.updateInstanceState({
        isGridMode: backgroundModeRef.current === "grid",
        isReadonly: readOnly,
      });
      if (readOnly) {
        return;
      }
      // Listen only to user-originated document changes for autosave.
      const cleanup = editor.store.listen(
        () => { scheduleSave(); },
        { source: "user", scope: "document" }
      );
      return cleanup;
    },
    [music, readOnly, scheduleSave]
  );

  const saveLabel =
    readOnly ? "Read-only version" :
    saveStatus === "saving" ? "Saving…" :
    saveStatus === "saved"  ? "Saved"   :
    saveStatus === "error"  ? "Save error" : "";

  if (snapshot === undefined) {
    return (
      <div className="flex h-full w-full flex-col">
        <InkOverlayBar
          title={title}
          saveLabel={saveLabel}
          backgroundMode={backgroundMode}
          onOpenSidebar={onOpenSidebar}
          onGridToggle={readOnly || music ? undefined : handleGridToggle}
        />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading canvas…
        </div>
      </div>
    );
  }

  const components = music ? COMPONENTS_MUSIC : backgroundMode === "grid" ? COMPONENTS_GRID : COMPONENTS_BLANK;

  if (music) {
    return (
      <div className={`music-page ${musicFullscreen ? "music-page--fullscreen" : ""}`} data-testid="music-page">
        <div className="music-page__bar" data-print-chrome="true">
          <button type="button" onClick={onOpenSidebar} aria-label="Open sidebar"><Menu className="size-4" /></button>
          <span className="music-page__name">{title || "Untitled music page"}</span>
          {saveLabel && <span className="music-page__status">{saveLabel}</span>}
          <button type="button" onClick={() => setMusicFullscreen((value) => !value)} aria-label={musicFullscreen ? "Exit full screen" : "Full screen"} data-testid="music-fullscreen-toggle">
            {musicFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
          <button type="button" onClick={() => { void flushSave().then(() => window.print()); }} aria-label="Print music page" data-testid="music-print"><Printer className="size-4" /></button>
        </div>
        <div className="music-page__viewport" ref={musicViewportRef}>
          <div className="music-page__scaled" style={{ width: MUSIC_PAPER_WIDTH * musicScale, height: MUSIC_PAPER_HEIGHT * musicScale }}>
            <div className="music-page__paper" style={{ transform: `scale(${musicScale})` }}>
              <MusicStaff title={title} />
            </div>
            <div className="music-page__ink">
              <Tldraw key={previewSidecarJson ?? pagePath} snapshot={snapshot ?? undefined} onMount={handleMount} components={components} />
            </div>
          </div>
        </div>
        {!readOnly && <div className="music-page__dock" role="toolbar" aria-label="Music ink tools" data-print-chrome="true">
          <button type="button" aria-label="Select" aria-pressed={musicTool === "select"} onClick={() => changeMusicTool("select")}><MousePointer2 className="size-4" /></button>
          <button type="button" aria-label="Pen" aria-pressed={musicTool === "draw"} onClick={() => changeMusicTool("draw")}><PenLine className="size-4" /></button>
          <button type="button" aria-label="Eraser" aria-pressed={musicTool === "eraser"} onClick={() => changeMusicTool("eraser")}><Eraser className="size-4" /></button>
          <span className="music-page__dock-separator" />
          {(["black", "blue", "red"] as const).map((color) => <button type="button" key={color} aria-label={`${color} ink`} aria-pressed={musicColor === color} onClick={() => changeMusicColor(color)}><span className={`music-page__color music-page__color--${color}`} /></button>)}
          <select aria-label="Pen thickness" value={musicSize} onChange={(event) => changeMusicSize(event.target.value as "s" | "m" | "l")}>
            <option value="s">Thin</option><option value="m">Medium</option><option value="l">Thick</option>
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
        onGridToggle={readOnly ? undefined : handleGridToggle}
      />
      {/* Use absolute positioning so Tldraw gets concrete pixel dimensions immediately,
          avoiding the flex-1 resolution race that can cause its ResizeObserver to fire
          before the parent height is established — which breaks toolbar breakpoint detection. */}
      <div className="relative flex-1">
        <div className="absolute inset-0">
          <Tldraw
            key={previewSidecarJson ?? pagePath}
            snapshot={snapshot ?? undefined}
            onMount={handleMount}
            components={components}
          />
        </div>
      </div>
    </div>
  );
});

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
 * InkCanvas wraps Tldraw as a standalone ink-note surface.
 * It is keyed by pagePath so the editor fully remounts on page switch.
 */
export const InkCanvas = React.forwardRef<InkCanvasHandle, InkCanvasProps>(function InkCanvas(
  { pagePath, title, onOpenSidebar, onSaveStatusChange, previewSidecarJson, readOnly, music },
  ref
) {
  return (
    <InkCanvasInner
      key={previewSidecarJson ? `${pagePath}:preview` : pagePath}
      ref={ref}
      pagePath={pagePath}
      title={title}
      onOpenSidebar={onOpenSidebar}
      onSaveStatusChange={onSaveStatusChange}
      previewSidecarJson={previewSidecarJson}
      readOnly={readOnly}
      music={music}
    />
  );
});
