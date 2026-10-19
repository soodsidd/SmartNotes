/**
 * @jest-environment jsdom
 */

import {
  COMMENT_SHORTCUT,
  getVersionsControlLabel,
  KEYBOARD_SHORTCUTS,
  readTreeSidebarCollapsed,
  readTreeSidebarWidth,
  TREE_SIDEBAR_COLLAPSED_KEY,
  TREE_SIDEBAR_WIDTH_KEY,
  writeTreeSidebarCollapsed,
  writeTreeSidebarWidth,
  clampTreeSidebarWidth,
  TREE_SIDEBAR_DEFAULT_WIDTH,
  readNotebookRailCollapsed,
  writeNotebookRailCollapsed,
  readNotebookRailWidth,
  writeNotebookRailWidth,
  clampNotebookRailWidth,
  sidebarWidthFromKey,
  NOTEBOOK_RAIL_COLLAPSED_KEY,
  NOTEBOOK_RAIL_WIDTH_KEY,
  NOTEBOOK_RAIL_DEFAULT_WIDTH,
} from "@/lib/app-settings";
import { applyDensity, resolveInitialDensity } from "@/components/density-provider";

describe("SN-43 app settings helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("toggles versions control label based on ghost panel visibility", () => {
    expect(getVersionsControlLabel("Notebook/Section/page.html", null)).toBe("View versions");
    expect(
      getVersionsControlLabel("Notebook/Section/page.html", {
        parentPagePath: "Notebook/Section/other.html",
      })
    ).toBe("View versions");
    expect(
      getVersionsControlLabel("Notebook/Section/page.html", {
        parentPagePath: "Notebook/Section/page.html",
      })
    ).toBe("Hide versions");
    expect(
      getVersionsControlLabel("Notebook/Section/page.html", {
        parentPagePath: "Notebook/Section/page.html",
        dismissing: true,
      })
    ).toBe("View versions");
  });

  it("persists tree sidebar collapsed state", () => {
    expect(readTreeSidebarCollapsed()).toBe(false);
    writeTreeSidebarCollapsed(true);
    expect(readTreeSidebarCollapsed()).toBe(true);
    expect(window.localStorage.getItem(TREE_SIDEBAR_COLLAPSED_KEY)).toBe("true");
  });

  it("persists tree sidebar width within bounds", () => {
    expect(readTreeSidebarWidth()).toBe(TREE_SIDEBAR_DEFAULT_WIDTH);
    writeTreeSidebarWidth(360);
    expect(readTreeSidebarWidth()).toBe(360);
    expect(window.localStorage.getItem(TREE_SIDEBAR_WIDTH_KEY)).toBe("360");
    expect(clampTreeSidebarWidth(999)).toBe(440);
    expect(clampTreeSidebarWidth(100)).toBe(200);
  });

  it("persists notebook rail collapse and width independently of the page tree", () => {
    expect(readNotebookRailCollapsed()).toBe(false);
    expect(readNotebookRailWidth()).toBe(NOTEBOOK_RAIL_DEFAULT_WIDTH);
    writeNotebookRailCollapsed(true);
    writeNotebookRailWidth(248);
    writeTreeSidebarCollapsed(false);
    writeTreeSidebarWidth(352);
    expect(readNotebookRailCollapsed()).toBe(true);
    expect(readTreeSidebarCollapsed()).toBe(false);
    expect(readNotebookRailWidth()).toBe(248);
    expect(readTreeSidebarWidth()).toBe(352);
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY)).toBe("true");
    expect(window.localStorage.getItem(NOTEBOOK_RAIL_WIDTH_KEY)).toBe("248");
    expect(clampNotebookRailWidth(999)).toBe(320);
    expect(clampNotebookRailWidth(0)).toBe(160);
  });

  it("supports keyboard resizing within each pane's bounds", () => {
    expect(sidebarWidthFromKey("ArrowRight", 200, 160, 320, clampNotebookRailWidth)).toBe(216);
    expect(sidebarWidthFromKey("ArrowLeft", 160, 160, 320, clampNotebookRailWidth)).toBe(160);
    expect(sidebarWidthFromKey("Home", 260, 200, 440, clampTreeSidebarWidth)).toBe(200);
    expect(sidebarWidthFromKey("End", 260, 200, 440, clampTreeSidebarWidth)).toBe(440);
    expect(sidebarWidthFromKey("Enter", 260, 200, 440, clampTreeSidebarWidth)).toBeNull();
  });

  it("persists reading density across reloads", () => {
    window.localStorage.setItem("smart-notes-density", "comfortable");
    expect(resolveInitialDensity()).toBe("comfortable");
    applyDensity("comfortable");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("includes the add-comment shortcut in the settings reference list", () => {
    expect(KEYBOARD_SHORTCUTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: COMMENT_SHORTCUT.label,
          keys: COMMENT_SHORTCUT.keys,
        }),
      ])
    );
  });
});

describe("SN-43 versions toggle wiring", () => {
  it("exports label helper used by sidebar controls", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const shellSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    expect(shellSrc).toContain("getVersionsControlLabel");
    expect(shellSrc).toContain("onTogglePageVersions");
    expect(shellSrc).not.toContain("View page versions");
    expect(shellSrc).not.toContain("data-versions-toggle");
    expect(shellSrc).toContain("tree-sidebar-resize-handle");
    expect(shellSrc).toContain("onCollapseTree");
  });
});

describe("SN-43 comment shortcut wiring", () => {
  it("registers Mod-Shift-M in the rich text editor", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const editorSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/rich-text-editor.tsx"),
      "utf8"
    );
    expect(editorSrc).toContain('event.key.toLowerCase() === "m"');
    expect(editorSrc).toContain("openComposerFromShortcut");
    expect(editorSrc).toContain("anchorRect={composerPending.anchorRect}");
  });
});

describe("SN-43 mobile draw toolbar selectors", () => {
  it("uses bare icon triggers without chevrons for color and stroke", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const toolbarSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/annotation-draw-toolbar.tsx"),
      "utf8"
    );
    expect(toolbarSrc).toContain("top-full");
    expect(toolbarSrc).not.toContain("ChevronDown");
    expect(toolbarSrc).toContain('className={cn("toolbar-btn size-7 p-1"');
  });
});

describe("SN-43 settings modal wiring", () => {
  it("keeps settings accessible from the top bar More menu", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const shellSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/notebook-shell-reliable.tsx"),
      "utf8"
    );
    expect(shellSrc).toContain('data-testid="app-settings-trigger"');
    expect(shellSrc).toContain("<DropdownMenuItem onClick={onOpenSettings}");
    expect(shellSrc).not.toContain("density-menu-trigger");
  });
});
