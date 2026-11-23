"use client";

import * as React from "react";
import { BoxSelect, Lasso, Trash2 } from "lucide-react";
import { AnnotationDrawToolbar } from "@/components/annotation-draw-toolbar";
import type { InkEngineSurfaceProps } from "@/components/ink-engine-surface";
import { logDrawEvent } from "@/lib/draw-mode-debug";
import { getInkHistoryCommand } from "@/lib/ink-engine";
import { SmartNotesInkEngine } from "./engine";
import { polygonPath, strokeGeometry } from "./geometry";
import { InkPointerInput, pageToScreen, pointerSamples } from "./input";

function readSamples(event: React.PointerEvent<SVGSVGElement>) {
  const svg = event.currentTarget;
  return pointerSamples(event.nativeEvent, svg.getBoundingClientRect(), svg.clientWidth, svg.clientHeight);
}

function NoteToolbar({ engine, mobile }: { engine: SmartNotesInkEngine; mobile?: boolean }) {
  return (
    <AnnotationDrawToolbar
      variant={mobile ? "mobile" : "desktop"}
      mobileMenuPlacement="above"
      activeTool={engine.getTool()}
      activeColor={engine.getColor()}
      activeStroke={engine.getSize()}
      canUndo={engine.canUndo()}
      canRedo={engine.canRedo()}
      onToolChange={(tool) => engine.setTool(tool)}
      onColorChange={(color) => engine.setColor(color)}
      onStrokeChange={(size) => engine.setSize(size)}
      onUndo={() => engine.undo()}
      onRedo={() => engine.redo()}
    />
  );
}

function SelectionToolbar({ engine, aboveTools }: { engine: SmartNotesInkEngine; aboveTools: boolean }) {
  const selectionMode = engine.getSelectionMode();
  return (
    <div role="toolbar" aria-label="Ink selection" data-sn-ink-controls data-print-chrome="true"
      className={`absolute right-2 z-20 flex gap-1 rounded-md border border-border bg-background p-1 shadow-md ${aboveTools ? "bottom-14" : "bottom-2"}`}>
      <button type="button" className="toolbar-btn size-8" aria-label="Box select" title="Box select"
        aria-pressed={selectionMode === "box"} onClick={() => engine.setSelectionMode("box")}>
        <BoxSelect className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="toolbar-btn size-8" aria-label="Lasso select" title="Lasso select"
        aria-pressed={selectionMode === "lasso"} onClick={() => engine.setSelectionMode("lasso")}>
        <Lasso className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className="toolbar-btn size-8" aria-label="Delete selected ink" title="Delete selected ink"
        disabled={!engine.hasSelection()} onClick={() => engine.deleteSelected()}>
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SmartNotesInkSurface({ variant, scene, grid, onMount }: InkEngineSurfaceProps) {
  const [engine] = React.useState(() => new SmartNotesInkEngine(variant === "note"));
  const [input] = React.useState(() => new InkPointerInput(engine, variant === "annotation"));
  const svgRef = React.useRef<SVGSVGElement>(null);
  const mountRef = React.useRef({ onMount, scene });
  mountRef.current = { onMount, scene };
  const gridId = React.useId();

  React.useSyncExternalStore(engine.subscribeView, engine.getViewVersion, engine.getViewVersion);

  React.useLayoutEffect(() => {
    const mount = mountRef.current;
    engine.loadScene(mount.scene);
    const unmount = mount.onMount(engine);
    logDrawEvent("smart-ink.mount", { variant, strokes: engine.getStrokeCount() });
    const unsubscribe = engine.subscribe(() => {
      logDrawEvent("smart-ink.edit", { variant, tool: engine.getTool(), strokes: engine.getStrokeCount() });
    });
    return () => {
      unsubscribe();
      unmount?.();
    };
  }, [engine, variant]);

  React.useLayoutEffect(() => {
    if (grid !== undefined) engine.setGridVisible(grid);
  }, [engine, grid]);

  const readOnly = engine.isReadOnly();
  React.useLayoutEffect(() => input.reset(), [input, readOnly]);

  React.useEffect(() => {
    const svg = svgRef.current;
    if (variant !== "note" || !svg) return;
    const handleWheel = (event: WheelEvent) => {
      const rect = svg.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
      if (input.wheel([event.clientX - rect.left, event.clientY - rect.top], event.deltaX * unit, event.deltaY * unit, event.ctrlKey || event.metaKey)) {
        event.preventDefault();
      }
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [input, variant]);

  function endPointer(event: React.PointerEvent<SVGSVGElement>, cancelled: boolean) {
    const samples = readSamples(event);
    if (!cancelled) input.move(samples.slice(0, -1));
    input.up(samples[samples.length - 1], cancelled);
  }

  const { strokes, draft, selected, offset, region } = engine.getPaint();
  const draftGeometry = draft && strokeGeometry(draft, false);
  const camera = engine.getCamera();
  const [x, y] = pageToScreen([0, 0], camera);
  const transform = `translate(${x} ${y}) scale(${camera.z})`;

  return (
    <div className={`absolute inset-0 ${variant === "note" ? "bg-background" : ""}`} data-testid="smart-notes-ink-surface">
      <svg
        ref={svgRef}
        className="sn-ink-canvas absolute inset-0 block size-full"
        aria-label="Smart Notes ink canvas"
        role={readOnly ? "img" : "application"}
        tabIndex={readOnly ? undefined : 0}
        style={readOnly ? { pointerEvents: "none" } : { touchAction: "none" }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const [sample] = readSamples(event);
          if (!input.down(sample, event.shiftKey)) return;
          event.currentTarget.focus({ preventScroll: true });
          if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => input.move(readSamples(event))}
        onPointerUp={(event) => endPointer(event, false)}
        onPointerCancel={(event) => endPointer(event, true)}
        onLostPointerCapture={(event) => endPointer(event, true)}
        onKeyDown={(event) => {
          if (readOnly) return;
          if (event.key === "Escape" && engine.isPointing()) {
            event.preventDefault();
            input.reset();
          } else if ((event.key === "Delete" || event.key === "Backspace") && engine.hasSelection()) {
            event.preventDefault();
            engine.deleteSelected();
          } else if (variant !== "annotation") {
            const command = getInkHistoryCommand(event);
            if (command) {
              event.preventDefault();
              engine[command]();
            }
          }
        }}
      >
        {engine.isGridVisible() && (
          <>
            <defs>
              <pattern id={gridId} width="25" height="25" patternUnits="userSpaceOnUse" patternTransform={transform}>
                <path d="M25 0H0V25" fill="none" stroke="var(--border)" strokeWidth={1 / camera.z} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${gridId})`} />
          </>
        )}
        <g transform={transform}>
          {strokes.map((stroke) => {
            const { path, fill, bounds } = strokeGeometry(stroke);
            const active = selected.has(stroke.id);
            return (
              <g key={stroke.id} transform={active && offset ? `translate(${offset[0]} ${offset[1]})` : undefined}>
                <path data-sn-ink-stroke={stroke.id} d={path} fill={fill} />
                {active && <rect data-print-chrome="true" x={bounds.left - 2} y={bounds.top - 2} width={bounds.right - bounds.left + 4}
                  height={bounds.bottom - bounds.top + 4} fill="none" stroke="var(--primary)" vectorEffect="non-scaling-stroke" />}
              </g>
            );
          })}
          {draftGeometry && <path d={draftGeometry.path} fill={draftGeometry.fill} />}
          {region && region.length > 1 && <path data-print-chrome="true" d={polygonPath(region)} fill="none" stroke="var(--primary)"
            strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </g>
      </svg>
      {!readOnly && variant === "note" && (
        <div className="absolute bottom-2 left-2 z-10 rounded-md border border-border bg-background p-1 shadow-md"
          role="toolbar" aria-label="Ink tools" data-sn-ink-controls data-print-chrome="true">
          <div className="sm:hidden"><NoteToolbar engine={engine} mobile /></div>
          <div className="hidden sm:block"><NoteToolbar engine={engine} /></div>
        </div>
      )}
      {!readOnly && engine.getTool() === "select" && <SelectionToolbar engine={engine} aboveTools={variant === "note"} />}
    </div>
  );
}
