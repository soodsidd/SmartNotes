/**
 * @jest-environment jsdom
 */

import "@testing-library/jest-dom";
import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InlineSectionName, Sidebar, notebookHasRootPagesRow, sectionTabColor } from "@/components/notebook-shell-reliable";
import type { VaultNotebook, VaultPage } from "@/lib/vault-contract";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/components/ai-sidebar", () => ({ AiSidebar: () => null, MobileAiSheet: () => null }));
jest.mock("@/components/rich-text-editor", () => ({ RichTextEditor: () => null }));

function page(path: string, title: string, parentId: string | null = null, keyNote = false): VaultPage {
  return {
    id: path, path, title, slug: path, createdAt: null, updatedAt: null,
    preview: "", content: "", parentId, noteType: "text", keyNote,
  };
}

const tree: VaultNotebook[] = [
  {
    id: "Work", path: "Work", name: "Work", color: "#008080", pages: [page("Work/Roadmap", "Roadmap")],
    sections: [{
      id: "Work/Research", path: "Work/Research", name: "Research", pages: [
        page("Work/Research/Parent", "Parent"),
        page("Work/Research/Laser", "Laser calibration", "Work/Research/Parent", true),
      ],
    }],
  },
  {
    id: "Personal", path: "Personal", name: "Personal", color: "#884488", pages: [page("Personal/Travel", "Travel plans", null, true)], sections: [],
  },
];

function renderProps(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}): React.ComponentProps<typeof Sidebar> {
  return {
    tree,
    activeNotebookPath: null,
    activeSectionPath: null,
    activePagePath: null,
    expandedNotebooks: new Set(),
    expandedSections: new Set(),
    expandedPages: new Set(),
    closedNotebooks: new Set(),
    pinnedNotebooks: new Set(),
    pinnedPages: new Set(),
    notebookOrder: [],
    notebookGroups: [],
    archivedNotebooks: new Set(),
    onTogglePinnedNotebook: jest.fn(),
    onTogglePinnedPage: jest.fn(),
    onReorderNotebooks: jest.fn(),
    onCreateNotebookGroup: jest.fn(),
    onRenameNotebookGroup: jest.fn(),
    onDeleteNotebookGroup: jest.fn(),
    onToggleNotebookGroup: jest.fn(),
    onMoveNotebookToGroup: jest.fn(),
    onArchiveNotebook: jest.fn(),
    onUnarchiveNotebook: jest.fn(),
    onToggleNotebook: jest.fn(),
    onToggleSection: jest.fn(),
    onTogglePage: jest.fn(),
    onSelectNotebook: jest.fn(),
    onSelectSection: jest.fn(),
    onOpenPage: jest.fn(),
    onNestPage: jest.fn().mockResolvedValue(undefined),
    onSetPageKeyNote: jest.fn().mockResolvedValue(undefined),
    onReorderPages: jest.fn().mockResolvedValue(undefined),
    onApplyPageDrop: jest.fn().mockResolvedValue(undefined),
    onCrossContainerPageDrop: jest.fn().mockResolvedValue(undefined),
    onCreateNotebook: jest.fn(),
    onRevealNotebook: jest.fn(),
    onCreateSection: jest.fn(),
    inlineSectionPath: null,
    onCommitSectionName: jest.fn().mockResolvedValue(undefined),
    inlinePageTitlePath: null,
    onCommitPageTitle: jest.fn().mockResolvedValue(undefined),
    onRenameNotebook: jest.fn(),
    onDeleteNotebook: jest.fn(),
    onCloseNotebook: jest.fn(),
    onOpenNotebook: jest.fn(),
    onCreatePage: jest.fn(),
    onCreateJupyterNotebook: jest.fn(),
    onCreateLogPage: jest.fn(),
    onCreateDesignPage: jest.fn(),
    onCreateSpreadsheetPage: jest.fn(),
    onLinkDesign: jest.fn(),
    onDirectCreatePage: jest.fn().mockResolvedValue(undefined),
    onImportDocx: jest.fn(),
    onRenameSection: jest.fn(),
    onDeleteSection: jest.fn(),
    onRenamePage: jest.fn(),
    onMovePage: jest.fn(),
    onDeletePage: jest.fn(),
    ghostVersions: null,
    onTogglePageVersions: jest.fn(),
    onPreviewGhostVersion: jest.fn(),
    previewedVersionId: null,
    onRestoreGhostVersion: jest.fn(),
    onDismissGhostVersions: jest.fn(),
    onExportPage: jest.fn(),
    onExportDocxPage: jest.fn(),
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = renderProps(overrides);
  return { ...render(<Sidebar {...props} />), props };
}

describe("rename after create", () => {
  it("renders the inline section input in the desktop notebook rail", () => {
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      expandedNotebooks: new Set(["Work"]),
      inlineSectionPath: "Work/Research",
    });
    const input = screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Research".length]);
  });

  it.each(["section", "page"] as const)("focuses and selects the new %s row after it mounts", (kind) => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const name = kind === "section" ? "New Section" : "Untitled notebook";
    const view = render(<div data-testid="creating" />);
    view.rerender(<InlineSectionName path={`Work/${name}`} name={name} kind={kind} onCommit={onCommit} />);
    const input = screen.getByRole("textbox", { name: kind === "section" ? "Section name" : "Page name" }) as HTMLInputElement;
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, name.length]);
    fireEvent.change(input, { target: { value: "Chosen name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(`Work/${name}`, "Chosen name");
    onCommit.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).toHaveBeenCalledWith(`Work/${name}`, name);
  });
});

describe("SN-352 sidebar context menus", () => {
  it("opens app actions on blank rail space and suppresses the browser menu", () => {
    const { props } = renderSidebar({ sidebarLayout: "rail" });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(screen.getByTestId("tree"), event);
    expect(event.defaultPrevented).toBe(true);
    const menu = screen.getByTestId("sidebar-blank-context-menu");
    expect(menu).toHaveAttribute("data-pane", "rail");
    expect(within(menu).queryByRole("menuitem", { name: "New page" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New notebook" }));
    expect(props.onCreateNotebook).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("sidebar-blank-context-menu")).not.toBeInTheDocument();
  });

  it("routes blank rail New section to the active notebook", () => {
    const { props } = renderSidebar({ sidebarLayout: "rail", activeNotebookPath: "Work" });
    fireEvent.contextMenu(screen.getByTestId("tree"));
    const menu = screen.getByTestId("sidebar-blank-context-menu");
    fireEvent.click(within(menu).getByTestId("blank-menu-new-section"));
    expect(props.onCreateSection).toHaveBeenCalledWith("Work", expect.any(String));
  });

  it("keeps the native menu for inline text inputs", () => {
    renderSidebar({ sidebarLayout: "rail" });
    const input = document.createElement("input");
    screen.getByTestId("tree").appendChild(input);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(input, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("sidebar-blank-context-menu")).not.toBeInTheDocument();
  });

  it("targets the selected scope on blank page-pane space and dismisses with Escape", () => {
    const { props } = renderSidebar({ sidebarLayout: "page-tree", activeNotebookPath: "Work", activeSectionPath: "Work/Research" });
    fireEvent.contextMenu(screen.getByTestId("tree"));
    const menu = screen.getByTestId("sidebar-blank-context-menu");
    expect(menu).toHaveAttribute("data-pane", "page-tree");
    expect(within(menu).queryByRole("menuitem", { name: /New section|New notebook/ })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New page" }));
    expect(props.onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ notebookPath: "Work", sectionPath: "Work/Research" }));
    fireEvent.contextMenu(screen.getByTestId("tree"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("sidebar-blank-context-menu")).not.toBeInTheDocument();
  });

  it("opens notebook actions on right-click and targets New section without selecting", () => {
    const { props } = renderSidebar({ sidebarLayout: "rail", expandedNotebooks: new Set(["Work"]) });
    const row = screen.getByTestId("notebook-rail-row-Work");
    fireEvent.contextMenu(within(row).getByRole("button", { name: "Work" }), { clientX: 90, clientY: 80 });
    const menu = screen.getByTestId("sidebar-context-menu-Work");
    expect(screen.queryByTestId("sidebar-blank-context-menu")).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "New section" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "New page" })).toBeVisible();
    expect(props.onSelectNotebook).not.toHaveBeenCalled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New section" }));
    expect(props.onCreateSection).toHaveBeenCalledWith("Work", "Work");
    expect(screen.queryByTestId("sidebar-context-menu-Work")).not.toBeInTheDocument();
  });

  it("targets section pages, dismisses on Escape, and preserves normal click selection", () => {
    const { props } = renderSidebar({ sidebarLayout: "rail", expandedNotebooks: new Set(["Work"]) });
    const row = screen.getByTestId("rail-section-row-Work/Research");
    fireEvent.contextMenu(row, { clientX: 90, clientY: 80 });
    const menu = screen.getByTestId("sidebar-context-menu-Work/Research");
    expect(within(menu).queryByRole("menuitem", { name: "New section" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New page" }));
    expect(props.onCreatePage).toHaveBeenCalledWith(expect.objectContaining({ notebookPath: "Work", sectionPath: "Work/Research" }));
    fireEvent.contextMenu(row);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("sidebar-context-menu-Work/Research")).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(props.onSelectSection).toHaveBeenCalledWith("Work/Research");
  });

  it("uses the app menu for a page and dismisses it on Escape", () => {
    renderSidebar({ sidebarLayout: "page-tree", activeNotebookPath: "Work", activeSectionPath: "Work/Research" });
    const row = screen.getByTestId("page-Work/Research/Parent");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(row, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId("page-context-menu-Work/Research/Parent")).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("page-context-menu-Work/Research/Parent")).not.toBeInTheDocument();
  });
});

describe("SN-324 dual-pane navigation", () => {
  it("shows token-colored section tabs and a surface highlight on the selected section", () => {
    renderSidebar({ sidebarLayout: "rail", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]), activeSectionPath: "Work/Research" });
    const section = screen.getByTestId("rail-section-row-Work/Research");
    // SN-346: the highlight sits on the row wrapper so it spans the ⋯ trigger too.
    expect(section.parentElement).toHaveClass("bg-surface");
    expect(within(section).getByText("Research")).toHaveClass("text-sm", "font-medium");
    expect(section).toHaveClass("text-foreground");
    expect(section).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("rail-section-tab-Work/Research")).toHaveStyle({ backgroundColor: sectionTabColor("Work/Research") });
    expect(sectionTabColor("Work/Research")).toMatch(/^var\(--chart-[1-5]\)$/);
  });

  // Nav typography (owner reference, 2026-10-20): every nav label in both panes is text-sm (14px).
  // Sizes and weights must sit on inner label elements: the unlayered global `button { font: inherit }`
  // overrides text-*/font-* utilities placed on <button>, which is why earlier fixes never rendered.
  const textSizeClasses = (element: Element) =>
    Array.from(element.classList).filter((className) => /^text-(xs|sm|base|lg|\[)/.test(className));

  it("keeps inactive section names prominent and creation actions quieter at both densities", () => {
    for (const variant of ["desktop", "mobile"] as const) {
      const rail = renderSidebar({ sidebarLayout: "rail", variant, activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]), onSelectRootPages: jest.fn() });
      const notebookRow = within(screen.getByTestId("notebook-rail-row-Work")).getByRole("button", { name: "Work" });
      const section = screen.getByTestId("rail-section-row-Work/Research");
      const rootPages = screen.getByTestId("rail-root-pages-Work");
      const newSection = screen.getByTestId("rail-new-section-Work");
      expect(within(notebookRow).getByText("Work")).toHaveClass("text-sm", "font-semibold");
      expect(notebookRow).toHaveClass(variant === "desktop" ? "min-h-[var(--desktop-tree-section-row-height)]" : "min-h-11");
      expect(section).toHaveClass("text-foreground", variant === "desktop" ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11");
      expect(section).not.toHaveClass("text-muted-foreground");
      expect(rootPages).toHaveClass(variant === "desktop" ? "min-h-[var(--desktop-tree-page-row-height)]" : "min-h-11");
      expect(within(section).getByText("Research")).toHaveClass("text-sm", "font-normal");
      if (variant === "desktop") {
        expect(section).toHaveClass("[@media(pointer:coarse)]:min-h-11");
        expect(rootPages).toHaveClass("[@media(pointer:coarse)]:min-h-11");
      }
      expect(newSection).toHaveClass("text-muted-foreground", variant === "desktop" ? "min-h-[var(--desktop-tree-section-row-height)]" : "min-h-11");
      expect(within(newSection).getByText("New section")).toHaveClass("text-sm", "font-normal");
      rail.unmount();

      const pages = renderSidebar({ sidebarLayout: "page-tree", variant, activeNotebookPath: "Work", activeSectionPath: "Work/Research" });
      const addPage = screen.getByTestId("page-pane-add-page");
      expect(addPage).toHaveClass("text-muted-foreground", variant === "desktop" ? "h-9" : "min-h-11");
      expect(addPage).not.toHaveClass("border-border", "bg-background");
      expect(within(addPage).getByText("Add Page")).toHaveClass("text-sm", "font-normal");
      pages.unmount();
    }
  });

  it("uses one nav label size for notebooks, sections, pages, and creation actions", () => {
    const rail = renderSidebar({ sidebarLayout: "rail", variant: "desktop", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]), onSelectRootPages: jest.fn() });
    const labels = [
      within(within(screen.getByTestId("notebook-rail-row-Work")).getByRole("button", { name: "Work" })).getByText("Work"),
      within(screen.getByTestId("rail-section-row-Work/Research")).getByText("Research"),
      within(screen.getByTestId("rail-root-pages-Work")).getByText("Notebook pages"),
      within(screen.getByTestId("rail-new-section-Work")).getByText("New section"),
    ];
    for (const label of labels) expect(textSizeClasses(label)).toEqual(["text-sm"]);
    // No dead size/weight utilities on the row buttons themselves.
    for (const row of [screen.getByTestId("rail-section-row-Work/Research"), screen.getByTestId("rail-root-pages-Work")]) {
      expect(textSizeClasses(row)).toEqual([]);
      expect(row).not.toHaveClass("font-medium", "font-semibold");
    }
    rail.unmount();

    const sectionPages = renderSidebar({ sidebarLayout: "page-tree", variant: "desktop", activeNotebookPath: "Work", activeSectionPath: "Work/Research", expandedPages: new Set(["Work/Research/Parent"]) });
    const pageRow = screen.getByTestId("page-Work/Research/Parent");
    expect(pageRow).toHaveClass("min-h-[var(--desktop-tree-page-row-height)]", "[@media(pointer:coarse)]:min-h-11");
    const pageTitle = within(pageRow).getByText("Parent");
    const childTitle = within(screen.getByTestId("page-Work/Research/Laser")).getByText("Laser calibration");
    expect(pageTitle).toHaveClass("font-normal");
    for (const title of [pageTitle, childTitle]) expect(textSizeClasses(title)).toEqual(["text-sm"]);
    expect(textSizeClasses(within(screen.getByTestId("page-pane-add-page")).getByText("Add Page"))).toEqual(["text-sm"]);
    expect(pageRow.querySelector('button[class*="--desktop-tree-page-row-height"]')).toBeInTheDocument();
    sectionPages.unmount();

    renderSidebar({ sidebarLayout: "page-tree", variant: "desktop", activeNotebookPath: "Work", activeSectionPath: null });
    const rootPage = screen.getByTestId("page-Work/Roadmap");
    expect(rootPage).toHaveClass("min-h-[var(--desktop-tree-page-row-height)]");
    const rootPageTitle = within(rootPage).getByText("Roadmap");
    expect(rootPageTitle).toHaveClass("font-normal");
    expect(textSizeClasses(rootPageTitle)).toEqual(["text-sm"]);
  });


  it("offers notebook root pages in the rail and selects that scope", () => {
    const onSelectRootPages = jest.fn();
    renderSidebar({ sidebarLayout: "rail", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]), onSelectRootPages });
    fireEvent.click(screen.getByTestId("rail-root-pages-Work"));
    expect(onSelectRootPages).toHaveBeenCalledWith("Work");
    expect(notebookHasRootPagesRow({ pages: [], sections: [] })).toBe(true);
    expect(notebookHasRootPagesRow({ pages: [], sections: tree[0].sections })).toBe(false);
  });

  it("shows pages only for the selected section and adds pages there", () => {
    const onDirectCreatePage = jest.fn().mockResolvedValue(undefined);
    const onOpenPage = jest.fn();
    renderSidebar({
      sidebarLayout: "page-tree", activeNotebookPath: "Work", activeSectionPath: "Work/Research",
      expandedPages: new Set(["Work/Research/Parent"]), onDirectCreatePage, onOpenPage,
    });
    const scope = screen.getByTestId("page-pane-scope");
    const parent = within(scope).getByTestId("page-Work/Research/Parent");
    const child = within(scope).getByTestId("page-Work/Research/Laser");
    expect(screen.queryByTestId("page-pane-section-heading")).not.toBeInTheDocument();
    expect(within(scope).queryByText("Research")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-menu-Work/Research")).not.toBeInTheDocument();
    expect(parent).toHaveStyle({ paddingLeft: "8px" });
    expect(child).toHaveStyle({ paddingLeft: "20px" });
    expect(screen.queryByTestId("page-Work/Roadmap")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-Personal/Travel")).not.toBeInTheDocument();
    fireEvent.click(within(parent).getByRole("button", { name: /^Parent/ }));
    expect(onOpenPage).toHaveBeenCalledWith("Work/Research/Parent");
    fireEvent.click(screen.getByTestId("page-pane-add-page"));
    expect(onDirectCreatePage).toHaveBeenCalledWith(expect.objectContaining({ notebookPath: "Work", sectionPath: "Work/Research" }));
  });

  it("starts scoped desktop pages at the pane edge while preserving child nesting", () => {
    renderSidebar({
      sidebarLayout: "page-tree", variant: "desktop", activeNotebookPath: "Work",
      activeSectionPath: "Work/Research", expandedPages: new Set(["Work/Research/Parent"]),
    });
    expect(screen.queryByTestId("page-pane-section-heading")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-Work/Research/Parent")).toHaveAttribute("style", expect.stringContaining("calc(4px + 0 * var(--desktop-tree-indent-step))"));
    expect(screen.getByTestId("page-Work/Research/Laser")).toHaveAttribute("style", expect.stringContaining("calc(4px + 1 * var(--desktop-tree-indent-step))"));
  });

  it("shows root pages when the notebook has no selected section", () => {
    renderSidebar({ sidebarLayout: "page-tree", activeNotebookPath: "Work", activeSectionPath: null });
    expect(screen.queryByTestId("page-pane-root-heading")).not.toBeInTheDocument();
    expect(screen.getByTestId("page-Work/Roadmap")).toBeInTheDocument();
    expect(screen.queryByTestId("page-Work/Research/Parent")).not.toBeInTheDocument();
  });

  it("keeps separate collapse controls for the two desktop panes", () => {
    const onCollapseRail = jest.fn();
    const onCollapseTree = jest.fn();
    const rail = renderSidebar({ sidebarLayout: "rail", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]), onCollapseRail });
    fireEvent.click(within(rail.container).getByTestId("notebook-rail-collapse"));
    expect(onCollapseRail).toHaveBeenCalledTimes(1);
    rail.unmount();
    renderSidebar({ sidebarLayout: "page-tree", activeNotebookPath: "Work", onCollapseTree });
    fireEvent.click(screen.getByTestId("tree-sidebar-collapse"));
    expect(onCollapseTree).toHaveBeenCalledTimes(1);
  });
});

describe("notebook picker organization component", () => {
  it("edits a newly created section name in the tree", () => {
    const onCommitSectionName = jest.fn().mockResolvedValue(undefined);
    renderSidebar({ expandedNotebooks: new Set(["Work"]), inlineSectionPath: "Work/Research", onCommitSectionName });
    const input = screen.getByRole("textbox", { name: "Section name" });
    input.focus();
    fireEvent.change(input, { target: { value: "Ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitSectionName).toHaveBeenCalledWith("Work/Research", "Ideas");

    onCommitSectionName.mockClear();
    input.focus();
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommitSectionName).toHaveBeenCalledWith("Work/Research", "Research");
    expect(onCommitSectionName).not.toHaveBeenCalledWith("Work/Research", "Discarded");
  });

  it("keeps organization chrome out of the tree and filters inside the picker", () => {
    renderSidebar();
    expect(screen.queryByTestId("notebook-picker-filter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("key-notes-lens-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notebook-group-ungrouped")).not.toBeInTheDocument();
    expect(screen.getByTestId("notebook-Work")).toBeInTheDocument();
    expect(screen.getByTestId("notebook-Personal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.change(screen.getByTestId("notebook-picker-filter"), { target: { value: "laser" } });
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Parent")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Laser")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear notebook filter"));
    expect(screen.getByTestId("picker-notebook-Personal")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-page-Work/Research/Laser")).not.toBeInTheDocument();
  });

  it("renders the key-note lens grouped by notebook", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.click(screen.getByTestId("key-notes-lens-toggle"));
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Work");
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Laser calibration");
    expect(screen.getByTestId("key-notes-lens")).toHaveTextContent("Personal");
    expect(screen.getByTestId("key-notes-lens")).not.toHaveTextContent("Roadmap");
  });

  it("collapses and expands the ungrouped notebook bucket", () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByLabelText("Collapse Ungrouped")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Collapse Ungrouped"));
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Ungrouped"));
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
  });

  it("reopens a closed notebook when its notebook-only row is selected", () => {
    const onOpenNotebook = jest.fn();
    const onSelectNotebook = jest.fn();
    renderSidebar({
      closedNotebooks: new Set(["Work"]),
      onOpenNotebook,
      onSelectNotebook,
    });
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    fireEvent.click(within(screen.getByTestId("picker-notebook-Work")).getByText("Work"));
    expect(onOpenNotebook).toHaveBeenCalledWith("Work");
    expect(onSelectNotebook).not.toHaveBeenCalled();
  });

  it("keeps pinned items first without removing ordinary sidebar rows", () => {
    renderSidebar({
      pinnedNotebooks: new Set(["Work"]),
      pinnedPages: new Set(["Personal/Travel"]),
      expandedNotebooks: new Set(["Work"]),
    });
    expect(screen.getByTestId("notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    const pinned = screen.getByTestId("pinned-section");
    expect(pinned).toHaveTextContent("Work");
    expect(pinned).toHaveTextContent("Travel plans");
    expect(pinned).toHaveTextContent("Personal");
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("picker-page-Personal/Travel")).toHaveLength(1);
    expect(pinned).toContainElement(screen.getByTestId("picker-page-Personal/Travel"));
  });

  it("pins a non-key-note page from the tree menu and exposes it in the picker", () => {
    const onTogglePinnedPage = jest.fn();
    const view = renderSidebar({
      expandedNotebooks: new Set(["Work"]),
      onTogglePinnedPage,
    });

    fireEvent.contextMenu(screen.getByTestId("page-Work/Roadmap"));
    fireEvent.click(screen.getByTestId("page-context-pin-Work/Roadmap"));
    expect(onTogglePinnedPage).toHaveBeenCalledWith("Work/Roadmap");

    view.rerender(<Sidebar {...view.props} pinnedPages={new Set(["Work/Roadmap"])} />);
    fireEvent.contextMenu(screen.getByTestId("page-Work/Roadmap"));
    expect(screen.getByTestId("page-context-pin-Work/Roadmap")).toHaveTextContent("Unpin page");
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    const pinned = screen.getByTestId("pinned-section");
    expect(pinned).toHaveTextContent("Roadmap");
    expect(pinned).toHaveTextContent("Work");
  });

  it("renders persisted collapsible groups and temporarily opens matches", () => {
    const onToggleNotebookGroup = jest.fn();
    renderSidebar({
      onToggleNotebookGroup,
      notebookGroups: [{ id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: true }],
    });
    expect(screen.queryByTestId("notebook-group-work")).not.toBeInTheDocument();
    expect(screen.queryByTestId("accordion-mode-toggle")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByTestId("notebook-group-work")).toHaveTextContent("Work group");
    expect(screen.getByTestId("notebook-group-ungrouped")).toHaveTextContent("Ungrouped");
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Expand Work group"));
    expect(onToggleNotebookGroup).toHaveBeenCalledWith("work");
    fireEvent.change(screen.getByTestId("notebook-picker-filter"), { target: { value: "laser" } });
    expect(screen.getByTestId("picker-notebook-Work")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Clear notebook filter"));
    expect(screen.queryByTestId("picker-notebook-Work")).not.toBeInTheDocument();
  });

  it("collapses and expands all notebook groups with one control", () => {
    const onToggleNotebookGroup = jest.fn();
    renderSidebar({
      onToggleNotebookGroup,
      notebookGroups: [{ id: "work", name: "Work group", notebookPaths: ["Work"], collapsed: true }],
    });
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.getByLabelText("Collapse all groups")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-all-notebook-groups"));
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expand all groups")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-all-notebook-groups"));
    expect(onToggleNotebookGroup).toHaveBeenCalledWith("work");
    expect(screen.getByTestId("picker-notebook-Personal")).toBeInTheDocument();
  });

  it("keeps archived notebooks out of the tree and picker primary list", () => {
    const onUnarchiveNotebook = jest.fn();
    renderSidebar({
      archivedNotebooks: new Set(["Personal"]),
      onUnarchiveNotebook,
    });
    expect(screen.queryByTestId("notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("open-closed-notebook-btn"));
    expect(screen.queryByTestId("picker-notebook-Personal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unarchive-notebook-Personal"));
    expect(onUnarchiveNotebook).toHaveBeenCalledWith("Personal");
  });
});

describe("rail layout — sections under active notebook (SN-324)", () => {
  it("shows sections under the active notebook in rail layout", () => {
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      expandedNotebooks: new Set(["Work"]),
    });
    expect(screen.getByTestId("notebook-rail-row-Work")).toBeInTheDocument();
    expect(screen.getByTestId("rail-section-row-Work/Research")).toBeInTheDocument();
    expect(screen.getByTestId("rail-section-row-Work/Research")).toHaveTextContent("Research");
    // Personal has no sections — no section rows for it
    expect(screen.queryByTestId("rail-section-row-Personal")).not.toBeInTheDocument();
  });

  it("clicking a section row calls onSelectSection and onToggleSection", () => {
    const onSelectSection = jest.fn();
    const onToggleSection = jest.fn();
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      expandedNotebooks: new Set(["Work"]),
      expandedSections: new Set(),
      onSelectSection,
      onToggleSection,
    });
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(onSelectSection).toHaveBeenCalledWith("Work/Research");
    expect(onToggleSection).toHaveBeenCalledWith("Work/Research");
  });

  it("does not call onToggleSection when section is already expanded", () => {
    const onToggleSection = jest.fn();
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      expandedNotebooks: new Set(["Work"]),
      expandedSections: new Set(["Work/Research"]),
      onToggleSection,
    });
    fireEvent.click(screen.getByTestId("rail-section-row-Work/Research"));
    expect(onToggleSection).not.toHaveBeenCalled();
  });

  it("shows New Section button under expanded notebook with sections", () => {
    const onCreateSection = jest.fn();
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      expandedNotebooks: new Set(["Work"]),
      onCreateSection,
    });
    const btn = screen.getByTestId("rail-new-section-Work");
    expect(btn).toHaveTextContent("New section");
    fireEvent.click(btn);
    expect(onCreateSection).toHaveBeenCalledWith("Work", "Work");
  });

  it("marks active section with aria-current", () => {
    renderSidebar({
      sidebarLayout: "rail",
      activeNotebookPath: "Work",
      activeSectionPath: "Work/Research",
      expandedNotebooks: new Set(["Work"]),
    });
    expect(screen.getByTestId("rail-section-row-Work/Research")).toHaveAttribute("aria-current", "page");
  });
});

describe("SN-346 rail notebook and section menus", () => {
  it("reveals each sidebar ellipsis on its own row hover while preserving focus and touch access", () => {
    const rail = renderSidebar({ sidebarLayout: "rail", variant: "desktop", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]) });
    for (const testId of ["rail-notebook-menu-Work", "rail-section-menu-Work/Research"]) {
      const trigger = screen.getByTestId(testId);
      expect(trigger.parentElement).toHaveClass("group");
      expect(trigger).toHaveClass("opacity-0", "group-hover:opacity-100", "focus-visible:opacity-100", "data-[popup-open]:opacity-100", "[@media(pointer:coarse)]:opacity-100");
    }
    rail.unmount();

    renderSidebar({ sidebarLayout: "page-tree", variant: "desktop", activeNotebookPath: "Work", activeSectionPath: "Work/Research" });
    const pageMenu = screen.getByTestId("page-menu-Work/Research/Parent");
    expect(pageMenu).toHaveClass("opacity-0", "group-hover:opacity-100", "group-focus-within:opacity-100", "data-[popup-open]:opacity-100", "[@media(pointer:coarse)]:opacity-100");
    expect(pageMenu.closest('[data-testid="page-Work/Research/Parent"]')).toHaveClass("group");
  });

  it("exposes delete/rename actions from the rail notebook and section rows", async () => {
    const { props } = renderSidebar({ sidebarLayout: "rail", variant: "desktop", activeNotebookPath: "Work", expandedNotebooks: new Set(["Work"]) });

    fireEvent.click(screen.getByTestId("rail-notebook-menu-Work"));
    fireEvent.click(await screen.findByText("Delete notebook"));
    expect(props.onDeleteNotebook).toHaveBeenCalledWith("Work", "Work", undefined);

    fireEvent.click(screen.getByTestId("rail-section-menu-Work/Research"));
    expect(await screen.findByText("Rename section")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete section"));
    expect(props.onDeleteSection).toHaveBeenCalledWith("Work/Research", "Research");
  });
});

describe("SN-392 tree expand/collapse toggles", () => {
  function RailHarness({ onSelectNotebook }: { onSelectNotebook: jest.Mock }) {
    const [expanded, setExpanded] = React.useState<Set<string>>(new Set(["Work"]));
    const toggle = (path: string) => setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    const props = renderProps({ sidebarLayout: "rail", activeNotebookPath: "Work", expandedNotebooks: expanded, onToggleNotebook: toggle, onSelectNotebook });
    return <Sidebar {...props} />;
  }

  it("collapses the active notebook's sections from its chevron without selecting, and the name re-expands", () => {
    const onSelectNotebook = jest.fn();
    render(<RailHarness onSelectNotebook={onSelectNotebook} />);
    const toggle = screen.getByTestId("rail-notebook-toggle-Work");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(toggle);
      const open = i % 2 === 1;
      expect(toggle).toHaveAttribute("aria-expanded", String(open));
      expect(screen.queryByTestId("rail-section-row-Work/Research") !== null).toBe(open);
    }
    expect(onSelectNotebook).not.toHaveBeenCalled();
    // Collapsed: clicking the notebook name selects and reveals its sections (never collapses).
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const name = within(screen.getByTestId("notebook-rail-row-Work")).getByRole("button", { name: "Work" });
    fireEvent.click(name);
    expect(onSelectNotebook).toHaveBeenCalledWith("Work");
    expect(screen.getByTestId("rail-section-row-Work/Research")).toBeInTheDocument();
    fireEvent.click(name);
    expect(screen.getByTestId("rail-section-row-Work/Research")).toBeInTheDocument();
  });

  it("toggles nested pages from a dedicated chevron that does not open or drag the row", () => {
    const { props } = renderSidebar({ sidebarLayout: "page-tree", variant: "mobile", activeNotebookPath: "Work", activeSectionPath: "Work/Research" });
    const toggle = screen.getByRole("button", { name: "Expand Parent" });
    expect(toggle).toHaveClass("size-11");
    fireEvent.click(toggle);
    expect(props.onTogglePage).toHaveBeenCalledWith("Work/Research/Parent");
    expect(props.onOpenPage).not.toHaveBeenCalled();
    const row = screen.getByTestId("page-Work/Research/Parent");
    fireEvent.pointerDown(toggle);
    const drag = fireEvent.dragStart(row, { dataTransfer: { effectAllowed: "" } });
    expect(drag).toBe(false);
    fireEvent.click(within(row).getByText("Parent"));
    expect(props.onOpenPage).toHaveBeenCalledWith("Work/Research/Parent");
  });
});
