"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Grid3x3 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  GRID_LINE_STYLES,
  PAGE_LINE_COLORS,
  PAGE_LINE_COLOR_LABELS,
  PAGE_LINE_STYLE_LABELS,
  RULE_LINE_STYLES,
  pageLineColorVar,
  pageLinesBackgroundStyle,
  readNewPageLinesDefault,
  writeNewPageLinesDefault,
  type PageLineColor,
  type PageLineStyle,
  type PageLinesSetting,
} from "@/lib/page-lines";

/** Tile preview spacing (scaled down from the page tokens to fit a tile). */
const TILE_PREVIEW_SPACING: Record<Exclude<PageLineStyle, "none">, string> = {
  "rule-narrow": "9px",
  "rule-college": "12px",
  "rule-wide": "16px",
  "rule-college-margin": "12px",
  "grid-small": "10px",
  "grid-medium": "15px",
  "grid-large": "21px",
  "grid-xlarge": "31px",
};

/**
 * SN-297: page rule / grid line popover (fork photo #14). Rule Lines, Grid
 * Lines, Rule Line Color, and the per-browser "Always create" footer toggle.
 */
export function PageLinesPopover({
  value,
  onChange,
  mobile = false,
}: {
  value: PageLinesSetting;
  onChange: (next: PageLinesSetting) => void;
  mobile?: boolean;
}) {
  const [alwaysCreate, setAlwaysCreate] = React.useState(false);

  React.useEffect(() => {
    setAlwaysCreate(readNewPageLinesDefault() !== null);
  }, []);

  const commit = React.useCallback(
    (next: PageLinesSetting) => {
      onChange(next);
      // While "Always create" is on, the browser default follows "these lines".
      if (readNewPageLinesDefault() !== null) {
        writeNewPageLinesDefault(next);
      }
    },
    [onChange]
  );

  const toggleAlwaysCreate = React.useCallback(() => {
    const next = !alwaysCreate;
    writeNewPageLinesDefault(next ? value : null);
    setAlwaysCreate(next);
  }, [alwaysCreate, value]);

  const testIdSuffix = mobile ? "-mobile" : "";
  const active = value.style !== "none";

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        className={cn("toolbar-btn", active && "toolbar-btn--active")}
        title="Rule and grid lines"
        aria-label="Rule and grid lines"
        data-testid={`toolbar-page-lines${testIdSuffix}`}
      >
        <Grid3x3 className="size-4" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner className="isolate z-50 outline-none" align="start" sideOffset={4}>
          <PopoverPrimitive.Popup
            className="w-[19rem] max-w-[calc(100vw-1rem)] origin-(--transform-origin) overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none"
            data-testid={`page-lines-popover${testIdSuffix}`}
          >
            <section className="border-b border-border px-2.5 pb-2.5 pt-2" aria-labelledby="page-lines-rule-label">
              <h3 id="page-lines-rule-label" className="mb-1.5 text-xs font-normal text-muted-foreground">
                Rule Lines
              </h3>
              <div className="flex gap-1.5">
                <LineTile
                  style="none"
                  color={value.color}
                  selected={value.style === "none"}
                  onSelect={() => commit({ ...value, style: "none" })}
                  testId={`page-lines-tile-none${testIdSuffix}`}
                />
                {RULE_LINE_STYLES.map((style) => (
                  <LineTile
                    key={style}
                    style={style}
                    color={value.color}
                    selected={value.style === style}
                    onSelect={() => commit({ ...value, style })}
                    testId={`page-lines-tile-${style}${testIdSuffix}`}
                  />
                ))}
              </div>
            </section>

            <section className="border-b border-border px-2.5 pb-2.5 pt-2" aria-labelledby="page-lines-grid-label">
              <h3 id="page-lines-grid-label" className="mb-1.5 text-xs font-normal text-muted-foreground">
                Grid Lines
              </h3>
              <div className="flex gap-1.5">
                {GRID_LINE_STYLES.map((style) => (
                  <LineTile
                    key={style}
                    style={style}
                    color={value.color}
                    selected={value.style === style}
                    onSelect={() => commit({ ...value, style })}
                    testId={`page-lines-tile-${style}${testIdSuffix}`}
                    wide
                  />
                ))}
              </div>
            </section>

            <section className="border-b border-border px-2.5 pb-2.5 pt-2" aria-labelledby="page-lines-color-label">
              <h3 id="page-lines-color-label" className="mb-1.5 text-xs font-normal text-muted-foreground">
                Rule Line Color
              </h3>
              <div className="flex gap-2.5 px-0.5" role="radiogroup" aria-labelledby="page-lines-color-label">
                {PAGE_LINE_COLORS.map((color) => (
                  <ColorSwatch
                    key={color}
                    color={color}
                    selected={value.color === color}
                    onSelect={() => commit({ ...value, color })}
                    testId={`page-lines-color-${color}${testIdSuffix}`}
                  />
                ))}
              </div>
            </section>

            <button
              type="button"
              role="switch"
              aria-checked={alwaysCreate}
              onClick={toggleAlwaysCreate}
              data-testid={`page-lines-always-create${testIdSuffix}`}
              className="flex w-full items-center gap-3 px-2.5 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset min-h-11 md:min-h-0"
            >
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", alwaysCreate ? "text-foreground" : "text-muted-foreground")}>
                  Always create pages with these lines
                </span>
                <span className="block text-xs text-muted-foreground">
                  New text pages in this browser only.
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-flex h-4 w-7 shrink-0 rounded-full border border-border transition-colors",
                  alwaysCreate ? "bg-accent" : "bg-secondary"
                )}
              >
                <span
                  className={cn(
                    "absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-background shadow-sm transition-[left]",
                    alwaysCreate ? "left-[13px]" : "left-px"
                  )}
                />
              </span>
            </button>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function LineTile({
  style,
  color,
  selected,
  onSelect,
  testId,
  wide = false,
}: {
  style: PageLineStyle;
  color: PageLineColor;
  selected: boolean;
  onSelect: () => void;
  testId: string;
  wide?: boolean;
}) {
  const label = PAGE_LINE_STYLE_LABELS[style];
  const preview =
    style === "none"
      ? undefined
      : pageLinesBackgroundStyle(
          { style, color },
          { spacing: TILE_PREVIEW_SPACING[style], marginInset: "9px" }
        );

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
      onClick={onSelect}
      className={cn(
        "flex h-12 shrink-0 items-center justify-center rounded-md border bg-popover text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        wide ? "w-[4.0625rem]" : "w-[3.25rem]",
        selected ? "border-2 border-accent" : "border-border hover:border-muted-foreground"
      )}
      style={preview}
    >
      {style === "none" ? <span className="text-xs">None</span> : null}
    </button>
  );
}

function ColorSwatch({
  color,
  selected,
  onSelect,
  testId,
}: {
  color: PageLineColor;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  const label = PAGE_LINE_COLOR_LABELS[color];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        "size-7 shrink-0 rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        selected && "ring-2 ring-accent ring-offset-2 ring-offset-popover"
      )}
      style={{ backgroundColor: pageLineColorVar(color) }}
    />
  );
}
