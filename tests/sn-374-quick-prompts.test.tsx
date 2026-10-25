/** @jest-environment jsdom */
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AiSidebar, type AiSidebarMessage } from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => require("react").createElement("div", null, children) }));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

beforeEach(() => window.localStorage.clear());

function renderCompanion(overrides: Partial<React.ComponentProps<typeof AiSidebar>> = {}) {
  const props: React.ComponentProps<typeof AiSidebar> = {
    pageTitle: "Optics note", scopeLabel: "Whole note", tokenLabel: "direct edit", activeScope: "whole",
    scopeOptions: [{ value: "whole", label: "Whole note" }], keepConversation: false,
    onKeepConversationChange: jest.fn(), activeProviderLabel: "Codex", activeModelLabel: "auto",
    assistantLabel: "Companion", messages: [] as AiSidebarMessage[], providers: [], verboseEnabled: true,
    onSubmit: jest.fn(), onScopeChange: jest.fn(), ...overrides,
  };
  return { ...render(<AiSidebar {...props} />), props };
}

it("submits the default quick prompt immediately without consuming a draft or attachment", () => {
  const onSubmit = jest.fn();
  renderCompanion({ onSubmit, initialComposerAttachments: [{ id: "draft-attachment", kind: "markdown", name: "source.md", content: "Source" }] });
  expect(screen.getByTestId("ai-composer-provider-switcher")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("ai-input"), { target: { value: "Draft for later" } });
  fireEvent.click(screen.getByRole("button", { name: "Quick prompts" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Add short note" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith("Add a short note about this to the current note.", []);
  expect(screen.getByTestId("ai-input")).toHaveValue("Draft for later");
  expect(screen.getByText("source.md")).toBeInTheDocument();
});

it("persists edits, enabled state, order, additions and removal across a new Companion mount", () => {
  const first = renderCompanion();
  fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
  const settings = screen.getByTestId("quick-prompt-settings");
  expect(settings).toBeVisible();
  fireEvent.change(within(settings).getByLabelText("Dropdown label"), { target: { value: "Capture insight" } });
  fireEvent.change(within(settings).getByLabelText("Prompt text"), { target: { value: "Add this insight to the note." } });
  fireEvent.click(within(settings).getByRole("button", { name: "Add prompt" }));
  const editors = within(settings).getAllByTestId("quick-prompt-editor");
  fireEvent.change(within(editors[1]).getByLabelText("Dropdown label"), { target: { value: "Review" } });
  fireEvent.change(within(editors[1]).getByLabelText("Prompt text"), { target: { value: "Review this page." } });
  fireEvent.click(within(settings).getByRole("button", { name: "Move Review up" }));
  expect(screen.getByTestId("ai-quick-prompts")).toHaveTextContent("Review");
  fireEvent.click(within(settings).getByRole("button", { name: "Remove Capture insight" }));
  fireEvent.click(within(settings).getByRole("checkbox", { name: "Enabled" }));
  expect(screen.queryByTestId("ai-quick-prompts")).not.toBeInTheDocument();
  first.unmount();
  const second = renderCompanion();
  expect(screen.queryByTestId("ai-quick-prompts")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
  const saved = screen.getByTestId("quick-prompt-settings");
  expect(within(saved).getByLabelText("Dropdown label")).toHaveValue("Review");
  expect(within(saved).getByLabelText("Prompt text")).toHaveValue("Review this page.");
  fireEvent.click(within(saved).getByRole("checkbox", { name: "Enabled" }));
  second.unmount();
  const onSubmit = jest.fn();
  renderCompanion({ onSubmit });
  fireEvent.click(screen.getByRole("button", { name: "Quick prompts" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Review" }));
  expect(onSubmit).toHaveBeenCalledWith("Review this page.", []);
});

it("does not start a second turn on the same busy thread", () => {
  const onSubmit = jest.fn();
  renderCompanion({ onSubmit, isTurnActive: true });
  expect(screen.getByRole("button", { name: "Quick prompts" })).toBeDisabled();
  expect(onSubmit).not.toHaveBeenCalled();
});
