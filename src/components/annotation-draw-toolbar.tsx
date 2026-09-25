"use client";

import * as React from "react";
import {
  Eraser,
  MousePointer2,
  PenLine,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ANNOTATION_INK_COLORS,
  type AnnotationLayerHandle,
  type AnnotationStrokeSize,
  type AnnotationTool,
} from "@/components/annotation-layer";
import type { TLDefaultColorStyle } from "tldraw";

interface AnnotationDrawToolbarProps {
  layerRef: React.RefObject<AnnotationLayerHandle | null>;
  activeTool: AnnotationTool;
  activeColor: TLDefaultColorStyle;
  activeStroke: AnnotationStrokeSize;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: AnnotationTool) => void;
  onColorChange: (color: TLDefaultColorStyle) => void;
  onStrokeChange: (size: AnnotationStrokeSize) => void;
  onExitDrawMode: () => void;
  variant?: "desktop" | "mobile";
}

// Bar-height indicators scaled down 25% from prior values (2/3/5/7) to match
// newly authored thinner ink strokes (SN-154).
const STROKE_SIZES: { id: AnnotationStrokeSize; label: string; bar: number }[] = [
  { id: "s", label: "Thin", bar: 1.5 },
  { id: "m", label: "Medium", bar: 2.25 },
  { id: "l", label: "Thick", bar: 3.75 },
  { id: "xl", label: "Extra thick", bar: 5.25 },
];

function InkToolbarBtn({
  onClick,
  active = false,
  disabled = false,
  title,
  testId,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("toolbar-btn", active && "toolbar-btn--active", disabled && "opacity-40")}
    >
      {children}
    </button>
  );
}

function InkToolbarSep() {
  return <div className="toolbar-sep" aria-hidden />;
}

function MobileInkExpandSelector<T extends string>({
  label,
  activeId,
  options,
  testIdPrefix,
  onSelect,
  renderTrigger,
  renderOption,
}: {
  label: string;
  activeId: T;
  options: { id: T; label: string }[];
  testIdPrefix: string;
  onSelect: (id: T) => void;
  renderTrigger: (activeId: T) => React.ReactNode;
  renderOption: (option: { id: T; label: string }, active: boolean) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        data-testid={`${testIdPrefix}-trigger-mobile`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        className={cn("toolbar-btn size-7 p-1", open && "toolbar-btn--active")}
      >
        {renderTrigger(activeId)}
      </button>
      {open ? (
        <div
          className="absolute left-1/2 top-full z-20 mt-1 flex -translate-x-1/2 flex-col gap-0.5 rounded-md border border-border bg-background p-1 shadow-md"
          data-testid={`${testIdPrefix}-menu-mobile`}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={activeId === option.id}
              data-testid={`${testIdPrefix}-${option.id}-mobile`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(option.id);
                setOpen(false);
              }}
              className={cn(
                "toolbar-btn flex min-h-10 min-w-10 items-center justify-center p-1.5",
                activeId === option.id && "toolbar-btn--active"
              )}
            >
              {renderOption(option, activeId === option.id)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AnnotationDrawToolbar({
  layerRef,
  activeTool,
  activeColor,
  activeStroke,
  canUndo,
  canRedo,
  onToolChange,
  onColorChange,
  onStrokeChange,
  onExitDrawMode,
  variant = "desktop",
}: AnnotationDrawToolbarProps) {
  const isMobile = variant === "mobile";

  function handleTool(tool: AnnotationTool) {
    layerRef.current?.setTool(tool);
    onToolChange(tool);
  }

  function handleUndo() {
    layerRef.current?.undo();
  }

  function handleRedo() {
    layerRef.current?.redo();
  }

  const exitButton = (
    <button
      type="button"
      title="Exit draw mode"
      aria-label="Exit draw mode"
      data-testid={isMobile ? "ink-exit-draw-mobile" : "ink-exit-draw"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onExitDrawMode}
      className="toolbar-btn toolbar-btn--exit"
    >
      <X className="size-4" strokeWidth={2.25} />
    </button>
  );

  const toolGroup = (
    <>
      <InkToolbarBtn
        onClick={() => handleTool("draw")}
        active={activeTool === "draw"}
        title="Pen"
        testId={isMobile ? "ink-tool-pen-mobile" : "ink-tool-pen"}
      >
        <PenLine className="size-4" />
      </InkToolbarBtn>
      <InkToolbarBtn
        onClick={() => handleTool("eraser")}
        active={activeTool === "eraser"}
        title="Eraser"
        testId={isMobile ? "ink-tool-eraser-mobile" : "ink-tool-eraser"}
      >
        <Eraser className="size-4" />
      </InkToolbarBtn>
      <InkToolbarBtn
        onClick={() => handleTool("select")}
        active={activeTool === "select"}
        title="Select"
        testId={isMobile ? "ink-tool-select-mobile" : "ink-tool-select"}
      >
        <MousePointer2 className="size-4" />
      </InkToolbarBtn>
    </>
  );

  const historyGroup = (
    <>
      <InkToolbarBtn
        onClick={handleUndo}
        disabled={!canUndo}
        title="Undo"
        testId={isMobile ? "ink-tool-undo-mobile" : "ink-tool-undo"}
      >
        <Undo2 className="size-4" />
      </InkToolbarBtn>
      <InkToolbarBtn
        onClick={handleRedo}
        disabled={!canRedo}
        title="Redo"
        testId={isMobile ? "ink-tool-redo-mobile" : "ink-tool-redo"}
      >
        <Redo2 className="size-4" />
      </InkToolbarBtn>
    </>
  );

  const colorGroup = (
    <div className="flex items-center gap-0.5">
      {ANNOTATION_INK_COLORS.map((color) => (
        <button
          key={color.id}
          type="button"
          title={`Ink color ${color.id}`}
          aria-label={`Ink color ${color.id}`}
          aria-pressed={activeColor === color.id}
          data-testid={isMobile ? `ink-color-${color.id}-mobile` : `ink-color-${color.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            layerRef.current?.setColor(color.id);
            onColorChange(color.id);
          }}
          className={cn(
            "toolbar-btn size-7 p-1",
            activeColor === color.id && "toolbar-btn--active"
          )}
        >
          <span
            className="block size-4 rounded-full border border-border"
            style={{ backgroundColor: color.hex }}
          />
        </button>
      ))}
    </div>
  );

  const strokeGroup = (
    <div className="flex items-center gap-0.5">
      {STROKE_SIZES.map((size) => (
        <button
          key={size.id}
          type="button"
          title={size.label}
          aria-label={size.label}
          aria-pressed={activeStroke === size.id}
          data-testid={isMobile ? `ink-stroke-${size.id}-mobile` : `ink-stroke-${size.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            layerRef.current?.setStroke(size.id);
            onStrokeChange(size.id);
          }}
          className={cn(
            "toolbar-btn size-7 p-1",
            activeStroke === size.id && "toolbar-btn--active"
          )}
        >
          <span
            className="block w-3.5 rounded-full bg-foreground"
            style={{ height: size.bar }}
          />
        </button>
      ))}
    </div>
  );

  if (isMobile) {
    const activeColorHex = ANNOTATION_INK_COLORS.find((color) => color.id === activeColor)?.hex ?? "#000";
    const activeStrokeEntry = STROKE_SIZES.find((size) => size.id === activeStroke) ?? STROKE_SIZES[1];

    return (
      <div className="flex w-full min-w-0 items-center gap-0.5">
        {toolGroup}
        <InkToolbarSep />
        {historyGroup}
        <InkToolbarSep />
        <MobileInkExpandSelector<TLDefaultColorStyle>
          label="Ink color"
          activeId={activeColor as TLDefaultColorStyle}
          testIdPrefix="ink-color"
          options={ANNOTATION_INK_COLORS.map((color) => ({ id: color.id, label: `Ink color ${color.id}` }))}
          onSelect={(colorId) => {
            layerRef.current?.setColor(colorId);
            onColorChange(colorId);
          }}
          renderTrigger={() => (
            <span
              className="block size-4 rounded-full border border-border"
              style={{ backgroundColor: activeColorHex }}
            />
          )}
          renderOption={(option) => {
            const hex = ANNOTATION_INK_COLORS.find((color) => color.id === option.id)?.hex ?? "#000";
            return (
              <span
                className="block size-4 rounded-full border border-border"
                style={{ backgroundColor: hex }}
              />
            );
          }}
        />
        <MobileInkExpandSelector
          label="Stroke width"
          activeId={activeStroke}
          testIdPrefix="ink-stroke"
          options={STROKE_SIZES.map((size) => ({ id: size.id, label: size.label }))}
          onSelect={(strokeId) => {
            layerRef.current?.setStroke(strokeId);
            onStrokeChange(strokeId);
          }}
          renderTrigger={() => (
            <span
              className="block w-3.5 rounded-full bg-foreground"
              style={{ height: activeStrokeEntry.bar }}
            />
          )}
          renderOption={(option) => {
            const size = STROKE_SIZES.find((entry) => entry.id === option.id) ?? STROKE_SIZES[1];
            return (
              <span
                className="block w-3.5 rounded-full bg-foreground"
                style={{ height: size.bar }}
              />
            );
          }}
        />
        <InkToolbarSep />
        {exitButton}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-0.5">
      {toolGroup}
      <InkToolbarSep />
      {historyGroup}
      <InkToolbarSep />
      {colorGroup}
      <InkToolbarSep />
      {strokeGroup}
      <InkToolbarSep />
      {exitButton}
    </div>
  );
}
