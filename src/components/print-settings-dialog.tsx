"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  type MarginPreset,
  type LineHeightPreset,
  type PrintSettings,
  MARGIN_PRESET_VALUES,
} from "@/lib/print-settings";

interface PrintSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSettings: PrintSettings;
  onSave: (settings: PrintSettings) => void;
  onSetDefault: (settings: PrintSettings) => void;
}

const MARGIN_PRESETS: { value: MarginPreset; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
  { value: "custom", label: "Custom" },
];

const LINE_HEIGHT_PRESETS: { value: LineHeightPreset; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
];

export function PrintSettingsDialog({
  open,
  onOpenChange,
  initialSettings,
  onSave,
  onSetDefault,
}: PrintSettingsDialogProps) {
  const [settings, setSettings] = React.useState<PrintSettings>(initialSettings);
  const [customInput, setCustomInput] = React.useState(() => String(initialSettings.customMarginIn));

  React.useEffect(() => {
    if (open) {
      setSettings(initialSettings);
      setCustomInput(String(initialSettings.customMarginIn));
    }
  }, [open, initialSettings]);

  const handleMarginPreset = (preset: MarginPreset) => {
    setSettings((prev) => ({ ...prev, marginPreset: preset }));
  };

  const handleCustomMarginChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setCustomInput(raw);
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) {
      setSettings((prev) => ({ ...prev, customMarginIn: num }));
    }
  };

  const handleLineHeightPreset = (preset: LineHeightPreset) => {
    setSettings((prev) => ({ ...prev, lineHeightPreset: preset }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs" data-testid="print-settings-dialog">
        <DialogHeader>
          <DialogTitle>Advanced print settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Page margins
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MARGIN_PRESETS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleMarginPreset(value)}
                  aria-pressed={settings.marginPreset === value}
                  className={cn(
                    "rounded border px-2.5 py-1 text-xs transition-colors",
                    settings.marginPreset === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted/40 text-foreground hover:bg-muted"
                  )}
                >
                  {label}
                  {value !== "custom" && (
                    <span className="ml-1 text-[10px] opacity-60">
                      ({MARGIN_PRESET_VALUES[value]})
                    </span>
                  )}
                </button>
              ))}
            </div>
            {settings.marginPreset === "custom" && (
              <div className="flex items-center gap-2 pt-1">
                <Input
                  type="number"
                  min={0.1}
                  max={3}
                  step={0.05}
                  value={customInput}
                  onChange={handleCustomMarginChange}
                  className="h-8 w-24 text-sm"
                  aria-label="Custom page margin in inches"
                />
                <span className="text-xs text-muted-foreground">in</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Line spacing
            </p>
            <div className="flex gap-1.5">
              {LINE_HEIGHT_PRESETS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleLineHeightPreset(value)}
                  aria-pressed={settings.lineHeightPreset === value}
                  className={cn(
                    "rounded border px-2.5 py-1 text-xs transition-colors",
                    settings.lineHeightPreset === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted/40 text-foreground hover:bg-muted"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onSave(settings);
              onOpenChange(false);
            }}
            data-testid="print-settings-save-btn"
          >
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onSetDefault(settings);
              onOpenChange(false);
            }}
            data-testid="print-settings-set-default-btn"
          >
            Set as default
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
