/**
 * @jest-environment node
 *
 * SN-289: targeted source checks for shell/Companion touch targets and accessible names.
 */

import fs from "node:fs";
import path from "node:path";

const shellSrc = fs.readFileSync(
  path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
  "utf8"
);
const companionSrc = fs.readFileSync(
  path.join(process.cwd(), "src/components/ai-sidebar.tsx"),
  "utf8"
);

describe("shell chrome touch + a11y (SN-289)", () => {
  it("sizes frequent shell actions to 44px below xl and keeps desktop compact", () => {
    expect(shellSrc).toContain('const SHELL_PRIMARY_ACTION_CLASS = "size-11 shrink-0 xl:size-8"');
    expect(shellSrc).toContain("aria-label=\"Open menu\"");
    expect(shellSrc).toContain("aria-label=\"Open search\"");
    expect(shellSrc).toContain("aria-label=\"Open capture\"");
    expect(shellSrc).toContain('"Open Companion"');
    expect(shellSrc).toContain('"Open Companion — answer ready"');
    expect(shellSrc).toContain("aria-label=\"More\"");
    expect(shellSrc).toContain('data-testid="shell-more-menu"');
    expect(shellSrc).toContain('<span className="text-xs font-medium xl:sr-only">More</span>');
  });

  it("keeps phone save/sync/error state as readable text, not icon-only", () => {
    expect(shellSrc).toContain('data-testid="shell-status-chip"');
    expect(shellSrc).toContain("getShellStatusSummary");
    expect(shellSrc).toContain("{shellStatus.shortLabel}");
    expect(shellSrc).toContain('data-testid="sync-state-indicator"');
    expect(shellSrc).toContain('data-testid="save-status"');
  });

  it("keeps secondary actions in More and exposes desktop primary actions", () => {
    const moreBlock = shellSrc.slice(
      shellSrc.indexOf('data-testid="shell-more-menu"'),
      shellSrc.indexOf("export const Sidebar")
    );
    expect(moreBlock).toContain('data-testid="export-page-btn"');
    expect(moreBlock).toContain('data-testid="print-page-btn"');
    expect(moreBlock).toContain('data-testid="reload-btn"');
    expect(moreBlock).toContain('data-testid="app-settings-trigger"');
    expect(moreBlock).toContain('data-testid="create-spreadsheet-menu-item"');
    const desktopActions = shellSrc.slice(shellSrc.indexOf('data-testid="desktop-primary-actions"'), shellSrc.indexOf("export const Sidebar"));
    for (const label of ["New notebook", "Open workspace…", "Export page as HTML", "Reload", "Print page", "Settings"]) {
      expect(desktopActions).toContain(label);
    }
    // Primary row no longer hosts a dedicated settings gear or plus trigger.
    expect(shellSrc).not.toContain("AppSettingsTrigger");
    expect(shellSrc).not.toContain('data-testid="add-menu-trigger"');
  });

  it("gives Companion mobile header controls 44px targets and accessible names", () => {
    expect(companionSrc).toContain('data-testid="ai-settings-mobile"');
    expect(companionSrc).toContain('aria-label="Companion settings"');
    expect(companionSrc).toContain('aria-label="Close Companion"');
    expect(companionSrc).toContain("size-11 shrink-0");
    expect(companionSrc).toContain('mobile ? "min-h-11 min-w-0 gap-1 px-3"');
  });
});
