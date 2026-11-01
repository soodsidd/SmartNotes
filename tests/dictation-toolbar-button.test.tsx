/**
 * @jest-environment jsdom
 *
 * SN-406 rework 1: the editor format-bar dictation control is a visible,
 * labeled top-level button ("Dictate" → "Stop" while recording), not an
 * icon hidden among / inside the Insert "+" menu.
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { DictationButton } from "@/components/dictation-button";
import type { DictationController } from "@/hooks/use-dictation";

function controller(phase: DictationController["phase"]): DictationController {
  return {
    phase,
    seconds: 0,
    notice: null,
    hasPendingClip: false,
    toggle: jest.fn(),
    retry: jest.fn(),
    discard: jest.fn(),
    dismissNotice: jest.fn(),
  } as unknown as DictationController;
}

describe("Editor toolbar dictation button", () => {
  it("labeled toolbar variant shows a visible Dictate label and toggles on click", () => {
    const c = controller("idle");
    render(<DictationButton controller={c} variant="toolbar" showLabel testId="toolbar-dictate" />);
    const btn = screen.getByTestId("toolbar-dictate");
    expect(btn).toHaveTextContent("Dictate");
    expect(btn).toHaveClass("toolbar-btn", "toolbar-btn--wide", "dictation-btn--labeled");
    fireEvent.click(btn);
    expect(c.toggle).toHaveBeenCalledTimes(1);
  });

  it("label reads Stop while recording, with the recording state class", () => {
    render(<DictationButton controller={controller("recording")} variant="toolbar" showLabel testId="toolbar-dictate" />);
    const btn = screen.getByTestId("toolbar-dictate");
    expect(btn).toHaveTextContent("Stop");
    expect(btn).toHaveClass("dictation-btn--recording");
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("icon-only toolbar variant (phone format bar) has no text label but an accessible name", () => {
    render(<DictationButton controller={controller("idle")} variant="toolbar" testId="toolbar-dictate-mobile" />);
    const btn = screen.getByTestId("toolbar-dictate-mobile");
    expect(btn).toHaveTextContent("");
    expect(btn).toHaveAccessibleName("Dictate");
  });
});
