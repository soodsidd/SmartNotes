/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  AiSidebar,
  MobileAiSheet,
  type AiSidebarMessage,
} from "@/components/ai-sidebar";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("div", null, children),
}));
jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("remark-math", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("rehype-katex", () => ({ __esModule: true, default: jest.fn() }));

const SHELL_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/components/notebook-shell-reliable.tsx"),
  "utf8"
);
const TOKENS_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../src/styles/tokens.css"),
  "utf8"
);

function companionProps(
  overrides: Partial<React.ComponentProps<typeof AiSidebar>> = {}
): React.ComponentProps<typeof AiSidebar> {
  return {
    pageTitle: "Reader note",
    scopeLabel: "Whole note",
    tokenLabel: "direct edit",
    activeScope: "whole",
    scopeOptions: [{ value: "whole", label: "Whole note" }],
    keepConversation: false,
    onKeepConversationChange: jest.fn(),
    activeProviderLabel: "Codex",
    activeModelLabel: "gpt-5.6-sol",
    assistantLabel: "Leo",
    messages: [] as AiSidebarMessage[],
    providers: [
      { id: "codex", name: "Codex", models: ["gpt-5.6-sol"] },
      { id: "claude", name: "Claude", models: ["sonnet"] },
    ],
    activeProviderId: "codex",
    verboseEnabled: true,
    onProviderChange: jest.fn(),
    onModelChange: jest.fn(),
    onSubmit: jest.fn(),
    onScopeChange: jest.fn(),
    ...overrides,
  };
}

describe("immersive PDF companion shell", () => {
  it("uses one shared AiSidebar element for docked, mobile, and over-reader presentations", () => {
    expect(SHELL_SOURCE.match(/<AiSidebar\b/g)).toHaveLength(1);
    expect(SHELL_SOURCE).toContain("const companionSidebar = (");
    expect(SHELL_SOURCE.match(/\{companionSidebar\}/g)).toHaveLength(2);
    expect(SHELL_SOURCE).not.toContain("{pdfReader && aiOpen ?");
    expect(SHELL_SOURCE).not.toContain("z-[350]");
  });

  it("documents the reader, companion, and companion-overlay token order", () => {
    const reader = Number(TOKENS_SOURCE.match(/--z-pdf-reader:\s*(\d+)/)?.[1]);
    const companion = Number(TOKENS_SOURCE.match(/--z-companion-rail:\s*(\d+)/)?.[1]);
    const overlay = Number(TOKENS_SOURCE.match(/--z-companion-overlay:\s*(\d+)/)?.[1]);

    expect(reader).toBeLessThan(companion);
    expect(companion).toBeLessThan(overlay);
  });

  it("keeps the shared settings dialog open and raises both portaled layers over the reader", () => {
    const props = companionProps();
    const view = render(<AiSidebar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    const dialog = screen.getByTestId("ai-settings-dialog");
    expect(dialog).not.toHaveClass("z-[var(--z-companion-overlay)]");

    view.rerender(<AiSidebar {...props} elevateFloatingLayers />);

    expect(screen.getByTestId("ai-settings-dialog")).toHaveClass(
      "z-[var(--z-companion-overlay)]"
    );
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass(
      "z-[var(--z-companion-overlay)]"
    );

    // SN-249 added a second, independent "Jupyter inline AI" fast-lane
    // provider section that reuses the same provider list, so scope this
    // query to the Companion section to keep hitting the companion picker.
    const companionSection = screen.getByRole("region", { name: "Companion" });
    fireEvent.click(within(companionSection).getByRole("button", { name: "Claude" }));
    expect(props.onProviderChange).toHaveBeenCalledWith("claude");
  });

  it("raises the narrow companion sheet and its backdrop above the reader", () => {
    render(
      <MobileAiSheet open onOpenChange={jest.fn()} overReader>
        <AiSidebar {...companionProps()} mobile elevateFloatingLayers />
      </MobileAiSheet>
    );

    expect(screen.getByTestId("pdf-reader-ai-sheet")).toHaveClass(
      "z-[var(--z-companion-rail)]"
    );
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toHaveClass(
      "z-[var(--z-companion-rail)]"
    );

    fireEvent.click(screen.getByText("Codex · gpt-5.6-sol"));
    const providerMenu = document.querySelector(
      '[data-slot="dropdown-menu-content"]'
    );
    expect(providerMenu?.parentElement).toHaveClass(
      "z-[var(--z-companion-overlay)]"
    );
  });
});
