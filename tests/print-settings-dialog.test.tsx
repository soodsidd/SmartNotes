/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrintSettingsDialog } from "@/components/print-settings-dialog";
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from "@/lib/print-settings";

const baseSettings: PrintSettings = { ...DEFAULT_PRINT_SETTINGS };

function renderDialog(overrides?: {
  onSave?: (settings: PrintSettings) => void;
  onSetDefault?: (settings: PrintSettings) => void;
}) {
  const onSave = overrides?.onSave ?? jest.fn();
  const onSetDefault = overrides?.onSetDefault ?? jest.fn();

  render(
    <PrintSettingsDialog
      open
      onOpenChange={jest.fn()}
      initialSettings={baseSettings}
      onSave={onSave}
      onSetDefault={onSetDefault}
    />
  );

  return { onSave, onSetDefault };
}

describe("PrintSettingsDialog advanced flow (SN-120)", () => {
  test("Save applies session values without calling Set as default", () => {
    const { onSave, onSetDefault } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /narrow/i }));
    fireEvent.click(screen.getByRole("button", { name: /relaxed/i }));
    fireEvent.click(screen.getByTestId("print-settings-save-btn"));

    expect(onSave).toHaveBeenCalledWith({
      marginPreset: "narrow",
      customMarginIn: baseSettings.customMarginIn,
      lineHeightPreset: "relaxed",
    });
    expect(onSetDefault).not.toHaveBeenCalled();
  });

  test("Set as default persists chosen layout values", () => {
    const { onSave, onSetDefault } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /wide/i }));
    fireEvent.click(screen.getByTestId("print-settings-set-default-btn"));

    expect(onSetDefault).toHaveBeenCalledWith({
      marginPreset: "wide",
      customMarginIn: baseSettings.customMarginIn,
      lineHeightPreset: "normal",
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  test("Cancel closes without save handlers", () => {
    const onOpenChange = jest.fn();
    render(
      <PrintSettingsDialog
        open
        onOpenChange={onOpenChange}
        initialSettings={baseSettings}
        onSave={jest.fn()}
        onSetDefault={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /narrow/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
